/**
 * pipeline_run_task — MCP entry point that starts a new driver-state and
 * runs the FSM forward until it pauses or completes. Thin wrapper around
 * `runFSM`. The same `runFSM` is the v2.5 HTTP API's entry point too —
 * keep this module free of MCP-specific behavior beyond zod schema +
 * input shape.
 */

import { z } from "zod";
import { createRegistry } from "../core/registry.js";
import { runFSM } from "../core/fsm.js";
import { makeInitialDriverState, writeDriverState } from "../core/state.js";
import { loadBuiltinPlugins } from "../loaders/builtins.js";
import { loadProjectConfigIfPresent } from "../loaders/project-config.js";
import { complexityDecision } from "../builtin/decisions/complexity.js";
import type { DriverResponse } from "../types/shuttle.js";

export const runTaskSchema = {
  project_dir: z.string(),
  task: z.string().min(1),
  complexity_hint: z.enum(["simple", "medium", "complex"]).optional(),
};

export async function pipelineRunTask(input: {
  project_dir: string;
  task: string;
  complexity_hint?: "simple" | "medium" | "complex";
}): Promise<DriverResponse> {
  const registry = createRegistry();
  loadBuiltinPlugins(registry);
  const config = await loadProjectConfigIfPresent(registry, input.project_dir);
  const state = makeInitialDriverState({
    project_dir: input.project_dir,
    task: input.task,
    flow_name: input.complexity_hint ?? "medium",
  });
  state.scratch.config = config;
  if (input.complexity_hint) {
    state.scratch.complexity = input.complexity_hint;
    state.decisions["complexity"] = input.complexity_hint;
    state.flow_name = input.complexity_hint;
  } else {
    // Run the complexity decision now so the flow can be selected.
    const c = await Promise.resolve(complexityDecision.decide(state));
    state.decisions["complexity"] = c;
    state.flow_name = c;
  }
  await writeDriverState(state);
  const { response } = await runFSM(state, registry);
  return response;
}
