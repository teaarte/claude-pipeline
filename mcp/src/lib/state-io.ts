import { readFile, writeFile, mkdir, rename, access, appendFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";

export type PipelineState = Record<string, any>;

async function ensureDir(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readState(file: string): Promise<PipelineState> {
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw);
}

export async function readStateSafe(file: string): Promise<PipelineState | null> {
  if (!(await fileExists(file))) return null;
  return readState(file);
}

export async function writeStateAtomic(file: string, state: PipelineState): Promise<void> {
  await ensureDir(file);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

/**
 * Acquire a file lock around a read-modify-write of pipeline-state.json.
 * The lock target must exist before lockfile.lock() — we create an empty {} file
 * if missing.
 *
 * H12 semantics: distinguishes "no state yet" (file did not pre-exist) from
 * "corrupt state" (file pre-existed but lacks required keys). The callback
 * receives `null` only when this call freshly created the lock target.
 * Pre-existing `{}` (no schema_version, no task_id) throws CORRUPT_STATE
 * instead of being silently coerced to null — that coercion used to mask
 * mutations on partial state files.
 */
export async function withStateLock<T>(
  file: string,
  fn: (state: PipelineState | null) => Promise<{ state?: PipelineState; result: T }>,
): Promise<T> {
  await ensureDir(file);
  const preExisted = await fileExists(file);
  if (!preExisted) {
    await writeFile(file, "{}", "utf8");
  }
  const release = await lockfile.lock(file, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 250 },
    stale: 10_000,
  });
  try {
    const raw = await readStateSafe(file);
    let existing: PipelineState | null;
    if (!preExisted || raw === null) {
      existing = null;
    } else if (
      typeof raw.schema_version === "string" &&
      (typeof raw.task_id === "string" || typeof raw.bundle === "string")
    ) {
      existing = raw;
    } else {
      throw new Error(
        `CORRUPT_STATE: ${file} pre-existed but lacks schema_version and/or task_id/bundle. ` +
          `Refusing silent overwrite — repair or delete the file manually.`,
      );
    }
    const { state, result } = await fn(existing);
    if (state !== undefined) {
      await writeStateAtomic(file, state);
    }
    return result;
  } finally {
    await release();
  }
}

/**
 * Shared lock for agent-feedback.jsonl mutations. Used by both
 * `log-agent-feedback` (append) and `set-pattern-confidence` (read-modify-rewrite).
 * Without this shared lock the rewrite path could clobber an append that landed
 * mid-rewrite (H10).
 */
export async function withFeedbackLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  await ensureDir(file);
  if (!(await fileExists(file))) {
    await writeFile(file, "", "utf8");
  }
  const release = await lockfile.lock(file, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 250 },
    stale: 10_000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function appendJsonl(file: string, obj: unknown): Promise<void> {
  await ensureDir(file);
  await appendFile(file, JSON.stringify(obj) + "\n", "utf8");
}

export async function ensureEmptyJsonl(file: string): Promise<void> {
  await ensureDir(file);
  if (!(await fileExists(file))) {
    await writeFile(file, "", "utf8");
  }
}

export async function writeText(file: string, content: string): Promise<void> {
  await ensureDir(file);
  await writeFile(file, content, "utf8");
}

export async function readJsonl(file: string): Promise<any[]> {
  if (!(await fileExists(file))) return [];
  const raw = await readFile(file, "utf8");
  const out: any[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines; pipeline_validate will flag them
    }
  }
  return out;
}

export { join };
