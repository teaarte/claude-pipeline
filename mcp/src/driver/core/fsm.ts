/**
 * Generic FSM engine. Knows nothing about specific agents, steps, or flows —
 * only the plugin types in `driver/types/plugin.ts`. A repository-level grep
 * gate over `mcp/src/driver/core/` must return zero matches for any
 * built-in plugin name; that's how we keep this boundary intact across
 * future extensions.
 *
 * Injectable `spawnRecorder` lets a transport (MCP, future HTTP API)
 * persist each begin-spawn into pipeline-state via `pipeline_begin_agent`.
 * When omitted (smoke/unit tests), `beginSpawn` mints an in-memory id and
 * is functional for the duration of a single runFSM invocation.
 */

import { randomUUID } from "node:crypto";
import type {
  DriverState,
  ModelName,
  PluginRegistry,
  StepContext,
  StepResult,
} from "../types/plugin.js";
import type { DriverResponse } from "../types/shuttle.js";
import type { Phase } from "../../lib/phase-state-machine.js";
import { runHooks } from "./invoke-hooks.js";
import { requireFlow, requireStep } from "./registry.js";
import { writeDriverState } from "./state.js";
import { error as shuttleError } from "./shuttle.js";

export type SpawnRecorder = (req: {
  project_dir: string;
  phase: Phase;
  agent: string;
  /**
   * Resolved effective model for this spawn. Threaded through Q19 so
   * `open_spawns[]` and the eventual metrics row carry the model that
   * actually ran (not just `plugin.default_model`). `null` when no
   * resolution happened (legacy callers / synthetic tests).
   */
  model?: ModelName | null;
}) => Promise<{ agent_run_id: string }>;

export interface RunFSMOptions {
  spawnRecorder?: SpawnRecorder;
}

/**
 * Run the FSM forward until it either reaches a shuttle response (pause)
 * or terminates with complete/error. Caller persists driver state between
 * pause points; transport-layer code does NOT live here.
 */
export async function runFSM(
  state: DriverState,
  registry: PluginRegistry,
  opts: RunFSMOptions = {},
): Promise<{ state: DriverState; response: DriverResponse }> {
  while (!state.complete) {
    const flow = requireFlow(registry, state.flow_name);
    if (state.step_index >= flow.steps.length) {
      const response = shuttleError(
        state.driver_state_id,
        "FLOW_OVERFLOW",
        `Flow '${flow.name}' has ${flow.steps.length} steps; step_index=${state.step_index} is out of range.`,
        [{ choice: "abandon", label: "Abandon and start fresh" }],
      );
      return { state, response };
    }
    const stepName = flow.steps[state.step_index];
    const step = requireStep(registry, stepName);

    await runHooks(registry, "before-step", state, { step: stepName });

    let result: StepResult;
    const ctx = buildStepContext(state, registry, opts.spawnRecorder);
    try {
      result = await step.run(state, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const response = shuttleError(
        state.driver_state_id,
        "STEP_THREW",
        `Step '${stepName}' threw: ${msg}`,
      );
      await runHooks(registry, "after-step", state, { step: stepName });
      return { state, response };
    }

    await runHooks(registry, "after-step", state, { step: stepName, result });

    if (result.type === "advance") {
      state.step_index++;
      await writeDriverState(state);
      continue;
    }
    if (result.type === "shuttle") {
      await writeDriverState(state);
      return { state, response: result.response };
    }
    if (result.type === "halt") {
      state.complete = true;
      await writeDriverState(state);
      return { state, response: result.response };
    }
    // Exhaustive — a new StepResult variant must update this switch.
    throw new Error(`unreachable StepResult: ${JSON.stringify(result satisfies never)}`);
  }
  const response: DriverResponse = {
    status: "complete",
    task_id: state.task_id,
    verdict: state.verdict ?? "accepted",
    summary: `task complete (verdict=${state.verdict ?? "accepted"})`,
  };
  return { state, response };
}

function buildStepContext(
  state: DriverState,
  registry: PluginRegistry,
  spawnRecorder: SpawnRecorder | undefined,
): StepContext {
  return {
    registry,
    async beginSpawn(agent, phase, model) {
      // When a SpawnRecorder is injected (production MCP path), it owns
      // agent_run_id minting and persists the open_spawn into pipeline-state.
      // The fallback path mints in-memory for smoke / unit tests where
      // pipeline-state is not the source of truth.
      if (spawnRecorder) {
        const { agent_run_id } = await spawnRecorder({
          project_dir: state.project_dir,
          phase,
          agent,
          model: model ?? null,
        });
        state.pending_spawns[agent_run_id] = {
          agent,
          phase,
          started_at: new Date().toISOString(),
          model: model ?? null,
        };
        return agent_run_id;
      }
      const id = `ar-${randomUUID()}`;
      state.pending_spawns[id] = {
        agent,
        phase,
        started_at: new Date().toISOString(),
        model: model ?? null,
      };
      return id;
    },
  };
}
