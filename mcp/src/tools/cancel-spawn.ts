import { z } from "zod";
import { stateFile, summaryFile } from "../lib/paths.js";
import { withStateLock, writeText } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";
import { CODE_PHASES, type Phase } from "../lib/phase-state-machine.js";
import { AGENT_RUN_ID_PATTERN } from "../lib/ids.js";

export const cancelSpawnSchema = {
  project_dir: z.string(),
  phase: z.enum(CODE_PHASES),
  agent_run_id: z.string().regex(AGENT_RUN_ID_PATTERN),
  reason: z.string().min(1).describe("Why the spawn is being cancelled (logged for audit)."),
};

/**
 * Remove an open spawn that will never complete (agent crashed, user
 * pre-empted, etc.). Allows the phase to advance after a cancelled spawn
 * without tripping INV_012.
 */
export async function pipelineCancelSpawn(input: {
  project_dir: string;
  phase: Phase;
  agent_run_id: string;
  reason: string;
}): Promise<{ cancelled: { id: string; agent: string; started_at: string } | null; reason: string }> {
  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);
  return withStateLock(file, async (state) => {
    if (!state) throw new Error(`pipeline-state.json not found at ${file}`);
    const phase = state.phases?.[input.phase];
    if (!phase) throw new Error(`Unknown phase '${input.phase}'`);
    const list: any[] = Array.isArray(phase.open_spawns) ? phase.open_spawns : [];
    const idx = list.findIndex((s) => s.id === input.agent_run_id);
    if (idx === -1) {
      throw new Error(
        `pipeline_cancel_spawn: agent_run_id '${input.agent_run_id}' not in phase '${input.phase}'.open_spawns[]`,
      );
    }
    const cancelled = list[idx];
    list.splice(idx, 1);
    phase.open_spawns = list;
    await writeText(summary, await buildSummary(state));
    return {
      state,
      result: {
        cancelled,
        reason: input.reason,
      },
    };
  });
}
