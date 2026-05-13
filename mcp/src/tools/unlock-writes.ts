import { writeFile, mkdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { claudeDir, stateFile } from "../lib/paths.js";
import { readStateSafe } from "../lib/state-io.js";

export const UNLOCK_DEFAULT_TTL_SECONDS = 300;
export const UNLOCK_MAX_TTL_SECONDS = 3600;

function bypassMarkerPath(projectDir: string): string {
  return join(claudeDir(projectDir), ".mcp-bypass-allowed");
}

export const unlockWritesSchema = {
  project_dir: z.string(),
  ttl_seconds: z
    .number()
    .int()
    .min(1)
    .max(UNLOCK_MAX_TTL_SECONDS)
    .optional()
    .describe(`How long the bypass remains valid. Default ${UNLOCK_DEFAULT_TTL_SECONDS}s, max ${UNLOCK_MAX_TTL_SECONDS}s.`),
  reason: z.string().min(1).describe("Why the bypass is needed (logged in audit + marker file)."),
};

export const relockWritesSchema = {
  project_dir: z.string(),
};

export async function pipelineUnlockWrites(input: {
  project_dir: string;
  ttl_seconds?: number;
  reason: string;
}): Promise<{ marker_file: string; expires_at: string; ttl_seconds: number }> {
  const ttl = input.ttl_seconds ?? UNLOCK_DEFAULT_TTL_SECONDS;
  if (ttl < 1 || ttl > UNLOCK_MAX_TTL_SECONDS) {
    throw new Error(
      `pipeline_unlock_writes: ttl_seconds must be between 1 and ${UNLOCK_MAX_TTL_SECONDS}, got ${ttl}`,
    );
  }
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  // Best-effort: include the task_id for traceability when state exists.
  let issuedByTaskId: string | null = null;
  try {
    const state = await readStateSafe(stateFile(input.project_dir));
    issuedByTaskId = (state?.task_id as string | undefined) ?? null;
  } catch {
    issuedByTaskId = null;
  }
  const marker = bypassMarkerPath(input.project_dir);
  await mkdir(claudeDir(input.project_dir), { recursive: true });
  await writeFile(
    marker,
    JSON.stringify(
      {
        schema_version: "1.0",
        expires_at: expiresAt,
        reason: input.reason,
        issued_by_task_id: issuedByTaskId,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { marker_file: marker, expires_at: expiresAt, ttl_seconds: ttl };
}

export async function pipelineRelockWrites(input: {
  project_dir: string;
}): Promise<{ relocked: boolean; marker_existed: boolean }> {
  const marker = bypassMarkerPath(input.project_dir);
  try {
    await unlink(marker);
    return { relocked: true, marker_existed: true };
  } catch (e: any) {
    if (e?.code === "ENOENT") return { relocked: true, marker_existed: false };
    throw e;
  }
}

// Helper for tests / /done command to know whether bypass is active.
export async function readBypassMarker(projectDir: string): Promise<any | null> {
  try {
    const raw = await readFile(bypassMarkerPath(projectDir), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
