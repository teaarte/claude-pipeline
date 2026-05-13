/**
 * The 17 built-in FSM steps. Each is a small StepPlugin; orchestration
 * choices live here rather than in markdown. The driver core (fsm.ts)
 * runs them in the order specified by the active FlowPlugin.
 *
 * Steps are intentionally simple — most either advance unconditionally (a
 * marker step), branch on a DecisionPlugin, emit an ask-user shuttle (gate
 * steps), or call beginSpawn → return a shuttle response. Real LLM work
 * happens inside spawned agents; steps coordinate them.
 */

import type { StepPlugin, StepResult, DriverState, StepContext } from "../../types/plugin.js";
import { askUser, complete } from "../../core/shuttle.js";
import { requireGate, requireDecision, requireSpawnProvider, requireAgent } from "../../core/registry.js";
import { resolveAgentModel } from "../agents/resolve-model.js";
import { defaultConfig } from "../../types/config.js";

// Helper: spawn one agent through the registered spawn provider.
async function spawnOne(
  state: DriverState,
  ctx: StepContext,
  agentName: string,
): Promise<StepResult> {
  const agent = requireAgent(ctx.registry, agentName);
  if (agent.applies_to && !agent.applies_to(state)) {
    return { type: "advance" };
  }
  const provider = requireSpawnProvider(ctx.registry);
  // Effective model resolution (item 8 user-nudge).
  const config = (state.scratch.config as any) ?? defaultConfig;
  const model = resolveAgentModel(agent, agent.template_path.includes("planner") || agent.template_path.includes("implementer") ? "implementation" : "validation", config);
  // Phase is part of the step's own metadata in real flows; we use the
  // step phase that called us via beginSpawn.
  const phase = state.scratch["__current_phase"] as any ?? "implementation";
  const agent_run_id = await ctx.beginSpawn(agentName, phase);
  return provider.spawn({
    agent: agentName,
    agent_run_id,
    driver_state_id: state.driver_state_id,
    phase,
    model,
    prompt: `Spawn agent: ${agentName}. Project: ${state.project_dir}. Task: ${state.task}.`,
  });
}

const INITIALIZE: StepPlugin = {
  name: "initialize",
  phase: "context",
  async run(state) {
    state.started_at ||= new Date().toISOString();
    return { type: "advance" };
  },
};

const CLASSIFY: StepPlugin = {
  name: "classify",
  phase: "context",
  async run(state, ctx) {
    const complexity = requireDecision<"simple" | "medium" | "complex">(ctx.registry, "complexity").decide(state);
    const tests_mode = requireDecision<"tdd" | "regression-only">(ctx.registry, "tests_mode").decide(state);
    state.decisions["complexity"] = complexity;
    state.decisions["tests_mode"] = tests_mode;
    state.decisions["refs_to_load"] = await Promise.resolve(
      requireDecision<string[]>(ctx.registry, "refs_to_load").decide(state),
    );
    return { type: "advance" };
  },
};

function gateStep(name: string, gateName: string, phase: StepPlugin["phase"]): StepPlugin {
  return {
    name,
    phase,
    async run(state, ctx) {
      // If the user already answered this gate (FSM is being resumed), advance.
      if (state.pending_user_answer === null && state.scratch[`${gateName}_decision`]) {
        return { type: "advance" };
      }
      if (state.pending_user_answer && state.pending_user_answer.gate === gateName) {
        // Awaiting the same gate — re-emit (idempotent).
        return {
          type: "shuttle",
          response: askUser(state.driver_state_id, gateName, state.pending_user_answer.message),
        };
      }
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
    state.scratch["__current_phase"] = "context";
    return spawnOne(state, ctx, "code-analyzer");
  },
};

const CONTEXT_VERIFY: StepPlugin = {
  name: "context-verify",
  phase: "context",
  async run(state, ctx) {
    if (state.decisions["complexity"] === "simple") return { type: "advance" };
    state.scratch["__current_phase"] = "context";
    return spawnOne(state, ctx, "context-doc-verifier");
  },
};

const ARCHITECT_STEP: StepPlugin = {
  name: "architect",
  phase: "context",
  async run(state, ctx) {
    if (state.decisions["complexity"] !== "complex") return { type: "advance" };
    state.scratch["__current_phase"] = "context";
    return spawnOne(state, ctx, "architect");
  },
};

const PLAN: StepPlugin = {
  name: "plan",
  phase: "planning",
  async run(state, ctx) {
    state.scratch["__current_phase"] = "planning";
    return spawnOne(state, ctx, "planner");
  },
};

const PLAN_GROUNDING: StepPlugin = {
  name: "plan-grounding",
  phase: "planning",
  async run(state, ctx) {
    if (state.decisions["complexity"] === "simple") return { type: "advance" };
    state.scratch["__current_phase"] = "planning";
    return spawnOne(state, ctx, "plan-grounding-check");
  },
};

const PLAN_REVIEW: StepPlugin = {
  name: "plan-review",
  phase: "planning",
  async run(state, ctx) {
    if (state.decisions["complexity"] === "simple") return { type: "advance" };
    state.scratch["__current_phase"] = "planning";
    return spawnOne(state, ctx, "logic-reviewer");
  },
};

const TEST_FIRST: StepPlugin = {
  name: "test-first",
  phase: "test_first",
  async run(state, ctx) {
    if (state.decisions["tests_mode"] !== "tdd") return { type: "advance" };
    state.scratch["__current_phase"] = "test_first";
    return spawnOne(state, ctx, "test");
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
    state.scratch["__current_phase"] = "implementation";
    return spawnOne(state, ctx, "implementer");
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
  async run(state) {
    state.scratch.pre_review_done = true;
    return { type: "advance" };
  },
};

const REVIEW: StepPlugin = {
  name: "review",
  phase: "implementation",
  async run(state, ctx) {
    state.scratch["__current_phase"] = "implementation";
    return spawnOne(state, ctx, "logic-reviewer");
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
    state.scratch["__current_phase"] = "validation";
    return spawnOne(state, ctx, "acceptance");
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
