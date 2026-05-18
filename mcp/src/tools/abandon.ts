import { readFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import lockfile from "proper-lockfile";
import { stateFile, claudeDir } from "../lib/paths.js";
import { fileExists } from "../lib/state-io.js";
import { assertProjectDirAllowed } from "../lib/project-dir.js";
import { audit } from "../lib/audit.js";
import {
  currentOwnerId,
  ownerCheck,
  OWNER_MISMATCH_CODE,
} from "../lib/owner.js";

export const abandonSchema = {
  project_dir: z.string(),
  reason: z.string().min(1).describe("Why the task is being abandoned (logged for audit)."),
  force_cross_owner: z
    .boolean()
    .optional()
    .describe(
      "v2.2.6 C8 / Q64 — bypass the owner_id mismatch check. Audited as pipeline_violation: 'cross-owner-finalize'. Use only when you're sure you want to terminate another session's task.",
    ),
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
  force_cross_owner?: boolean;
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
    // v2.2.6 C8 / Q64: cross-session ownership check.
    let stateOwnerId: string | null = null;
    try {
      const raw = await readFile(src, "utf8");
      const parsed = JSON.parse(raw);
      stateOwnerId = typeof parsed?.owner_id === "string" ? parsed.owner_id : null;
    } catch {
      // Unparseable state — skip owner check, let abandon proceed (caller
      // chose abandon precisely because state may be hopeless).
    }
    const result = ownerCheck(stateOwnerId, currentOwnerId());
    if (result.kind === "mismatch" && !input.force_cross_owner) {
      const err = new Error(
        `${OWNER_MISMATCH_CODE}: pipeline-state was started by owner '${result.expected}' but this session's owner is '${result.actual}'. ` +
          `Pass {force_cross_owner: true} to override (audited as cross-owner-finalize).`,
      );
      (err as any).code = OWNER_MISMATCH_CODE;
      throw err;
    }
    if (result.kind === "mismatch" && input.force_cross_owner) {
      await audit({
        tool: "pipeline_abandon",
        args: { force_cross_owner: true, expected_owner: result.expected, actual_owner: result.actual },
        projectDir: input.project_dir,
        verdict: "ok",
      }).catch(() => undefined);
    }
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
