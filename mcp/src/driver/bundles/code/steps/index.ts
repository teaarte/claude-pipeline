/**
 * Built-in FSM steps (≥17 per spec; currently 23). Each is a small
 * StepPlugin; orchestration choices live here rather than in markdown. The
 * driver core (fsm.ts) runs them in the order specified by the active
 * FlowPlugin.
 *
 * Steps are intentionally simple — most either advance unconditionally (a
 * marker step), branch on a DecisionPlugin, emit an ask-user shuttle (gate
 * steps), or call beginSpawn → return a shuttle response. Real LLM work
 * happens inside spawned agents; steps coordinate them.
 *
 * If an agent_output for the agent_run_id this step issued is already in
 * scratch (set by pipeline_continue_task), the step returns "advance" so
 * the FSM doesn't re-spawn. This is the canonical resume contract for
 * spawn-emitting steps; gate steps use the parallel `${gateName}_decision`
 * key (see gateStep).
 */

import type {
  StepPlugin,
  StepResult,
  DriverState,
  StepContext,
  AgentPlugin,
  SpawnRequest,
  UserAnswer,
} from "../../../types/plugin.js";
import { askUser, complete, spawnAgentsParallel } from "../../../core/shuttle.js";
import { requireGate, requireDecision, requireSpawnProvider, requireAgent, requireFlow, requireStep } from "../../../core/registry.js";
import { resolveAgentModel } from "../agents/resolve-model.js";
import { defaultConfig } from "../../../types/config.js";
import { CODE_PHASES, type Phase } from "../../../../lib/phase-state-machine.js";
import { pipelineSetPhaseStatus } from "../../../../tools/set-phase-status.js";
import { pipelineSetGate } from "../../../../tools/set-gate.js";
import { readStateSafe } from "../../../../lib/state-io.js";
import { stateFile } from "../../../../lib/paths.js";
import { audit } from "../../../../lib/audit.js";
import type { PluginRegistry } from "../../../types/plugin.js";
import { loadTeamKnowledge, type TeamKnowledgeRef } from "../../../../lib/team-knowledge.js";

/**
 * Mark every phase strictly before `currentPhase` as closed in pipeline-state.
 * Idempotent — INV_010 re-entry attempts are swallowed silently. Context and
 * final are exempt from INV_002 (no-agent rule). For test_first when
 * tests_mode=regression-only we skip with the canonical reason; otherwise
 * complete. Best-effort; if pipeline-state is absent (smoke/test path with
 * no spawnRecorder) we silently return.
 */
async function closePriorPhases(state: DriverState, currentPhase: Phase): Promise<void> {
  const file = stateFile(state.project_dir);
  const ps = await readStateSafe(file).catch(() => null);
  if (!ps) return;
  const testsMode = (state.decisions["tests_mode"] as string | undefined) ?? "regression-only";
  const idxOf = (p: string) => (CODE_PHASES as readonly string[]).indexOf(p);
  const currentIdx = idxOf(currentPhase);
  for (const phase of CODE_PHASES) {
    if (idxOf(phase) >= currentIdx) break;
    const phStatus = ps.phases?.[phase]?.status;
    if (phStatus === "completed" || phStatus === "skipped") continue;
    // All best-effort. INV_002 means we haven't recorded an agent in this
    // phase yet (real `pipeline_finish` will block, surfacing the bug at
    // the right place). INV_010 means the phase is already terminal.
    // INV_011 means our prior closure attempt in this loop failed and the
    // prereq chain is broken — propagating would be a spurious throw.
    const swallow = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (/INV_002|INV_010|INV_011/.test(msg)) return undefined;
      throw e;
    };
    if (phase === "test_first" && testsMode === "regression-only") {
      await pipelineSetPhaseStatus({
        project_dir: state.project_dir,
        phase,
        status: "skipped",
        skipped_reason: "regression-only",
      }).catch(swallow);
      continue;
    }
    await pipelineSetPhaseStatus({
      project_dir: state.project_dir,
      phase,
      status: "completed",
    }).catch(swallow);
  }
}

const SPAWN_RESULT_KEY = (id: string) => `agent_output_${id}`;
const SPAWN_ISSUED_KEY = (stepName: string) => `__spawn_issued_${stepName}`;

