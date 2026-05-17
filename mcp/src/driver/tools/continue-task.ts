/**
 * pipeline_continue_task — MCP resume entry point. Loads the previously
 * persisted driver-state, applies the shuttle input (agent result, user
 * answer, or recovery choice), and re-enters the FSM. Same `runFSM` as
 * run-task; we just rehydrate state.
 *
 * For each shuttle event the wrapper advances `state.step_index` so the
 * FSM doesn't re-execute the step that already issued the shuttle. This
 * is the canonical resume contract — spawn-emitting steps short-circuit
 * via `agent_output_<id>` in scratch, gate steps via `<gateName>_decision`.
 * For agent-result / agents-results we ALSO persist the agent into
 * pipeline-state (calls pipeline_record_*), closing the open_spawn[]
 * entry that pipelineBeginAgent opened. This is what wires the FSM-driven
 * loop into the existing invariant set.
 */

import { z } from "zod";
import { createRegistry } from "../core/registry.js";
import { runFSM } from "../core/fsm.js";
import { readDriverState, withDriverStateLock } from "../core/state.js";
import { loadBuiltinPlugins } from "../loaders/builtins.js";
import { loadProjectConfigIfPresent } from "../loaders/project-config.js";
import { requireAgent } from "../core/registry.js";
import { pipelineRecordAgentRun } from "../../tools/record-agent-run.js";
import { pipelineRecordNonreviewAgent } from "../../tools/record-nonreview-agent.js";
import { pipelineCancelSpawn } from "../../tools/cancel-spawn.js";
import { pipelineAbandon } from "../../tools/abandon.js";
import { mcpSpawnRecorder } from "./run-task.js";
import { mirrorGateDecision } from "../bundles/code/steps/index.js";
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

const NONREVIEW_AGENT_NAMES = new Set([
  "planner",
  "implementer",
  "architect",
  "code-analyzer",
  "dependency-auditor",
  "research",
  "migration",
]);

async function persistAgentResult(
  projectDir: string,
  agent: string,
  phase: any,
  agentRunId: string,
  agentOutput: string,
): Promise<void> {
  // Reviewer/validator agents emit a JSON header; pipeline_record_agent_run
  // parses it and routes findings into findings.jsonl. Non-reviewer agents
  // (planner, implementer, etc.) get pipeline_record_nonreview_agent.
  // Errors are surfaced so the driver can return an error shuttle.
  if (NONREVIEW_AGENT_NAMES.has(agent)) {
    await pipelineRecordNonreviewAgent({
      project_dir: projectDir,
      phase,
      agent: agent as any,
      agent_run_id: agentRunId,
    });
  } else {
    await pipelineRecordAgentRun({
      project_dir: projectDir,
      phase,
      agent_run_id: agentRunId,
      agent_output: agentOutput,
    });
  }
}

export async function pipelineContinueTask(input: {
  project_dir: string;
  driver_state_id: string;
  input: ContinueTaskInput;
}): Promise<DriverResponse> {
  return withDriverStateLock(input.project_dir, async (loaded) => {
    if (!loaded)
      throw new Error(
        `No driver-state found at ${input.project_dir}/.claude/driver-state.json`,
      );
    const state = loaded;
    if (state.driver_state_id !== input.driver_state_id) {
      throw new Error(
        `driver_state_id mismatch: expected '${state.driver_state_id}', got '${input.driver_state_id}'`,
      );
    }

    const evt = input.input;
    if (evt.type === "agent-result") {
      const spawn = state.pending_spawns[evt.agent_run_id];
      if (!spawn) {
        throw new Error(`Unknown agent_run_id '${evt.agent_run_id}' — not in pending_spawns`);
      }
      state.scratch[`agent_output_${evt.agent_run_id}`] = evt.agent_output;
      await persistAgentResult(
        input.project_dir,
        spawn.agent,
        spawn.phase,
        evt.agent_run_id,
        evt.agent_output,
      );
      delete state.pending_spawns[evt.agent_run_id];
      state.step_index++;
    } else if (evt.type === "agents-results") {
      for (const r of evt.results) {
        const spawn = state.pending_spawns[r.agent_run_id];
        if (!spawn) {
          throw new Error(`Unknown agent_run_id '${r.agent_run_id}' — not in pending_spawns`);
        }
        state.scratch[`agent_output_${r.agent_run_id}`] = r.agent_output;
        await persistAgentResult(
          input.project_dir,
          spawn.agent,
          spawn.phase,
          r.agent_run_id,
          r.agent_output,
        );
        delete state.pending_spawns[r.agent_run_id];
      }
      state.step_index++;
    } else if (evt.type === "user-answer") {
      if (!state.pending_user_answer) {
        throw new Error("Driver was not waiting for a user answer");
      }
      const gateName = state.pending_user_answer.gate;
      state.scratch[`${gateName}_decision`] = evt.answer;
      state.pending_user_answer = null;
      // Build a registry just for the gate plugin lookup. We do it again
      // below for runFSM — registries are cheap to construct (no IO) and
      // doing it here keeps the mirror call self-contained.
      {
        const r = createRegistry();
        loadBuiltinPlugins(r);
        await loadProjectConfigIfPresent(r, input.project_dir);
        await mirrorGateDecision(state, r, gateName);
      }
      state.step_index++;
    } else if (evt.type === "recovery") {
      if (evt.choice === "abandon") {
        // Cancel any still-open spawns BEFORE moving pipeline-state out of
        // the way; otherwise the next pipeline_init would still see them.
        for (const [agentRunId, spawn] of Object.entries(state.pending_spawns)) {
          await pipelineCancelSpawn({
            project_dir: input.project_dir,
            phase: spawn.phase,
            agent_run_id: agentRunId,
            reason: "driver abandon recovery",
          }).catch(() => undefined);
        }
        await pipelineAbandon({
          project_dir: input.project_dir,
          reason: "driver abandon recovery",
        }).catch(() => undefined);
        state.pending_spawns = {};
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

    const { response } = await runFSM(state, registry, {
      spawnRecorder: mcpSpawnRecorder,
    });
    return { state, result: response };
  });
}

export { requireAgent, readDriverState };
