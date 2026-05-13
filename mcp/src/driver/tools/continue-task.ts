/**
 * pipeline_continue_task — MCP resume entry point. Loads the previously
 * persisted driver-state, applies the shuttle input (agent result, user
 * answer, or recovery choice), and re-enters the FSM. Same `runFSM` as
 * run-task; we just rehydrate state.
 */

import { z } from "zod";
import { createRegistry } from "../core/registry.js";
import { runFSM } from "../core/fsm.js";
import { readDriverState, writeDriverState } from "../core/state.js";
import { loadBuiltinPlugins } from "../loaders/builtins.js";
import { loadProjectConfigIfPresent } from "../loaders/project-config.js";
import type { ContinueTaskInput, DriverResponse } from "../types/shuttle.js";

export const continueTaskSchema = {
  project_dir: z.string(),
  driver_state_id: z.string(),
  input: z.union([
    z.object({
      driver_state_id: z.string(),
      type: z.literal("agent-result"),
      agent_run_id: z.string(),
      agent_output: z.string(),
    }),
    z.object({
      driver_state_id: z.string(),
      type: z.literal("agents-results"),
      results: z.array(z.object({ agent_run_id: z.string(), agent_output: z.string() })),
    }),
    z.object({
      driver_state_id: z.string(),
      type: z.literal("user-answer"),
      answer: z.string(),
    }),
    z.object({
      driver_state_id: z.string(),
      type: z.literal("recovery"),
      choice: z.enum(["abandon", "force-close", "retry"]),
    }),
  ]),
};

export async function pipelineContinueTask(input: {
  project_dir: string;
  driver_state_id: string;
  input: ContinueTaskInput;
}): Promise<DriverResponse> {
  const state = await readDriverState(input.project_dir);
  if (!state) throw new Error(`No driver-state found at ${input.project_dir}/.claude/driver-state.json`);
  if (state.driver_state_id !== input.driver_state_id) {
    throw new Error(
      `driver_state_id mismatch: expected '${state.driver_state_id}', got '${input.driver_state_id}'`,
    );
  }

  // Apply shuttle input to state.
  const evt = input.input;
  if (evt.type === "agent-result") {
    const spawn = state.pending_spawns[evt.agent_run_id];
    if (!spawn) {
      throw new Error(`Unknown agent_run_id '${evt.agent_run_id}' — not in pending_spawns`);
    }
    state.scratch[`agent_output_${evt.agent_run_id}`] = evt.agent_output;
    delete state.pending_spawns[evt.agent_run_id];
  } else if (evt.type === "agents-results") {
    for (const r of evt.results) {
      const spawn = state.pending_spawns[r.agent_run_id];
      if (!spawn) {
        throw new Error(`Unknown agent_run_id '${r.agent_run_id}' — not in pending_spawns`);
      }
      state.scratch[`agent_output_${r.agent_run_id}`] = r.agent_output;
      delete state.pending_spawns[r.agent_run_id];
    }
  } else if (evt.type === "user-answer") {
    if (!state.pending_user_answer) {
      throw new Error("Driver was not waiting for a user answer");
    }
    state.scratch[`${state.pending_user_answer.gate}_decision`] = evt.answer;
    state.pending_user_answer = null;
    state.step_index++;
  } else if (evt.type === "recovery") {
    if (evt.choice === "abandon") {
      state.complete = true;
      state.verdict = "rejected";
    } else if (evt.choice === "force-close") {
      state.complete = true;
      state.verdict = state.verdict ?? "accepted";
    } else if (evt.choice === "retry") {
      // No state mutation — caller should re-execute the same step.
    }
  }

  const registry = createRegistry();
  loadBuiltinPlugins(registry);
  await loadProjectConfigIfPresent(registry, input.project_dir);
  await writeDriverState(state);

  const { response } = await runFSM(state, registry);
  return response;
}
