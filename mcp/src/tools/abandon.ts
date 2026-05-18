import { rename, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import lockfile from "proper-lockfile";
import { stateFile, claudeDir } from "../lib/paths.js";
import { fileExists } from "../lib/state-io.js";
import { assertProjectDirAllowed } from "../lib/project-dir.js";

export const abandonSchema = {
  project_dir: z.string(),
  reason: z.string().min(1).describe("Why the task is being abandoned (logged for audit)."),
};

/**
 * Move the in-flight pipeline-state.json to abandoned-<ts>.json. The task
 * exits the system without writing a metrics row. Use when state is hopeless
 * (corrupted, mid-pipeline rebase, etc.) and the user prefers to start fresh.
 *
 * Also removes `.mcp-managed` and `.mcp-bypass-allowed` so the next pipeline
 * starts clean: no leaked guard scope, no inherited bypass window
 * (Logic L4). Findings + summary stay in place for post-mortem.
 */
export async function pipelineAbandon(input: {
  project_dir: string;
  reason: string;
}): Promise<{ moved_to: string; reason: string; markers_removed: string[] }> {
  // M14: assert project_dir is in the allow-list (defends against
  // path-traversal attacks via crafted input) and serialise via the
  // pipeline-state lock so a parallel pipeline_init / record-agent-run
  // can't write to the file mid-rename.
  await assertProjectDirAllowed(input.project_dir);
  const src = stateFile(input.project_dir);
  if (!(await fileExists(src))) {
    throw new Error(`pipeline-state.json not found at ${src}. Nothing to abandon.`);
  }
  const release = await lockfile.lock(src, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 250 },
    stale: 10_000,
  });
  let dst: string;
  const markersRemoved: string[] = [];
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    dst = join(claudeDir(input.project_dir), `abandoned-${ts}.json`);
    await mkdir(dirname(dst), { recursive: true });
    await rename(src, dst);

    // Best-effort marker cleanup.
    for (const name of [".mcp-managed", ".mcp-bypass-allowed"]) {
      const p = join(claudeDir(input.project_dir), name);
      try {
        await unlink(p);
        markersRemoved.push(name);
      } catch {
        /* not present */
      }
    }
  } finally {
    await release().catch(() => undefined);
  }

  return { moved_to: dst, reason: input.reason, markers_removed: markersRemoved };
}