// Helper: spawn one agent through the registered spawn provider. The step's
// phase is passed in explicitly — no template_path string-match, no scratch
// indirection. The agent model is resolved through
// resolveAgentModel(agent, phase, config) per item 8 user-nudge #2.
async function spawnOne(
  state: DriverState,
  ctx: StepContext,
  agentName: string,
  phase: Phase,
  stepName: string,
): Promise<StepResult> {
  // Resume short-circuit: if we already issued a spawn for this step in this
  // run and the result has been routed in (via pipeline_continue_task), don't
  // re-spawn. This is the fix for the FSM resume bug found in code review.
  const issuedId = state.scratch[SPAWN_ISSUED_KEY(stepName)] as string | undefined;
  if (issuedId && state.scratch[SPAWN_RESULT_KEY(issuedId)] !== undefined) {
    delete state.scratch[SPAWN_ISSUED_KEY(stepName)];
    return { type: "advance" };
  }
  const agent = requireAgent(ctx.registry, agentName);
  if (agent.applies_to && !agent.applies_to(state)) {
    return { type: "advance" };
  }
  // Close prior phases so INV_011's prereq check passes when we begin the
  // first agent in `phase`. Idempotent + best-effort.
  await closePriorPhases(state, phase);
  const provider = requireSpawnProvider(ctx.registry);
  const config = (state.scratch.config as any) ?? defaultConfig;
  const model = resolveAgentModel(agent, phase, config);
  const agent_run_id = await ctx.beginSpawn(agentName, phase, model);
  state.scratch[SPAWN_ISSUED_KEY(stepName)] = agent_run_id;

  // Item 7: resolve team-knowledge refs from pipeline-state (populated by
  // pipeline_init from pipeline.config.json) + bundle baseline dir. Best
  // effort — if the state file is unreachable, skip injection silently.
  const teamKnowledge = await loadTeamKnowledgeForSpawn(state);

  return provider.spawn({
    agent: agentName,
    agent_run_id,
    driver_state_id: state.driver_state_id,
    task_id: state.task_id ?? undefined,
    phase,
    model,
    template_path: agent.template_path,
    prompt: `Spawn agent: ${agentName}. Project: ${state.project_dir}. Task: ${state.task}.`,
    team_knowledge: teamKnowledge,
  });
}

async function loadTeamKnowledgeForSpawn(state: DriverState): Promise<string> {
  const file = stateFile(state.project_dir);
  const ps = await readStateSafe(file).catch(() => null);
  const refsFromState = Array.isArray(ps?.team_knowledge_refs)
    ? (ps.team_knowledge_refs as string[]).filter((r): r is string => typeof r === "string")
    : [];
  if (refsFromState.length === 0) return "";
  const refs: TeamKnowledgeRef[] = refsFromState.map((r) => ({
    path: r.startsWith("/") ? r : `${state.project_dir}/${r}`,
    source: "project-config",
  }));
  const result = await loadTeamKnowledge(refs);
  if (result.truncated || result.missing.length > 0) {
    await audit({
      tool: "pipeline_spawn",
      args: { agent_count: refs.length },
      projectDir: state.project_dir,
      verdict: "ok",
      error_class: result.missing.length > 0 ? "team-knowledge-missing" : "team-knowledge-truncated",
    }).catch(() => undefined);
  }
  return result.content;
}

const INITIALIZE: StepPlugin = {
  name: "initialize",
  phase: "context",
  async run(state) {
    state.started_at ||= new Date().toISOString();
    return { type: "advance" };
  },
};

/**
 * CLASSIFY: deterministic decisions only (complexity, tests_mode). The
 * LLM-driven classification cluster (refs_to_load, security_needed,
 * antipattern_rules_applicable, task_short, stack, change_kind) is owned
 * by CLASSIFY_AGENT — a separate context-phase step that spawns the
 * classifier-agent and parses its JSON output. Splitting deterministic from
 * LLM-derived classification keeps the deterministic decisions resilient to
 * spawn failures (D1 falls back to safe defaults on classifier hiccups).
 */
const CLASSIFY: StepPlugin = {
  name: "classify",
  phase: "context",
  async run(state, ctx) {
    const complexity = requireDecision<"simple" | "medium" | "complex">(ctx.registry, "complexity").decide(state);
    const tests_mode = requireDecision<"tdd" | "regression-only">(ctx.registry, "tests_mode").decide(state);
    state.decisions["complexity"] = complexity;
    state.decisions["tests_mode"] = tests_mode;
    return { type: "advance" };
  },
};

