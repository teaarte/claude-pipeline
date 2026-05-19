/**
 * pipeline_run_task — MCP entry point that starts a new driver-state and
 * runs the FSM forward until it pauses or completes. Thin wrapper around
 * `runFSM`. The same `runFSM` is the v2.5 HTTP API's entry point too —
 * keep this module free of MCP-specific behavior beyond zod schema +
 * input shape.
 *
 * Refuses to clobber an in-flight driver-state. Bootstraps pipeline-state
 * (calls pipeline_init) so the v1 invariant set and /done's
 * pipeline_finish work end-to-end with the FSM-driven path.
 */

import { z } from "zod";
import { createRegistry } from "../core/registry.js";
import { runFSM, type SpawnRecorder } from "../core/fsm.js";
import { makeInitialDriverState, withDriverStateLock } from "../core/state.js";
import { loadBundle } from "../loaders/bundles.js";
import { loadProjectConfigIfPresent } from "../loaders/project-config.js";
import { complexityDecision } from "../bundles/code/decisions/complexity.js";
import { testsModeDecision } from "../bundles/code/decisions/tests-mode.js";
import { detectStack } from "../bundles/code/decisions/stack-detect.js";
import { pipelineInit } from "../../tools/init.js";
import { pipelineBeginAgent } from "../../tools/begin-agent.js";
import { error as shuttleError } from "../core/shuttle.js";
import { makeUniqueTaskId, TASK_ID_PATTERN } from "../../lib/ids.js";
import { audit } from "../../lib/audit.js";
import type { DriverResponse } from "../types/shuttle.js";

/**
 * Production SpawnRecorder used by both run-task and continue-task. Every
 * begin-spawn goes through pipeline_begin_agent so the pipeline-state's
 * open_spawns[] mirrors driver-state.pending_spawns — and INV_012 fires
 * if a phase is closed with a leak.
 */
export const mcpSpawnRecorder: SpawnRecorder = async (req) => {
  const r = await pipelineBeginAgent({
    project_dir: req.project_dir,
    phase: req.phase,
    agent: req.agent,
    model: req.model ?? null,
  });
  return { agent_run_id: r.agent_run_id };
};

export const runTaskSchema = {
  project_dir: z.string(),
  task: z.string().min(1),
  task_id: z
    .string()
    .regex(TASK_ID_PATTERN)
    .optional()
    .describe("Optional explicit task_id. If omitted, a slug is derived from `task`."),
  complexity_hint: z.enum(["simple", "medium", "complex"]).optional(),
  tests_mode_hint: z.enum(["tdd", "regression-only"]).optional(),
  stack: z
    .object({
      language: z.string(),
      package_manager: z.string().nullable().optional(),
      test_command: z.string().nullable().optional(),
      lint_command: z.string().nullable().optional(),
      build_command: z.string().nullable().optional(),
      project_type: z.enum(["frontend-app", "backend", "library", "monorepo"]).nullable().optional(),
    })
    .optional()
    .describe("Optional stack info. If omitted, a minimal placeholder is used."),
};

export async function pipelineRunTask(input: {
  project_dir: string;
  task: string;
  task_id?: string;
  complexity_hint?: "simple" | "medium" | "complex";
  tests_mode_hint?: "tdd" | "regression-only";
  stack?: any;
}): Promise<DriverResponse> {
  return withDriverStateLock(input.project_dir, async (existing) => {
    if (existing && !existing.complete) {
      const response = shuttleError(
        existing.driver_state_id,
        "IN_FLIGHT_TASK",
        `A driver task is already in flight (driver_state_id=${existing.driver_state_id}, flow=${existing.flow_name}, step_index=${existing.step_index}). Resume via pipeline_continue_task or recover via pipeline_continue_task({type: "recovery", choice: "abandon"}).`,
        [
          { choice: "abandon", label: "Abandon the in-flight task and start fresh" },
          { choice: "force-close", label: "Force-close as accepted, no metrics row" },
        ],
      );
      return { result: response };
    }

    const registry = createRegistry();
    await loadBundle("code", registry);
    const config = await loadProjectConfigIfPresent(registry, input.project_dir);

    // Bootstrap pipeline-state if it doesn't exist. This makes /done's
    // pipeline_finish work after a real driver run.
    const taskId = await makeUniqueTaskId({ task: input.task, task_id: input.task_id });
    const complexity = input.complexity_hint ?? "medium";
    const testsMode = input.tests_mode_hint ?? "regression-only";
    // Q17: detect the project's stack so reviewers, agents, and the
    // pipeline.jsonl metrics row all carry concrete language/commands
    // instead of `{language: "unknown", ...nulls}`.
    const stack = input.stack ?? (await detectStack(input.project_dir));
    // v2.2.6 C8 / Q64: read owner identifier from the generic env-var
    // chain. CLAUDE_PIPELINE_OWNER_ID is the explicit override; CC sets
    // CLAUDE_SESSION_ID; a future daemon transport may set SESSION_ID.
    // Pipeline core never reads CC-specific values directly — the
    // integration layer (CC's MCP launcher, daemon HTTP request handler,
    // CLI invoker) is what populates the env vars.
    const ownerId =
      process.env.CLAUDE_PIPELINE_OWNER_ID ||
      process.env.CLAUDE_SESSION_ID ||
      process.env.SESSION_ID ||
      null;
    // Q72 / D11: emit a one-time audit row when owner_id is unset so the
    // gap surfaces in the metrics stream. Without this, the Q64 cross-session
    // OWNER_MISMATCH check silently no-ops in real production (CC's stdio
    // mcpServers env-forwarding gap). audit() is best-effort — never blocks
    // pipeline_run_task on a missing owner.
    if (ownerId === null) {
      await audit({
        tool: "pipeline_run_task",
        args: { task_id: taskId },
        projectDir: input.project_dir,
        verdict: "ok",
        error_class: "owner-id-unset",
      }).catch(() => undefined);
    }
    try {
      await pipelineInit({
        project_dir: input.project_dir,
        task: input.task,
        task_id: taskId,
        complexity,
        tests_mode: testsMode,
        stack,
        owner_id: ownerId,
      });
    } catch (e: any) {
      // If pipeline-state already exists for a finished task, surface the
      // refusal as a recoverable error rather than silently dropping it.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Refusing to overwrite/.test(msg)) throw e;
    }

    const state = makeInitialDriverState({
      project_dir: input.project_dir,
      task: input.task,
      flow_name: complexity,
    });
    state.task_id = taskId;
    state.scratch.config = config;
    state.scratch.complexity = complexity;
    state.scratch.tests_mode = testsMode;
    state.decisions["complexity"] = complexity;
    state.decisions["tests_mode"] = testsMode;

    if (!input.complexity_hint) {
      // Run the complexity decision so a custom DecisionPlugin can override.
      const c = await Promise.resolve(complexityDecision.decide(state));
      state.decisions["complexity"] = c;
      state.flow_name = c;
      state.scratch.complexity = c;
    }
    if (!input.tests_mode_hint) {
      const tm = await Promise.resolve(testsModeDecision.decide(state));
      state.decisions["tests_mode"] = tm;
      state.scratch.tests_mode = tm;
    }

    const { state: out, response } = await runFSM(state, registry, {
      spawnRecorder: mcpSpawnRecorder,
    });
    return { state: out, result: response };
  });
}
