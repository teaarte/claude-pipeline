/**
 * Generic FSM engine. Knows nothing about specific agents, steps, or flows —
 * only the plugin types in `driver/types/plugin.ts`. A repository-level grep
 * gate over `mcp/src/driver/core/` must return zero matches for any
 * built-in plugin name; that's how we keep this boundary intact across
 * future extensions.
 */

import { randomUUID } from "node:crypto";
import type {
  DriverState,
  PluginRegistry,
  StepContext,
  StepPlugin,
  StepResult,
} from "../types/plugin.js";
import type { DriverResponse } from "../types/shuttle.js";
import { runHooks } from "./invoke-hooks.js";
import { requireFlow, requireStep } from "./registry.js";
import { writeDriverState } from "./state.js";
import { error as shuttleError } from "./shuttle.js";

/**
 * Run the FSM forward until it either reaches a shuttle response (pause)
 * or terminates with complete/error. Caller persists driver state between
 * pause points; transport-layer code does NOT live here.
 */
export async function runFSM(
  state: DriverState,
  registry: PluginRegistry,
): Promise<{ state: DriverState; response: DriverResponse }> {
  while (!state.complete) {
    const flow = requireFlow(registry, state.flow_name);
    if (state.step_index >= flow.steps.length) {
      // Off the end of the flow without a verdict — that's a programming
      // error in the flow definition.
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
    const ctx = buildStepContext(state, registry);
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
    // Exhaustive check
    const _exhaustive: never = result;
    void _exhaustive;
  }
  // already complete — return a synthesized response from scratch
  const response: DriverResponse = {
    status: "complete",
    task_id: state.task_id,
    verdict: state.verdict ?? "accepted",
    summary: `task complete (verdict=${state.verdict ?? "accepted"})`,
  };
  return { state, response };
}

function buildStepContext(state: DriverState, registry: PluginRegistry): StepContext {
  return {
    registry,
    async beginSpawn(agent, phase) {
      const id = `ar-${randomUUID()}`;
      state.pending_spawns[id] = {
        agent,
        phase,
        started_at: new Date().toISOString(),
      };
      return id;
    },
  };
}
