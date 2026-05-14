/**
 * Q33: snapshot the working-tree diff at implementation-phase close so
 * `state.files.{created,modified}` reflects what actually changed, instead
 * of staying at the schema-defined empty arrays the v2 driver never wrote.
 *
 * Runs `git diff --name-status HEAD` inside the project_dir. Returns null
 * when git is unavailable or the directory isn't a repo so callers can
 * gracefully fall through to empty arrays + an audit entry instead of
 * crashing the phase close.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type DiffSummary = {
  created: string[];
  modified: string[];
};

const EMPTY: DiffSummary = Object.freeze({ created: [], modified: [] }) as DiffSummary;

/** Parse `git diff --name-status` output. Exported for unit tests. */
export function parseDiffOutput(output: string): DiffSummary {
  const created: string[] = [];
  const modified: string[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const parts = line.split("\t");
    const status = parts[0]?.charAt(0);
    if (!status) continue;
    if (status === "A") {
      if (parts[1]) created.push(parts[1]);
    } else if (status === "M") {
      if (parts[1]) modified.push(parts[1]);
    } else if (status === "R" || status === "C") {
      // Renames/copies surface in name-status as "R100\told\tnew" — the
      // new path is the meaningful one for downstream signal.
      const newPath = parts[2] ?? parts[1];
      if (newPath) modified.push(newPath);
    }
    // status === "D" (deleted) intentionally ignored — the pipeline-state
    // schema has no `deleted` field; emitting one would break validation
    // under additionalProperties:false at the files object level.
  }
  return { created, modified };
}

/**
 * Capture the diff against HEAD. Returns null when git isn't available or
 * the directory is outside a repo; callers should treat null as
 * "couldn't determine" and emit an audit entry with error_class=
 * "git-unavailable".
 */
export async function captureGitDiff(projectDir: string): Promise<DiffSummary | null> {
  try {
    const { stdout } = await exec("git", ["diff", "--name-status", "HEAD"], {
      cwd: projectDir,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseDiffOutput(stdout);
  } catch {
    return null;
  }
}

export { EMPTY as EMPTY_DIFF };