/**
 * D1 (Q-classifier-auto-spawn): spawn the classifier-agent in the context
 * phase. The classifier's JSON output is parsed by the
 * `extract-classifier-output` hook in `bundles/code/hooks/index.ts`
 * (after-agent-result event, agent filter "classifier") because
 * continue-task auto-advances step_index after delivering the agent_output
 * — the step's resume short-circuit would never fire. The hook populates
 * `state.decisions.{task_short, refs_to_load, security_needed,
 * antipattern_rules_applicable, stack, change_kind}` after the spawn
 * returns.
 *
 * Failure mode (handled in the hook): validation errors or unparseable
 * JSON keep existing defaults intact and audit error_class:
 * "llm-classification-needed". The FSM never blocks on a classifier hiccup.
 *
 * Skip path: tests that drive the FSM without a real classifier-LLM can
 * pre-populate `state.decisions.task_short` (and any other slots they
 * care about). CLASSIFY_AGENT detects the prefilled slot and advances
 * without issuing a spawn.
 */
const CLASSIFY_AGENT: StepPlugin = {
  name: "classify-agent",
  phase: "context",
  async run(state, ctx) {
    if (
      typeof state.decisions["task_short"] === "string" &&
      (state.decisions["task_short"] as string).trim().length > 0
    ) {
      return { type: "advance" };
    }
    return spawnOne(state, ctx, "classifier", "context", "classify-agent");
  },
};

/**
 * Q8: when the FSM resumes from an ask-user shuttle, mirror the captured
 * decision from driver-state.scratch onto pipeline-state.gates so the canonical
 * record is up to date — without this step, INV_005/INV_006 never fire and the
 * pipeline_finish metrics row reads `gate1_revisions=0` even when the human
 * actually rejected an iteration of the plan.
 *
 * Idempotent: tracks `${gateName}_mirrored` in scratch so re-running the same
 * gate step (e.g. after a transient FSM error and retry) doesn't double-write.
 */
export async function mirrorGateDecision(
  state: DriverState,
  registry: PluginRegistry,
  gateName: string,
): Promise<void> {
  if (state.scratch[`${gateName}_mirrored`]) return;
  const answer = state.scratch[`${gateName}_decision`] as UserAnswer | undefined;
  if (!answer || (answer.decision !== "accept" && answer.decision !== "reject")) return;
  const gate = requireGate(registry, gateName);
  const parsed = gate.validate_response(answer);
  const gateKey = gateName.replace("-", "") as "gate0" | "gate1" | "gate2";
  try {
    await pipelineSetGate({
      project_dir: state.project_dir,
      gate: gateKey,
      status: parsed.status,
      feedback: parsed.feedback,
    });
    if (parsed.status === "rejected" && gateName === "gate-1") {
      // Counter used by the Q22 metrics-row extractor (gate1_revisions).
      const prev = (state.scratch.gate1_revision_count as number | undefined) ?? 0;
      state.scratch.gate1_revision_count = prev + 1;
    }
    state.scratch[`${gateName}_mirrored`] = true;
    await audit({
      tool: "pipeline_gate_mirror",
      args: { gate: gateKey, status: parsed.status },
      projectDir: state.project_dir,
      verdict: "ok",
    }).catch(() => undefined);
  } catch (e) {
    // pipeline-state might be absent in smoke/unit paths — best-effort.
    const msg = e instanceof Error ? e.message : String(e);
    await audit({
      tool: "pipeline_gate_mirror",
      args: { gate: gateKey, status: parsed.status },
      projectDir: state.project_dir,
      verdict: "error",
      error: msg,
    }).catch(() => undefined);
  }
}

/**
 * Q74 (D13): clear scratch keys that would prevent impl + review steps from
 * re-running on a gate-2 reject-revise walk-back. We keep `agent_output_*`
 * entries (they're history) and only clear the `__spawn_issued_*` markers so
 * spawnOne issues fresh spawns; same for the review fan-out batch marker.
 * gate-2 decision + mirror flag are cleared so the second pass re-prompts the
 * human after the new impl iteration.
 */
function clearImplScratchForRevise(state: DriverState): void {
  for (const key of Object.keys(state.scratch)) {
    if (key.startsWith("__spawn_issued_")) delete state.scratch[key];
  }
  delete state.scratch[REVIEW_ISSUED_KEY];
  delete state.scratch["gate-2_decision"];
  delete state.scratch["gate-2_mirrored"];
}

/**
 * Q74 (D13): find the first step in the active flow whose StepPlugin.phase
 * === "implementation". Used by gate-2 reject-revise to walk step_index back
 * to the impl phase entry. Returns -1 if no impl-phase step exists in the
 * flow (defensive — shouldn't happen for built-in code flows).
 */
