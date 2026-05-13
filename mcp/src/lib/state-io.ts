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

async function ensureLockable(file: string): Promise<void> {
  await ensureDir(file);
  if (!(await fileExists(file))) {
    await writeFile(file, "{}", "utf8");
  }
}

export async function writeStateAtomic(file: string, state: PipelineState): Promise<void> {
  await ensureDir(file);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

/**
 * Acquire a file lock around a read-modify-write of pipeline-state.json.
 * The lock target must exist before lockfile.lock() — we create an empty {} file if missing.
 */
export async function withStateLock<T>(
  file: string,
  fn: (state: PipelineState | null) => Promise<{ state?: PipelineState; result: T }>,
): Promise<T> {
  await ensureLockable(file);
  const release = await lockfile.lock(file, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 250 },
    stale: 10_000,
  });
  try {
    const existing = await readStateSafe(file);
    const { state, result } = await fn(existing && Object.keys(existing).length > 0 ? existing : null);
    if (state !== undefined) {
      await writeStateAtomic(file, state);
    }
    return result;
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
