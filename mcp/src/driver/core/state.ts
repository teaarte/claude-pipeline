/**
 * DriverState persistence. Separate from pipeline-state.json (which is owned
 * by MCP tools). Driver state captures FSM position + spawns in flight.
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { fileExists } from "../../lib/state-io.js";
import { claudeDir } from "../../lib/paths.js";
import type { DriverState } from "../types/plugin.js";

export function driverStateFile(projectDir: string): string {
  return join(claudeDir(projectDir), "driver-state.json");
}

export function newDriverStateId(): string {
  return `ds-${randomUUID()}`;
}

export function makeInitialDriverState(input: {
  project_dir: string;
  task: string;
  flow_name: string;
}): DriverState {
  return {
    schema_version: "1.0",
    driver_state_id: newDriverStateId(),
    project_dir: input.project_dir,
    task: input.task,
    task_id: null,
    flow_name: input.flow_name,
    step_index: 0,
    started_at: new Date().toISOString(),
    pending_spawns: {},
    pending_user_answer: null,
    decisions: {},
    complete: false,
    verdict: null,
    scratch: {},
  };
}

async function ensureDir(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
}

export async function writeDriverState(state: DriverState): Promise<void> {
  const file = driverStateFile(state.project_dir);
  await ensureDir(file);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

export async function readDriverState(projectDir: string): Promise<DriverState | null> {
  const file = driverStateFile(projectDir);
  if (!(await fileExists(file))) return null;
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as DriverState;
}

export async function withDriverStateLock<T>(
  projectDir: string,
  fn: (state: DriverState | null) => Promise<{ state?: DriverState; result: T }>,
): Promise<T> {
  const file = driverStateFile(projectDir);
  await ensureDir(file);
  if (!(await fileExists(file))) {
    await writeFile(file, "{}", "utf8");
  }
  const release = await lockfile.lock(file, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 250 },
    stale: 10_000,
  });
  try {
    const existing = await readDriverState(projectDir);
    const { state, result } = await fn(existing && Object.keys(existing as any).length > 0 ? existing : null);
    if (state !== undefined) {
      await writeDriverState(state);
    }
    return result;
  } finally {
    await release();
  }
}
