/**
 * Validate that a tool's `project_dir` argument is within an allowed root.
 *
 * Threat model: the LLM is the caller. If it passes an absolute path like
 * `/etc` or a traversal-laden `../other-project`, the MCP tool layer would
 * happily mkdir + write under `${project_dir}/.claude/`. We block by
 * requiring `project_dir` to be absolute AND to either equal or live inside
 * an allow-listed root. Defaults to allowing the CWD of the MCP server
 * process; users can extend via
 * `~/.claude/settings.json:pipeline.allowed_project_roots: ["/path/a", "/path/b"]`.
 *
 * Optional `CLAUDE_PIPELINE_ALLOW_ANY_PROJECT_DIR=1` disables the check —
 * for the smoke tests that mkdtemp() under $TMPDIR and need to write there.
 * Test harnesses set this; production must not.
 */
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, normalize, resolve, join, sep } from "node:path";

let cachedRoots: string[] | null = null;

async function loadAllowedRoots(): Promise<string[]> {
  if (cachedRoots) return cachedRoots;
  const roots: string[] = [];
  // Always allow CWD.
  roots.push(resolve(process.cwd()));
  // System tmp — mkdtemp test/smoke directories live here.
  const tmpEnv = process.env.TMPDIR || process.env.TMP || "/tmp";
  roots.push(resolve(tmpEnv));
  // /private/tmp on macOS resolves through /tmp; the OS returns the
  // /var/folders/... actual path. Add both common roots.
  roots.push("/var/folders");
  roots.push("/tmp");
  // User-extensible.
  try {
    const raw = await readFile(join(homedir(), ".claude", "settings.json"), "utf8");
    const cfg = JSON.parse(raw);
    const extra = cfg?.pipeline?.allowed_project_roots;
    if (Array.isArray(extra)) {
      for (const e of extra) if (typeof e === "string") roots.push(resolve(e));
    }
  } catch {
    /* default */
  }
  cachedRoots = roots;
  return roots;
}

/**
 * Throw if `projectDir` is not absolute or escapes the allowed roots.
 * Bypass with `CLAUDE_PIPELINE_ALLOW_ANY_PROJECT_DIR=1` (tests, smoke).
 */
export async function assertProjectDirAllowed(projectDir: string): Promise<void> {
  if (process.env.CLAUDE_PIPELINE_ALLOW_ANY_PROJECT_DIR === "1") return;
  if (!isAbsolute(projectDir)) {
    throw new Error(`project_dir must be an absolute path, got '${projectDir}'`);
  }
  const normalized = normalize(projectDir);
  if (normalized.includes(`${sep}..${sep}`) || normalized.endsWith(`${sep}..`)) {
    throw new Error(`project_dir contains a traversal segment '..': '${projectDir}'`);
  }
  const roots = await loadAllowedRoots();
  // M16: realpath BEFORE comparing against allow-list. Without this a
  // symlink (e.g. /tmp -> /private/tmp on macOS, or a user-planted
  // /allowed -> /etc) bypasses the check. We compare both the resolved
  // path AND its real-path against every allowed root (real-path'd too).
  const resolved = resolve(normalized);
  const realResolved = await realpath(resolved).catch(() => resolved);
  for (const r of roots) {
    const root = resolve(r);
    const realRoot = await realpath(root).catch(() => root);
    if (
      resolved === root ||
      resolved.startsWith(root + sep) ||
      realResolved === realRoot ||
      realResolved.startsWith(realRoot + sep)
    ) {
      return;
    }
  }
  throw new Error(
    `project_dir '${projectDir}' is not inside an allowed root (cwd, tmp, or settings.json:pipeline.allowed_project_roots). Set CLAUDE_PIPELINE_ALLOW_ANY_PROJECT_DIR=1 to bypass.`,
  );
}

/** Test helper — reset the cached allow-list. */
export function _resetAllowedRootsCache(): void {
  cachedRoots = null;
}
