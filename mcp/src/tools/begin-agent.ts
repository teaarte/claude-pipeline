import { z } from "zod";
import { stateFile, summaryFile } from "../lib/paths.js";
import { withStateLock, writeText } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";
import { PHASES, assertPrereqSatisfied, type Phase } from "../lib/phase-state-machine.js";
import { makeAgentRunId } from "../lib/ids.js";

export const beginAgentSchema = {
  project_dir: z.string(),
  phase: z.enum(PHASES),
  agent: z.string().min(1),
  model: z.enum(["haiku", "sonnet", "opus"]).nullable().optional(),
};

export type OpenSpawn = {
  id: string;
  agent: string;
  model: string | null;
  started_at: string;
};

export async function pipelineBeginAgent(input: {
  project_dir: string;
  phase: Phase;
  agent: string;
  model?: "haiku" | "sonnet" | "opus" | null;
}): Promise<{ agent_run_id: string; started_at: string }> {
  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) {
      throw new Error(`pipeline-state.json not found at ${file}. Call pipeline_init first.`);
    }
    if (!state.phases?.[input.phase]) {
      throw new Error(`Unknown phase '${input.phase}'`);
    }
    const phase = state.phases[input.phase];
    if (phase.status === "completed" || phase.status === "skipped") {
      throw new Error(
        `Cannot begin agent in phase '${input.phase}' (status='${phase.status}'). Phase is closed.`,
      );
    }
    // INV_011: prereq must be satisfied before spawning in a non-context/final phase.
    if (phase.status === "pending") {
      assertPrereqSatisfied(state, input.phase as Phase, "in_progress");
    }
    phase.open_spawns = Array.isArray(phase.open_spawns) ? phase.open_spawns : [];
    const id = makeAgentRunId();
    const started_at = new Date().toISOString();
    phase.open_spawns.push({
      id,
      agent: input.agent,
      model: input.model ?? null,
      started_at,
    } as OpenSpawn);
    if (phase.status === "pending") phase.status = "in_progress";

    await writeText(summary, await buildSummary(state));

    return {
      state,
      result: { agent_run_id: id, started_at },
    };
  });
}

/**
 * Helper: find and remove an open_spawn by id from the given phase. Returns
 * the removed entry or throws if not found. Caller must hold the state lock.
 */
export function consumeOpenSpawn(phase: any, agentRunId: string, agentName: string): OpenSpawn {
  const list: OpenSpawn[] = Array.isArray(phase.open_spawns) ? phase.open_spawns : [];
  const idx = list.findIndex((s) => s.id === agentRunId);
  if (idx === -1) {
    throw new Error(
      `INV_012: agent_run_id '${agentRunId}' not found in phase open_spawns[]. ` +
        `Call pipeline_begin_agent first, or pass the id returned by it.`,
    );
  }
  const removed = list[idx];
  if (removed.agent !== agentName) {
    throw new Error(
      `INV_012: agent_run_id '${agentRunId}' was begun for agent '${removed.agent}' but being recorded as '${agentName}'.`,
    );
  }
  list.splice(idx, 1);
  phase.open_spawns = list;
  return removed;
}