function findFirstImplStepIndex(state: DriverState, registry: PluginRegistry): number {
  const flow = requireFlow(registry, state.flow_name);
  for (let i = 0; i < flow.steps.length; i++) {
    const step = registry.steps.get(flow.steps[i]);
    if (step && step.phase === "implementation") return i;
  }
  return -1;
}

type GateResumeFn = (
  state: DriverState,
  registry: PluginRegistry,
  answer: UserAnswer,
) => Promise<StepResult> | StepResult;

/**
 * D9 (Q70): optional pre-ask hook. Runs BEFORE the gate emits its
 * ask-user shuttle. If it returns a StepResult, that result short-circuits
 * the askUser pause — used by gate-1's auto-replan loop to walk back to
 * PLAN when blocking findings exist and the replan cap allows.
 */
type GatePreAskFn = (
  state: DriverState,
  ctx: StepContext,
  gateName: string,
) => Promise<StepResult | null> | StepResult | null;

function gateStep(
  name: string,
  gateName: string,
  phase: StepPlugin["phase"],
  onResume?: GateResumeFn,
  onPreAsk?: GatePreAskFn,
): StepPlugin {
  return {
    name,
    phase,
    async run(state, ctx) {
      // Resume: if pipeline_continue_task routed in a user-answer for this
      // gate, mirror the decision to canonical pipeline-state.gates (Q8),
      // then dispatch on the optional gate-specific resume handler. Gates
      // without a handler advance unconditionally (today's gate-0 / gate-1
      // behavior); gate-2's handler routes accept / reject-revise /
      // reject-abandon (Q74 / D13).
      const answer = state.scratch[`${gateName}_decision`] as UserAnswer | undefined;
      if (answer !== undefined) {
        await mirrorGateDecision(state, ctx.registry, gateName);
        if (onResume) {
          return onResume(state, ctx.registry, answer);
        }
        return { type: "advance" };
      }
      // D9: pre-ask hook — gate-1 uses this to auto-replan when blocking
      // findings exist and the replan cap allows.
      if (onPreAsk) {
        const r = await Promise.resolve(onPreAsk(state, ctx, gateName));
        if (r !== null) return r;
      }
      // Close any prior phases (idempotent) before pausing for the human.
      await closePriorPhases(state, phase);
      const gate = requireGate(ctx.registry, gateName);
      const msg = await Promise.resolve(gate.message(state));
      state.pending_user_answer = { gate: gateName, message: msg };
      return { type: "shuttle", response: askUser(state.driver_state_id, gateName, msg) };
    },
  };
}

/**
 * Q74 (D13): gate-2 resume routes the user's decision through three paths:
 *
 * - **accept** → set state.verdict = "accepted", advance to FINALIZE.
 * - **reject + reject_intent: "abandon"** → set state.verdict = "rejected",
 *   advance to FINALIZE. Metric row carries verdict="rejected".
 * - **reject (default reject_intent = "revise")** → walk step_index back to
 *   the implementation phase entry, clear impl-phase spawn-issued markers
 *   and the gate-2 decision so the second pass re-prompts. Verdict stays
 *   null until the user re-decides at gate-2.
 *
 * The walk-back pre-bumps to (implEntry - 1) because runFSM increments after
 * an "advance" StepResult. Without the pre-bump, advance would land us at
 * implEntry+1, skipping the entry step.
 */
async function gate2Resume(
  state: DriverState,
  registry: PluginRegistry,
  answer: UserAnswer,
): Promise<StepResult> {
  if (answer.decision === "accept") {
    state.verdict = "accepted";
    return { type: "advance" };
  }
  // decision === "reject" from here on
  const intent = answer.reject_intent ?? "revise";
  if (intent === "abandon") {
    state.verdict = "rejected";
    return { type: "advance" };
  }
  // intent === "revise" — walk back to impl entry, re-run impl + review.
  const implEntry = findFirstImplStepIndex(state, registry);
  if (implEntry < 0) {
    throw new Error(
      "INV_inconsistent-finalize: cannot find an implementation-phase step in the active flow for gate-2 reject-revise",
    );
  }
  clearImplScratchForRevise(state);
  // Pre-bump: runFSM increments after "advance", so set to (implEntry - 1).
  state.step_index = implEntry - 1;
  return { type: "advance" };
}

const AUTO_REPLAN_COUNT_KEY = "__auto_replan_count";

