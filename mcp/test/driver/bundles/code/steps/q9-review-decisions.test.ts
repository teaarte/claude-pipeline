/**
 * Q9: PRE_REVIEW step invokes the three previously-orphaned decisions
 * (security_needed, ui_touched, api_touched) so the REVIEW step's
 * applies_to-gated reviewer fan-out has the values it needs to spawn the
 * right reviewers. REVIEW step fans out to all eligible reviewers via
 * spawn-agents-parallel for non-simple flows.
 */

import { describe, it, expect } from "vitest";
import { BUILTIN_STEPS } from "../../../../../src/driver/bundles/code/steps/index.js";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import { tempProject } from "../../../../helpers/setup.js";
import type {
  DriverState,
  StepContext,
  AgentSpawnRequest,
  SpawnProviderPlugin,
  StepResult,
} from "../../../../../src/driver/types/plugin.js";
import { spawnAgent } from "../../../../../src/driver/core/shuttle.js";

const PRE_REVIEW = BUILTIN_STEPS.find((s) => s.name === "pre-review")!;
const REVIEW = BUILTIN_STEPS.find((s) => s.name === "review")!;

function mockProvider(): SpawnProviderPlugin {
  return {
    name: "mock",
    async spawn(req: AgentSpawnRequest): Promise<StepResult> {
      return {
        type: "shuttle",
        response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
          subagent_type: "general-purpose",
          description: `mock ${req.agent}`,
          prompt: "mock",
          model: req.model,
        }),
      };
    },
  };
}

async function makeCtx(stateForBeginSpawn?: DriverState): Promise<StepContext> {
  const registry = createRegistry();
  await loadBundle("code", registry);
  registry.spawn_provider = mockProvider();
  let counter = 0;
  return {
    registry,
    async beginSpawn(_a, _p) {
      counter++;
      const id = `ar-test-${String(counter).padStart(12, "0")}`;
      if (stateForBeginSpawn) {
        stateForBeginSpawn.pending_spawns[id] = {
          agent: _a,
          phase: _p,
          started_at: new Date().toISOString(),
        };
      }
      return id;
    },
  };
}

describe("Q9: pre-review wires missing decisions", () => {
  it("populates security_needed / ui_touched / api_touched in state.decisions", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "Add JWT auth-token decoder with session refresh",
        flow_name: "medium",
      });
      state.decisions["complexity"] = "medium";
      const ctx = await makeCtx();
      const result = await PRE_REVIEW.run(state, ctx);
      expect(result.type).toBe("advance");
      expect(typeof state.decisions["security_needed"]).toBe("boolean");
      expect(typeof state.decisions["ui_touched"]).toBe("boolean");
      expect(typeof state.decisions["api_touched"]).toBe("boolean");
    } finally {
      await proj.cleanup();
    }
  });

  it("security_needed=true when the classifier-agent has populated state.decisions.security_needed (item 9)", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "Add JWT auth-token decoder",
        flow_name: "medium",
      });
      state.decisions["complexity"] = "medium";
      state.decisions["security_needed"] = true; // classifier-agent set this
      const ctx = await makeCtx();
      await PRE_REVIEW.run(state, ctx);
      expect(state.decisions["security_needed"]).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  it("security_needed=false on a non-security task with no auth-touching diff", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "Refactor button colors to use the theme",
        flow_name: "medium",
      });
      state.decisions["complexity"] = "medium";
      const ctx = await makeCtx();
      await PRE_REVIEW.run(state, ctx);
      expect(state.decisions["security_needed"]).toBe(false);
    } finally {
      await proj.cleanup();
    }
  });
});

describe("Q9: review step fan-out", () => {
  it("simple flow → single logic-reviewer spawn (existing single-spawn shuttle)", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "rename foo to bar",
        flow_name: "simple",
      });
      state.decisions["complexity"] = "simple";
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("spawn-agent");
        if (result.response.status === "spawn-agent") {
          expect(result.response.agent).toBe("logic-reviewer");
        }
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("medium flow with security_needed=true → fan-out includes security reviewer", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "Add JWT auth-token decoder",
        flow_name: "medium",
      });
      state.decisions["complexity"] = "medium";
      state.decisions["security_needed"] = true;
      state.decisions["ui_touched"] = false;
      state.decisions["api_touched"] = false;
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("spawn-agents-parallel");
        if (result.response.status === "spawn-agents-parallel") {
          const agents = result.response.spawns.map((s) => s.agent);
          expect(agents).toContain("logic-reviewer");
          expect(agents).toContain("challenger-reviewer");
          expect(agents).toContain("style-reviewer");
          expect(agents).toContain("security");
          expect(agents).toContain("performance");
        }
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("medium flow with security_needed=false → fan-out excludes security reviewer", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "Refactor button colors",
        flow_name: "medium",
      });
      state.decisions["complexity"] = "medium";
      state.decisions["security_needed"] = false;
      state.decisions["ui_touched"] = false;
      state.decisions["api_touched"] = false;
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle") {
        expect(result.response.status).toBe("spawn-agents-parallel");
        if (result.response.status === "spawn-agents-parallel") {
          const agents = result.response.spawns.map((s) => s.agent);
          expect(agents).not.toContain("security");
          expect(agents).toContain("logic-reviewer");
        }
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("medium fan-out registers per-agent ids in pending_spawns and stores them in scratch", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "Add JWT auth-token decoder",
        flow_name: "medium",
      });
      state.decisions["complexity"] = "medium";
      state.decisions["security_needed"] = true;
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      const issued = state.scratch["__review_agents_issued"] as string[];
      expect(Array.isArray(issued)).toBe(true);
      expect(issued.length).toBeGreaterThan(1);
      for (const id of issued) {
        expect(state.pending_spawns[id]).toBeTruthy();
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("medium fan-out advances when all spawned agents have results staged", async () => {
    const proj = await tempProject();
    try {
      const state = makeInitialDriverState({
        project_dir: proj.dir,
        task: "Add JWT auth-token decoder",
        flow_name: "medium",
      });
      state.decisions["complexity"] = "medium";
      state.decisions["security_needed"] = true;
      const ctx = await makeCtx(state);
      // First run issues spawns.
      await REVIEW.run(state, ctx);
      const issued = state.scratch["__review_agents_issued"] as string[];
      // Simulate continue-task delivering all results.
      for (const id of issued) {
        state.scratch[`agent_output_${id}`] = "mock";
      }
      // Second run should advance.
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("advance");
      expect(state.scratch["__review_agents_issued"]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });
});
