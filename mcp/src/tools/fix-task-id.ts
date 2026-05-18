/**
 * pipeline_fix_task_id — recovery primitive for the case where a
 * pipeline-state.json carries a task_id that doesn't match the schema
 * pattern (legacy state from before Q7's slug sanitizer, manually-
 * constructed task_ids, future schema tightening). Replaces the
 * unlock_writes → python-JSON-hack → relock_writes dance documented in
 * commands/done.md Recovery.
 *
 * Validates the new id against TASK_ID_PATTERN, mutates state under
 * withStateLock, regenerates the summary, and returns {old, new}. The
 * withAudit wrapper records the call automatically — no inline audit()
 * needed.
 */

import { z } from "zod";
import { readFile, writeFile, rename } from "node:fs/promises";
import { stateFile, summaryFile, findingsFile } from "../lib/paths.js";
import { withStateLock, writeText, fileExists } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";
import { TASK_ID_PATTERN } from "../lib/ids.js";
import { assertProjectDirAllowed } from "../lib/project-dir.js";

export const fixTaskIdSchema = {
  project_dir: z.string(),
  new_task_id: z
    .string()
    .regex(TASK_ID_PATTERN)
    .describe("Replacement task_id. Must match ^t-\\d{4}-\\d{2}-\\d{2}-[a-z0-9]{4,}$."),
  reason: z
    .string()
    .min(4)
    .describe("Why the id is being rewritten — forces explicit operator intent for the audit trail."),
};

export async function pipelineFixTaskId(input: {
  project_dir: string;
  new_task_id: string;
  reason: string;
}): Promise<{ old_task_id: string | null; new_task_id: string }> {
  await assertProjectDirAllowed(input.project_dir);
  if (!TASK_ID_PATTERN.test(input.new_task_id)) {
    throw new Error(
      `pipeline_fix_task_id: new_task_id '${input.new_task_id}' does not match ${TASK_ID_PATTERN}`,
    );
  }
  if (!input.reason || input.reason.trim().length < 4) {
    throw new Error("pipeline_fix_task_id: reason must be a non-empty string ≥ 4 chars");
  }

  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);
  const fjsonl = findingsFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) {
      throw new Error(`pipeline-state.json not found at ${file}. Run pipeline_init first.`);
    }
    const old = (state.task_id as string | undefined) ?? null;

    // H13: rewrite findings.jsonl BEFORE mutating state.task_id. If the
    // rewrite fails (read error, write error, parse error), we throw and
    // the state is left untouched — caller can retry. Other writers are
    // already serialised through pipeline-state's withStateLock.
    if (old && (await fileExists(fjsonl))) {
      await rewriteFindingsTaskId(fjsonl, old, input.new_task_id);
    }

    state.task_id = input.new_task_id;
    await writeText(summary, await buildSummary(state));
    return {
      state,
      result: { old_task_id: old, new_task_id: input.new_task_id },
    };
  });
}

async function rewriteFindingsTaskId(
  file: string,
  oldId: string,
  newId: string,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  const lines = raw.split("\n");
  const rewritten: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      rewritten.push(line);
      continue;
    }
    try {
      const obj = JSON.parse(trimmed);
      if (obj.task_id === oldId) {
        obj.task_id = newId;
      }
      rewritten.push(JSON.stringify(obj));
    } catch {
      // Preserve malformed lines verbatim — pipeline_validate will flag them.
      rewritten.push(line);
    }
  }
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, rewritten.join("\n"), "utf8");
  await rename(tmp, file);
}
