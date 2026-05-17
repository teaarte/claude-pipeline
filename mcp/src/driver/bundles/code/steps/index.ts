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
  ClaudeCodeTaskSpec,
  UserAnswer,
} from "../../../types/plugin.js";
import { askUser, complete, spawnAgentsParallel } from "../../../core/shuttle.js";
import { requireGate, requireDecision, requireSpawnProvider, requireAgent } from "../../../core/registry.js";
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
 * Item 9 substrate (classifier-agent + schema + pickFromCandidates) is in
 * place; auto-spawning the classifier inside this step would break every
 * test that drives the FSM without a real LLM. That wiring lands when the
 * v2.3 daemon arrives — it has `query()` and can call pickFromCandidates
 * synchronously without the shuttle's spawn/pause/resume dance.
 *
 * For now, CLASSIFY runs the deterministic decisions (complexity,
 * tests_mode). Refs / security_needed / antipattern_rules_applicable are
 * read directly from `state.decisions` by their pure-getter decision
 * plugins — populated externally (test setup OR future classifier-step).
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

function gateStep(name: string, gateName: string, phase: StepPlugin["phase"]): StepPlugin {
  return {
    name,
    phase,
    async run(state, ctx) {
      // Resume: if pipeline_continue_task already routed in a user-answer
      // for this gate, advance — but first mirror the decision to canonical
      // pipeline-state.gates (Q8).
      if (state.scratch[`${gateName}_decision`] !== undefined) {
        await mirrorGateDecision(state, ctx.registry, gateName);
        return { type: "advance" };
      }
      // Close any prior phases (idempotent) before pausing for the human.
      await closePriorPhases(state, phase);
      const gate = requireGate(ctx.registry, gateName);
      const msg = gate.message(state);
      state.pending_user_answer = { gate: gateName, message: msg };
      return { type: "shuttle", response: askUser(state.driver_state_id, gateName, msg) };
    },
  };
}

const GATE_0_STEP = gateStep("gate-0", "gate-0", "context");
const GATE_1_STEP = gateStep("gate-1", "gate-1", "planning");
const GATE_2_STEP = gateStep("gate-2", "gate-2", "validation");

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
    if (state.decisions["complexity"] === "simple") return { type: "advance" };
    return spawnOne(state, ctx, "plan-grounding-check", "planning", "plan-grounding");
  },
};

const PLAN_REVIEW: StepPlugin = {
  name: "plan-review",
  phase: "planning",
  async run(state, ctx) {
    if (state.decisions["complexity"] === "simple") return { type: "advance" };
    return spawnOne(state, ctx, "logic-reviewer", "planning", "plan-review");
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
  async run(state) {
    state.scratch.git_stash_done = true;
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
  async run(state) {
    state.scratch.git_diff_captured = true;
    return { type: "advance" };
  },
};

const PRE_REVIEW: StepPlugin = {
  name: "pre-review",
  phase: "implementation",
  async run(state, ctx) {
    state.scratch.pre_review_done = true;
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
    const eligible: AgentPlugin[] = [];
    for (const name of REVIEW_FANOUT_AGENTS) {
      const agent = ctx.registry.agents.get(name);
      if (!agent) continue;
      if (agent.applies_to && !agent.applies_to(state)) continue;
      eligible.push(agent);
    }
    if (eligible.length === 0) return { type: "advance" };
    if (eligible.length === 1) {
      return spawnOne(state, ctx, eligible[0].name, "implementation", "review");
    }
    await closePriorPhases(state, "implementation");
    const provider = requireSpawnProvider(ctx.registry);
    const config = (state.scratch.config as any) ?? defaultConfig;
    const newIssuedIds: string[] = [];
    const spawns: Array<{
      agent_run_id: string;
      agent: string;
      claude_code_task: ClaudeCodeTaskSpec;
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
      });
      if (result.type !== "shuttle" || result.response.status !== "spawn-agent") {
        throw new Error(
          `review fan-out: spawn provider returned unexpected shape for ${agent.name}`,
        );
      }
      spawns.push({
        agent_run_id,
        agent: agent.name,
        claude_code_task: result.response.claude_code_task,
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
  async run(state) {
    state.scratch.reconcile_done = true;
    return { type: "advance" };
  },
};

const ITERATE: StepPlugin = {
  name: "iterate",
  phase: "implementation",
  async run(state) {
    state.scratch.iterate_decided = true;
    return { type: "advance" };
  },
};

const SACRED_TESTS: StepPlugin = {
  name: "sacred-tests",
  phase: "implementation",
  async run(state) {
    if (state.decisions["tests_mode"] !== "tdd") return { type: "advance" };
    state.scratch.sacred_tests_rehashed = true;
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
  async run(state) {
    state.scratch.test_verify_done = true;
    return { type: "advance" };
  },
};

const FINALIZE: StepPlugin = {
  name: "finalize",
  phase: "final",
  async run(state) {
    // Close every prior phase before declaring the task complete.
    await closePriorPhases(state, "final");
    state.complete = true;
    state.verdict = state.verdict ?? "accepted";
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
