import { writeFile, mkdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { claudeDir, stateFile } from "../lib/paths.js";
import { readStateSafe } from "../lib/state-io.js";
import { assertProjectDirAllowed } from "../lib/project-dir.js";

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
  force: z
    .boolean()
    .optional()
    .describe(
      "Bypass the 'unexpired marker already exists' check. Use to extend a still-active unlock window — recorded with extension=true.",
    ),
};

export const relockWritesSchema = {
  project_dir: z.string(),
};

export async function pipelineUnlockWrites(input: {
  project_dir: string;
  ttl_seconds?: number;
  reason: string;
  force?: boolean;
}): Promise<{ marker_file: string; expires_at: string; ttl_seconds: number; extension: boolean }> {
  await assertProjectDirAllowed(input.project_dir);
  const ttl = input.ttl_seconds ?? UNLOCK_DEFAULT_TTL_SECONDS;
  if (ttl < 1 || ttl > UNLOCK_MAX_TTL_SECONDS) {
    throw new Error(
      `pipeline_unlock_writes: ttl_seconds must be between 1 and ${UNLOCK_MAX_TTL_SECONDS}, got ${ttl}`,
    );
  }
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttl * 1000).toISOString();

  // Refuse to silently extend an active bypass (Challenger #7). Caller must
  // pass force=true to roll the TTL forward — that goes into the audit line
  // via verdict=force_bypass.
  const existing = await readBypassMarker(input.project_dir);
  let extension = false;
  if (existing && typeof existing.expires_at === "string") {
    const exp = Date.parse(existing.expires_at);
    if (Number.isFinite(exp) && exp > now) {
      if (!input.force) {
        throw new Error(
          `pipeline_unlock_writes: active bypass marker present (expires_at=${existing.expires_at}). Pass force=true to extend the window — the extension will be recorded as a force_bypass audit line.`,
        );
      }
      extension = true;
    }
  }

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
        issued_at: issuedAt,
        expires_at: expiresAt,
        reason: input.reason,
        issued_by_task_id: issuedByTaskId,
        extension,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { marker_file: marker, expires_at: expiresAt, ttl_seconds: ttl, extension };
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

export async function readBypassMarker(projectDir: string): Promise<any | null> {
  try {
    const raw = await readFile(bypassMarkerPath(projectDir), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