/**
 * D9 (Q70): auto-replan loop at planning gate-1. Opt-in via
 * pipeline.config.json `auto_replan_on_blocking_max: 0 | 1 | 2`. When
 * blocking findings exist at planning AND the cap allows, walks step_index
 * back to PLAN with the auto-derived suggested-revision as synthetic
 * gate-1-reject feedback — no human pause.
 *
 * Why capped: real-task observation 2026-05-19 — gate-1 reject "add
 * __mfRuntime seam for AC-8 integration test" prompted planner to add
 * BootstrapOverrides DI seam which challenger-reviewer subsequently
 * called over-engineered. Unlimited auto-replan would scale this
 * confirmation-bias pattern. The cap forces human review after N attempts.
 */
async function gate1AutoReplanPreAsk(
  state: DriverState,
  ctx: StepContext,
  gateName: string,
): Promise<StepResult | null> {
  const config = state.scratch.bundleConfig as
    | { auto_replan_on_blocking_max?: 0 | 1 | 2 }
    | undefined;
  const cap = config?.auto_replan_on_blocking_max ?? 0;
  if (cap === 0) return null;
  // Render the gate-1 message now — it both populates the
  // __gate_1_suggested_revision scratch slot AND lets us inspect whether
  // any planning findings exist (revision string is non-empty when at
  // least one open planning finding is present).
  const gate = requireGate(ctx.registry, gateName);
  await Promise.resolve(gate.message(state));
  const revision = state.scratch["__gate_1_suggested_revision"] as string | undefined;
  if (!revision || revision.trim().length === 0) return null;
  // Only auto-replan on BLOCKING findings — the suggested-revision header
  // shows severity (BLOCKING/WARN/INFO). Skip warn/info loops to avoid
  // burning the cap on minor stylistic suggestions.
  if (!/\(BLOCKING,/.test(revision)) return null;
  const used = (state.scratch[AUTO_REPLAN_COUNT_KEY] as number | undefined) ?? 0;
  if (used >= cap) return null;
  state.scratch[AUTO_REPLAN_COUNT_KEY] = used + 1;
  // Synthesize a reject decision so mirrorGateDecision (called when the
  // FSM re-enters this step after the walk-back) updates pipeline-state.
  // We DON'T set state.scratch["gate-1_decision"] here — we set step_index
  // back to PLAN and let the impl flow loop. The revision text is already
  // stashed; subsequent passes through plan-review will see updated
  // findings.
  await audit({
    tool: "pipeline_auto_replan",
    args: {
      task_id: state.task_id,
      attempt: used + 1,
      cap,
      feedback_excerpt: revision.split("\n").slice(0, 3).join(" | ").slice(0, 200),
    },
    projectDir: state.project_dir,
    verdict: "ok",
    error_class: "auto-replan",
  }).catch(() => undefined);
  // Walk back to PLAN step. Find the planner step in the active flow.
  const flow = requireFlow(ctx.registry, state.flow_name);
  const planIdx = flow.steps.indexOf("plan");
  if (planIdx < 0) return null;
  // Clear plan-review fan-out markers so the second pass re-spawns.
  for (const key of Object.keys(state.scratch)) {
    if (key.startsWith("__spawn_issued_")) delete state.scratch[key];
  }
  delete state.scratch[PLAN_REVIEW_ISSUED_KEY];
  // Pre-bump: runFSM increments after "advance" so set to (planIdx - 1).
  state.step_index = planIdx - 1;
  return { type: "advance" };
}

const GATE_0_STEP = gateStep("gate-0", "gate-0", "context");
const GATE_1_STEP = gateStep("gate-1", "gate-1", "planning", undefined, gate1AutoReplanPreAsk);
const GATE_2_STEP = gateStep("gate-2", "gate-2", "validation", gate2Resume);

const ENRICH: StepPlugin = {
  name: "enrich",
  phase: "context",
  async run(state, ctx) {
    return spawnOne(state, ctx, "code-analyzer", "context", "enrich");
  },
};

const CONTEXT_VERIFY: StepPlugin = {
  name: "context-verify",
  phase: "context",
  async run(state, ctx) {
    if (state.decisions["complexity"] === "simple") return { type: "advance" };
    return spawnOne(state, ctx, "context-doc-verifier", "context", "context-verify");
  },
};

const ARCHITECT_STEP: StepPlugin = {
  name: "architect",
  phase: "context",
  async run(state, ctx) {
    if (state.decisions["complexity"] !== "complex") return { type: "advance" };
    return spawnOne(state, ctx, "architect", "context", "architect");
  },
};

const PLAN: StepPlugin = {
  name: "plan",
  phase: "planning",
  async run(state, ctx) {
    return spawnOne(state, ctx, "planner", "planning", "plan");
  },
};

const PLAN_GROUNDING: StepPlugin = {
  name: "plan-grounding",
  phase: "planning",
  async run(state, ctx) {
    // D6 / Q67: MEDIUM + COMPLEX flows merged plan-grounding into the
    // PLAN_REVIEW fan-out for parallel execution. SIMPLE keeps the
    // standalone step (only one agent runs at planning gate-1 in SIMPLE).
    if (state.decisions["complexity"] !== "simple") return { type: "advance" };
    return spawnOne(state, ctx, "plan-grounding-check", "planning", "plan-grounding");
  },
};

const PLAN_REVIEW_AGENTS = ["plan-grounding-check", "logic-reviewer"] as const;
const PLAN_REVIEW_ISSUED_KEY = "__plan_review_agents_issued";

/**
 * D6 / Q67: planning-phase reviewers fan out in parallel. Before D6:
 * PLAN_GROUNDING and PLAN_REVIEW fired as two separate FSM steps → two
 * shuttle round-trips, serialized LLM execution. After D6: MEDIUM +
 * COMPLEX fans out [plan-grounding-check, logic-reviewer] via
 * spawnAgentsParallel; SIMPLE keeps the standalone plan-grounding +
 * plan-review path. Resume short-circuit mirrors the impl REVIEW pattern.
 */
const PLAN_REVIEW: StepPlugin = {
  name: "plan-review",
  phase: "planning",
  async run(state, ctx) {
    if (state.decisions["complexity"] === "simple") {
      // SIMPLE: plan-grounding ran separately; PLAN_REVIEW emits a single
      // logic-reviewer spawn (today's pre-D6 behavior).
      return spawnOne(state, ctx, "logic-reviewer", "planning", "plan-review");
    }
    // Resume short-circuit. continue-task increments step_index once on
    // agents-results; if the FSM re-enters this step with all results
    // staged in scratch, advance.
    const issuedIds = state.scratch[PLAN_REVIEW_ISSUED_KEY] as string[] | undefined;
    if (issuedIds && issuedIds.length > 0) {
      const allDone = issuedIds.every(
        (id) => state.scratch[SPAWN_RESULT_KEY(id)] !== undefined,
      );
      if (allDone) {
        delete state.scratch[PLAN_REVIEW_ISSUED_KEY];
        return { type: "advance" };
      }
    }
    const eligible: AgentPlugin[] = [];
    for (const name of PLAN_REVIEW_AGENTS) {
      const agent = ctx.registry.agents.get(name);
      if (!agent) continue;
      if (agent.applies_to && !agent.applies_to(state)) continue;
      eligible.push(agent);
    }
    if (eligible.length === 0) return { type: "advance" };
    if (eligible.length === 1) {
      return spawnOne(state, ctx, eligible[0].name, "planning", "plan-review");
    }
    await closePriorPhases(state, "planning");
    const provider = requireSpawnProvider(ctx.registry);
    const config = (state.scratch.config as any) ?? defaultConfig;
    const teamKnowledge = await loadTeamKnowledgeForSpawn(state);
    const newIssuedIds: string[] = [];
    const spawns: Array<{
      agent_run_id: string;
      agent: string;
      spawn_request: SpawnRequest;
    }> = [];
    for (const agent of eligible) {
      const model = resolveAgentModel(agent, "planning", config);
      const agent_run_id = await ctx.beginSpawn(agent.name, "planning", model);
      newIssuedIds.push(agent_run_id);
      const result = await provider.spawn({
        agent: agent.name,
        agent_run_id,
        driver_state_id: state.driver_state_id,
        phase: "planning",
        model,
        template_path: agent.template_path,
        prompt: `Spawn agent: ${agent.name}. Project: ${state.project_dir}. Task: ${state.task}.`,
        team_knowledge: teamKnowledge,
      });
      if (result.type !== "shuttle" || result.response.status !== "spawn-agent") {
        throw new Error(
          `plan-review fan-out: spawn provider returned unexpected shape for ${agent.name}`,
        );
      }
      spawns.push({
        agent_run_id,
        agent: agent.name,
        spawn_request: result.response.spawn_request,
      });
    }
    state.scratch[PLAN_REVIEW_ISSUED_KEY] = newIssuedIds;
    return {
      type: "shuttle",
      response: spawnAgentsParallel(state.driver_state_id, spawns),
    };
  },
};

const TEST_FIRST: StepPlugin = {
  name: "test-first",
  phase: "test_first",
  async run(state, ctx) {
    if (state.decisions["tests_mode"] !== "tdd") return { type: "advance" };
    return spawnOne(state, ctx, "test", "test_first", "test-first");
  },
};

const GIT_STASH: StepPlugin = {
  name: "git-stash",
  phase: "implementation",
  async run() {
    return { type: "advance" };
  },
};

const IMPLEMENT: StepPlugin = {
  name: "implement",
  phase: "implementation",
  async run(state, ctx) {
    return spawnOne(state, ctx, "implementer", "implementation", "implement");
  },
};

const GIT_DIFF: StepPlugin = {
  name: "git-diff",
  phase: "implementation",
  async run() {
    return { type: "advance" };
  },
};

const PRE_REVIEW: StepPlugin = {
  name: "pre-review",
  phase: "implementation",
  async run(state, ctx) {
    // Q9: invoke security_needed / ui_touched / api_touched BEFORE the review
    // step decides which reviewers to fan out to. Their DecisionPlugins were
    // registered but never called, so applies_to predicates on the gated
    // reviewers always saw `undefined` and the reviewers never spawned.
    // pre-review runs in the implementation phase, AFTER git-diff captured
    // the change set — so diff-aware predicates (ui_touched, api_touched)
    // can see scratch.diff_text when it's populated.
    for (const name of ["security_needed", "ui_touched", "api_touched"] as const) {
      const value = await Promise.resolve(
        requireDecision<boolean>(ctx.registry, name).decide(state),
      );
      state.decisions[name] = value;
    }
    return { type: "advance" };
  },
};

/**
 * Q9: fan out the implementation review to all eligible reviewer agents
 * (logic + challenger + style + security + performance). Filter via each
 * AgentPlugin's `applies_to` predicate so security only fires when
 * security_needed=true, etc. SIMPLE flow keeps the single-reviewer path
 * (logic-reviewer only) so the existing smoke-orchestrator resume contract
 * doesn't change.
 */
const REVIEW_FANOUT_AGENTS = [
  "logic-reviewer",
  "challenger-reviewer",
  "style-reviewer",
  "security",
  "performance",
] as const;

const REVIEW_ISSUED_KEY = "__review_agents_issued";

const REVIEW: StepPlugin = {
  name: "review",
  phase: "implementation",
  async run(state, ctx) {
    const complexity = state.decisions["complexity"] as string | undefined;
    if (complexity === "simple") {
      return spawnOne(state, ctx, "logic-reviewer", "implementation", "review");
    }
    // Resume short-circuit. continue-task increments step_index once on
    // agents-results, but if the FSM re-enters this step with results
    // already staged in scratch, just advance.
    const issuedIds = state.scratch[REVIEW_ISSUED_KEY] as string[] | undefined;
    if (issuedIds && issuedIds.length > 0) {
      const allDone = issuedIds.every(
        (id) => state.scratch[SPAWN_RESULT_KEY(id)] !== undefined,
      );
      if (allDone) {
        delete state.scratch[REVIEW_ISSUED_KEY];
        return { type: "advance" };
      }
    }
    // D2: change_kind from classifier-output (when populated by D1's hook).
    // null/undefined → spawn all relevant reviewers (today's behavior).
    const changeKind = state.decisions["change_kind"];
    const changeKindKnown = typeof changeKind === "string" && changeKind.length > 0;
    const eligible: AgentPlugin[] = [];
    for (const name of REVIEW_FANOUT_AGENTS) {
      const agent = ctx.registry.agents.get(name);
      if (!agent) continue;
      if (agent.applies_to && !agent.applies_to(state)) continue;
      if (
        changeKindKnown &&
        Array.isArray(agent.relevant_for_change_kinds) &&
        !agent.relevant_for_change_kinds.includes(changeKind as string)
      ) {
        // D2: audit the skip so post-hoc analysis can quantify token savings.
        await audit({
          tool: "pipeline_review_fanout",
          args: {
            task_id: state.task_id,
            agent: agent.name,
            change_kind: changeKind,
            relevant_for_change_kinds: agent.relevant_for_change_kinds,
          },
          projectDir: state.project_dir,
          verdict: "ok",
          error_class: "reviewer-skipped-change-kind",
        }).catch(() => undefined);
        continue;
      }
      eligible.push(agent);
    }
    if (eligible.length === 0) return { type: "advance" };
    if (eligible.length === 1) {
      return spawnOne(state, ctx, eligible[0].name, "implementation", "review");
    }
    await closePriorPhases(state, "implementation");
    const provider = requireSpawnProvider(ctx.registry);
    const config = (state.scratch.config as any) ?? defaultConfig;
    const teamKnowledge = await loadTeamKnowledgeForSpawn(state);
    const newIssuedIds: string[] = [];
    const spawns: Array<{
      agent_run_id: string;
      agent: string;
      spawn_request: SpawnRequest;
    }> = [];
    for (const agent of eligible) {
      const model = resolveAgentModel(agent, "implementation", config);
      const agent_run_id = await ctx.beginSpawn(agent.name, "implementation", model);
      newIssuedIds.push(agent_run_id);
      const result = await provider.spawn({
        agent: agent.name,
        agent_run_id,
        driver_state_id: state.driver_state_id,
        phase: "implementation",
        model,
        template_path: agent.template_path,
        prompt: `Spawn agent: ${agent.name}. Project: ${state.project_dir}. Task: ${state.task}.`,
        team_knowledge: teamKnowledge,
      });
      if (result.type !== "shuttle" || result.response.status !== "spawn-agent") {
        throw new Error(
          `review fan-out: spawn provider returned unexpected shape for ${agent.name}`,
        );
      }
      spawns.push({
        agent_run_id,
        agent: agent.name,
        spawn_request: result.response.spawn_request,
      });
    }
    state.scratch[REVIEW_ISSUED_KEY] = newIssuedIds;
    return {
      type: "shuttle",
      response: spawnAgentsParallel(state.driver_state_id, spawns),
    };
  },
};

const RECONCILE: StepPlugin = {
  name: "reconcile",
  phase: "implementation",
  async run() {
    return { type: "advance" };
  },
};

const ITERATE: StepPlugin = {
  name: "iterate",
  phase: "implementation",
  async run() {
    return { type: "advance" };
  },
};

const SACRED_TESTS: StepPlugin = {
  name: "sacred-tests",
  phase: "implementation",
  async run(state) {
    if (state.decisions["tests_mode"] !== "tdd") return { type: "advance" };
    return { type: "advance" };
  },
};

const FINAL_CHECKS: StepPlugin = {
  name: "final-checks",
  phase: "validation",
  async run(state, ctx) {
    return spawnOne(state, ctx, "acceptance", "validation", "final-checks");
  },
};

const TEST_VERIFY: StepPlugin = {
  name: "test-verify",
  phase: "validation",
  async run() {
    return { type: "advance" };
  },
};

const FINALIZE: StepPlugin = {
  name: "finalize",
  phase: "final",
  async run(state) {
    // Close every prior phase before declaring the task complete.
    await closePriorPhases(state, "final");
    // Q74 (D13): never default verdict to "accepted" at FINALIZE. gate-2's
    // resume handler is the only legitimate origin of state.verdict — accept
    // sets it to "accepted", reject_intent=abandon sets it to "rejected",
    // reject_intent=revise walks step_index back and never reaches FINALIZE.
    // Reaching FINALIZE with verdict=null means the FSM is in an inconsistent
    // state — throw instead of silently shipping with verdict="accepted".
    if (state.verdict === null) {
      throw new Error(
        "INV_inconsistent-finalize: state.verdict is null at FINALIZE — gate-2 resume should have set it before the FSM reached this step",
      );
    }
    state.complete = true;
    return {
      type: "halt",
      response: complete(
        state.task_id,
        state.verdict,
        `Task complete (verdict=${state.verdict}, complexity=${state.decisions["complexity"]})`,
      ),
    };
  },
};

export const BUILTIN_STEPS: StepPlugin[] = [
  INITIALIZE,
  CLASSIFY,
  CLASSIFY_AGENT,
  GATE_0_STEP,
  GATE_1_STEP,
  GATE_2_STEP,
  ENRICH,
  CONTEXT_VERIFY,
  ARCHITECT_STEP,
  PLAN,
  PLAN_GROUNDING,
  PLAN_REVIEW,
  TEST_FIRST,
  GIT_STASH,
  IMPLEMENT,
  GIT_DIFF,
  PRE_REVIEW,
  REVIEW,
  RECONCILE,
  ITERATE,
  SACRED_TESTS,
  FINAL_CHECKS,
  TEST_VERIFY,
  FINALIZE,
];
