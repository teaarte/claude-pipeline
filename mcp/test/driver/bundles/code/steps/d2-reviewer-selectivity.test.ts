/**
 * D2 / Q-change-kind-selectivity regression: REVIEW step consults each
 * AgentPlugin's relevant_for_change_kinds against state.decisions.change_kind
 * (populated by D1's extract-classifier-output hook). Conservative defaults:
 *
 *  - change_kind null/undefined → spawn ALL eligible reviewers (today's
 *    behavior; the selectivity is opt-in optimization, never a silent skip).
 *  - change_kind set to a value NOT in an agent's relevant_for_change_kinds
 *    → skip that agent (audit row "reviewer-skipped-change-kind").
 *
 * Real-task driver: frontend-core 2026-05-18 spawned style-reviewer +
 * performance on a type-only TS diff; both returned 0 findings. Skipping
 * saves ~10K tokens/task on the wrong change_kind.
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

const REVIEW = BUILTIN_STEPS.find((s) => s.name === "review")!;

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
      const id = `ar-d2-${String(counter).padStart(12, "0")}`;
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

function baseState(projectDir: string): DriverState {
  const s = makeInitialDriverState({
    project_dir: projectDir,
    task: "type-only TS rename",
    flow_name: "medium",
  });
  s.decisions["complexity"] = "medium";
  s.decisions["security_needed"] = false;
  s.decisions["ui_touched"] = false;
  s.decisions["api_touched"] = false;
  return s;
}

describe("D2 — REVIEW step filters by change_kind", () => {
  it("change_kind='type-only' skips style + performance (frontend-core 2026-05-18)", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      state.decisions["change_kind"] = "type-only";
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agents-parallel") {
        const agents = result.response.spawns.map((s) => s.agent);
        expect(agents).not.toContain("style-reviewer");
        expect(agents).not.toContain("performance");
        // Generalist reviewers still spawn.
        expect(agents).toContain("logic-reviewer");
        expect(agents).toContain("challenger-reviewer");
      } else if (result.type === "shuttle" && result.response.status === "spawn-agent") {
        // Only one eligible after filtering — single-spawn path is valid.
        expect(result.response.agent).not.toBe("style-reviewer");
        expect(result.response.agent).not.toBe("performance");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("change_kind='ui' keeps style-reviewer in the fan-out", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      state.decisions["change_kind"] = "ui";
      state.decisions["ui_touched"] = true;
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agents-parallel") {
        const agents = result.response.spawns.map((s) => s.agent);
        expect(agents).toContain("style-reviewer");
        expect(agents).toContain("logic-reviewer");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("change_kind=null → spawns ALL eligible reviewers (conservative default)", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      // Explicit null — classifier ran but couldn't pick a kind.
      state.decisions["change_kind"] = null;
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agents-parallel") {
        const agents = result.response.spawns.map((s) => s.agent);
        // null change_kind matches "spawn all" — selectivity is opt-in.
        expect(agents).toContain("style-reviewer");
        expect(agents).toContain("performance");
        expect(agents).toContain("logic-reviewer");
        expect(agents).toContain("challenger-reviewer");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("change_kind undefined → spawns ALL eligible reviewers (classifier didn't run)", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      // change_kind never set.
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agents-parallel") {
        const agents = result.response.spawns.map((s) => s.agent);
        expect(agents).toContain("style-reviewer");
        expect(agents).toContain("performance");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("change_kind='docs-only' skips style + performance (both gated)", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      state.decisions["change_kind"] = "docs-only";
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agents-parallel") {
        const agents = result.response.spawns.map((s) => s.agent);
        expect(agents).not.toContain("style-reviewer");
        expect(agents).not.toContain("performance");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("change_kind='security-sensitive' keeps security + style", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      state.decisions["change_kind"] = "security-sensitive";
      state.decisions["security_needed"] = true;
      const ctx = await makeCtx(state);
      const result = await REVIEW.run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agents-parallel") {
        const agents = result.response.spawns.map((s) => s.agent);
        expect(agents).toContain("security");
        expect(agents).toContain("style-reviewer");
      }
    } finally {
      await proj.cleanup();
    }
  });
});
