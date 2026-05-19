/**
 * Q19 regression — verify that the resolved model from `resolveAgentModel`
 * survives the SpawnRecorder hop and ends up on the open_spawn record.
 * Uses runFSM with an injected SpawnRecorder that captures req.model so we
 * don't need a full pipeline-state for the assertion.
 */

import { describe, it, expect } from "vitest";
import { createRegistry } from "../../../src/driver/core/registry.js";
import { runFSM, type SpawnRecorder } from "../../../src/driver/core/fsm.js";
import { makeInitialDriverState } from "../../../src/driver/core/state.js";
import { loadBundle } from "../../../src/driver/loaders/bundles.js";
import { spawnAgent } from "../../../src/driver/core/shuttle.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSpawnRequest,
  SpawnProviderPlugin,
  StepResult,
} from "../../../src/driver/types/plugin.js";

describe("Q19 — SpawnRecorder threads resolved model", () => {
  it("first spawn in the simple flow records the planner's default model on the recorder request", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q19-"));
    try {
      const captured: { agent: string; model: unknown }[] = [];
      const recorder: SpawnRecorder = async (req) => {
        captured.push({ agent: req.agent, model: req.model ?? null });
        return { agent_run_id: `ar-test-${captured.length}` };
      };

      const noopProvider: SpawnProviderPlugin = {
        name: "noop",
        async spawn(req: AgentSpawnRequest): Promise<StepResult> {
          return {
            type: "shuttle",
            response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
              subagent_type: "general-purpose",
              description: req.agent,
              prompt: req.prompt,
              model: req.model,
            }),
          };
        },
      };

      const registry = createRegistry();
      await loadBundle("code", registry);
      registry.spawn_provider = noopProvider;

      const state = makeInitialDriverState({
        project_dir: project,
        task: "rename foo",
        flow_name: "simple",
      });
      state.scratch.complexity = "simple";
      state.decisions["complexity"] = "simple";
      state.decisions["tests_mode"] = "regression-only";
      // D1: pre-populate task_short so CLASSIFY_AGENT short-circuits its
      // spawn-and-parse; this test only cares about the first SUBSTANTIVE
      // spawn (planner), not the classifier-agent spawn.
      state.decisions["task_short"] = "rename-foo";

      const { response } = await runFSM(state, registry, { spawnRecorder: recorder });

      expect(response.status).toBe("spawn-agent");
      expect(captured.length).toBe(1);
      // planner's default_model is "opus" (mcp/src/driver/bundles/code/agents/index.ts).
      expect(captured[0]).toEqual({ agent: "planner", model: "opus" });
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("falls back to null when no SpawnRecorder is injected — pending_spawns still records model: null", async () => {
    const project = await mkdtemp(join(tmpdir(), "cp-q19-noinject-"));
    try {
      const registry = createRegistry();
      await loadBundle("code", registry);
      registry.spawn_provider = {
        name: "noop",
        async spawn(req) {
          return {
            type: "shuttle",
            response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
              subagent_type: "general-purpose",
              description: req.agent,
              prompt: req.prompt,
              model: req.model,
            }),
          };
        },
      };

      const state = makeInitialDriverState({
        project_dir: project,
        task: "x",
        flow_name: "simple",
      });
      state.scratch.complexity = "simple";
      state.decisions["complexity"] = "simple";
      state.decisions["tests_mode"] = "regression-only";
      // D1: pre-populate task_short to skip CLASSIFY_AGENT's classifier spawn.
      state.decisions["task_short"] = "noop";

      const { state: out, response } = await runFSM(state, registry);
      expect(response.status).toBe("spawn-agent");
      if (response.status === "spawn-agent") {
        const pending = out.pending_spawns[response.agent_run_id];
        expect(pending).toBeTruthy();
        // No recorder + no test-side passthrough = falls through to in-memory mint;
        // model still threads in from steps/index.ts (planner default = opus).
        expect(pending.model).toBe("opus");
      }
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
