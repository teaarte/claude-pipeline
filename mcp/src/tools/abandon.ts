import { rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { stateFile, claudeDir } from "../lib/paths.js";
import { fileExists } from "../lib/state-io.js";

export const abandonSchema = {
  project_dir: z.string(),
  reason: z.string().min(1).describe("Why the task is being abandoned (logged for audit)."),
};

/**
 * Move the in-flight pipeline-state.json to abandoned-<ts>.json. The task
 * exits the system without writing a metrics row. Use when state is hopeless
 * (corrupted, mid-pipeline rebase, etc.) and the user prefers to start fresh.
 */
export async function pipelineAbandon(input: {
  project_dir: string;
  reason: string;
}): Promise<{ moved_to: string; reason: string }> {
  const src = stateFile(input.project_dir);
  if (!(await fileExists(src))) {
    throw new Error(`pipeline-state.json not found at ${src}. Nothing to abandon.`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dst = join(claudeDir(input.project_dir), `abandoned-${ts}.json`);
  await mkdir(dirname(dst), { recursive: true });
  await rename(src, dst);
  // We intentionally leave findings.jsonl and summary.md in place — they are
  // useful artifacts for post-mortem. /done's cleanup step removes them when
  // run, but abandon does NOT call /done.
  return { moved_to: dst, reason: input.reason };
}
