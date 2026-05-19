/**
 * D6 / Q67 regression: planning-phase reviewers fan out in parallel.
 *
 * Before D6: PLAN_GROUNDING and PLAN_REVIEW fired as two separate FSM
 * steps — two shuttle round-trips, serialized LLM execution at planning.
 * After D6: MEDIUM + COMPLEX flows merge plan-grounding into PLAN_REVIEW's
 * spawnAgentsParallel fan-out; SIMPLE flow keeps the standalone
 * plan-grounding step (only one agent at planning gate-1 in SIMPLE).
 */

import { describe, it, expect } from "vitest";
import { BUILTIN_STEPS } from "../../../../../src/driver/bundles/code/steps/index.js";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import { tempProject } from "../../../../helpers/setup.js";
import { spawnAgent } from "../../../../../src/driver/core/shuttle.js";
import type {
  AgentSpawnRequest,
  DriverState,
  SpawnProviderPlugin,
  StepContext,
  StepResult,
} from "../../../../../src/driver/types/plugin.js";

const PLAN_REVIEW = BUILTIN_STEPS.find((s) => s.name === "plan-review")!;

function mockProvider(): SpawnProviderPlugin {
  return {
    name: "mock",
    async spawn(req: AgentSpawnRequest): Promise<StepResult> {
      return {
        type: "shuttle",
        response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
          runner_hint: "claude-code-task",
          description: `mock ${req.agent}`,
          prompt: "mock",
          model: req.model,
          extras: { subagent_type: "general-purpose" },
        }),
      };
    },
  };
}

async function makeCtx(state?: DriverState): Promise<StepContext> {
  const reg = createRegistry();
  await loadBundle("code", reg);
  reg.spawn_provider = mockProvider();
  let counter = 0;
  return {
    registry: reg,
    async beginSpawn(agent, phase) {
      counter++;
      const id = `ar-d6-${String(counter).padStart(12, "0")}`;
      if (state) {
        state.pending_spawns[id] = {
          agent,
          phase,
          started_at: new Date().toISOString(),
        };
      }
      return id;
    },
  };
}

function mediumState(projectDir: string): DriverState {
  const s = makeInitialDriverState({
    project_dir: projectDir,
    task: "plan-review fan-out probe",
    flow_name: "medium",
  });
  s.decisions["complexity"] = "medium";
  s.decisions["tests_mode"] = "regression-only";
  return s;
}

describe("D6 / Q67 — plan-review step fan-out", () => {
  it("MEDIUM flow → fans out [plan-grounding-check, logic-reviewer] in parallel", async () => {
    const proj = await tempProject();
    try {
      const state = mediumState(proj.dir);
      const ctx = await makeCtx(state);
      const result = await PLAN_REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("spawn-agents-parallel");
        if (result.response.status === "spawn-agents-parallel") {
          const agents = result.response.spawns.map((s) => s.agent);
          expect(agents).toContain("plan-grounding-check");
          expect(agents).toContain("logic-reviewer");
          expect(agents.length).toBe(2);
        }
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("COMPLEX flow → same parallel fan-out shape", async () => {
    const proj = await tempProject();
    try {
      const state = mediumState(proj.dir);
      state.decisions["complexity"] = "complex";
      state.flow_name = "complex";
      const ctx = await makeCtx(state);
      const result = await PLAN_REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agents-parallel") {
        const agents = result.response.spawns.map((s) => s.agent);
        expect(agents).toContain("plan-grounding-check");
        expect(agents).toContain("logic-reviewer");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("registers per-agent ids in pending_spawns + scratch __plan_review_agents_issued", async () => {
    const proj = await tempProject();
    try {
      const state = mediumState(proj.dir);
      const ctx = await makeCtx(state);
      await PLAN_REVIEW.run(state, ctx);
      const issued = state.scratch["__plan_review_agents_issued"] as string[];
      expect(Array.isArray(issued)).toBe(true);
      expect(issued.length).toBe(2);
      for (const id of issued) {
        expect(state.pending_spawns[id]).toBeTruthy();
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("advances when all spawned agents have results staged (resume short-circuit)", async () => {
    const proj = await tempProject();
    try {
      const state = mediumState(proj.dir);
      const ctx = await makeCtx(state);
      await PLAN_REVIEW.run(state, ctx);
      const issued = state.scratch["__plan_review_agents_issued"] as string[];
      for (const id of issued) {
        state.scratch[`agent_output_${id}`] = "mock-result";
      }
      const result = await PLAN_REVIEW.run(state, ctx);
      expect(result.type).toBe("advance");
      expect(state.scratch["__plan_review_agents_issued"]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });

  it("MEDIUM_FLOW step list no longer includes 'plan-grounding' (merged into plan-review)", async () => {
    const proj = await tempProject();
    try {
      const ctx = await makeCtx();
      const flow = ctx.registry.flows.get("medium")!;
      expect(flow.steps).not.toContain("plan-grounding");
      expect(flow.steps).toContain("plan-review");
    } finally {
      await proj.cleanup();
    }
  });

  it("COMPLEX_FLOW step list no longer includes 'plan-grounding'", async () => {
    const proj = await tempProject();
    try {
      const ctx = await makeCtx();
      const flow = ctx.registry.flows.get("complex")!;
      expect(flow.steps).not.toContain("plan-grounding");
      expect(flow.steps).toContain("plan-review");
    } finally {
      await proj.cleanup();
    }
  });

  it("SIMPLE_FLOW keeps standalone plan-grounding (no fan-out — only one agent runs at planning)", async () => {
    const proj = await tempProject();
    try {
      const ctx = await makeCtx();
      const flow = ctx.registry.flows.get("simple")!;
      expect(flow.steps).toContain("plan-grounding");
    } finally {
      await proj.cleanup();
    }
  });
});
