/**
 * Single source of truth for ID generation across the MCP server (Style
 * Reviewer findings #2–#4). Three flavors:
 *
 *   - makeFindingId(date)  → `f-YYYY-MM-DD-<6 slug chars>`
 *   - makeFeedbackId(date) → `fb-YYYY-MM-DD-<6 slug chars>`
 *   - makeAgentRunId()     → `ar-<uuid>`
 *
 * Shared regex AGENT_RUN_ID_PATTERN consumed by zod schemas in
 * tools/begin-agent.ts, record-agent-run.ts, record-nonreview-agent.ts,
 * cancel-spawn.ts so the format and producer stay in lockstep.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pipelineJsonl } from "./paths.js";

const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * task_id pattern shared with the JSON schema and the zod schemas in
 * `tools/init.ts` and `driver/tools/run-task.ts`. Slug part is
 * alphanumeric-only — hyphens, underscores, and unicode are stripped.
 *
 * Q42: optional `-[a-f0-9]{4}` collision-suffix added when two tasks would
 * otherwise share a slug (e.g. consecutive /task runs whose descriptions
 * start with the same preamble). Schema, init zod, and fix-task-id zod
 * all use this same pattern via TASK_ID_PATTERN.
 */
export const TASK_ID_PATTERN = /^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}(?:-[a-f0-9]{4})?$/;

const SLUG_MIN_LEN = 4;
const SLUG_MAX_LEN = 20;

function datedSlug(prefix: string, date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return `${prefix}-${y}-${m}-${d}-${suffix}`;
}

export function makeFindingId(date: Date = new Date()): string {
  return datedSlug("f", date);
}

export function makeFeedbackId(date: Date = new Date()): string {
  return datedSlug("fb", date);
}

export function makeAgentRunId(): string {
  return `ar-${randomUUID()}`;
}

export const AGENT_RUN_ID_PATTERN = /^ar-[0-9a-f-]+$/;

/**
 * Sanitize a free-form task description into the slug portion of a
 * task_id. Lowercased, alphanumeric-only (no hyphens — they're reserved
 * for date separators per the schema), truncated to SLUG_MAX_LEN, padded
 * with crypto-random hex when too short.
 *
 * Examples:
 *   "rename foo to bar"          → "renamefootobar"
 *   "feat: Add user-settings"    → "featadduserse...""    (truncated)
 *   "кириллица в названии"        → 8-char random hex      (no [a-z0-9] survives)
 *   ""                            → 8-char random hex
 *   "a"                           → "a" + 3 hex chars     (padded to 4)
 */
export function sanitizeTaskIdSlug(text: string): string {
  const stripped = (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const truncated = stripped.slice(0, SLUG_MAX_LEN);
  if (truncated.length >= SLUG_MIN_LEN) return truncated;
  const padBytes = Math.max(Math.ceil((SLUG_MIN_LEN - truncated.length) / 2), 2);
  const pad = randomBytes(padBytes).toString("hex");
  return (truncated + pad).slice(0, SLUG_MAX_LEN);
}

function formatTaskIdDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Build a schema-valid task_id. If the caller supplied an explicit
 * `task_id`, validate it against TASK_ID_PATTERN and pass through;
 * otherwise derive a slug from `task` via sanitizeTaskIdSlug.
 *
 * Always satisfies `^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}$` — pipeline_init's
 * schema check and the JSON-schema invariant won't reject the result.
 */
export function makeTaskId(input: { task: string; task_id?: string; date?: Date }): string {
  if (input.task_id) {
    if (!TASK_ID_PATTERN.test(input.task_id)) {
      throw new Error(
        `makeTaskId: explicit task_id '${input.task_id}' does not match ${TASK_ID_PATTERN}`,
      );
    }
    return input.task_id;
  }
  const date = input.date ?? new Date();
  return `t-${formatTaskIdDate(date)}-${sanitizeTaskIdSlug(input.task)}`;
}

/**
 * Q42: read the most recent task_ids from `pipeline.jsonl` for collision
 * detection. Bounded by `limit` (default 50) — newer rows are sufficient,
 * older runs aren't realistically reachable by the slug-collision pattern
 * (preamble-based collisions cluster within a workday).
 *
 * Returns an empty set if the file is missing or unreadable; collision
 * detection then degrades to "no collisions known" (safe — we'd just
 * skip the suffix, same as a pre-Q42 run).
 */
async function readRecentTaskIds(jsonlPath: string, limit = 50): Promise<Set<string>> {
  const ids = new Set<string>();
  let raw: string;
  try {
    raw = await readFile(jsonlPath, "utf8");
  } catch {
    return ids;
  }
  const lines = raw.split("\n").filter(Boolean);
  const recent = lines.length > limit ? lines.slice(-limit) : lines;
  for (const line of recent) {
    try {
      const row = JSON.parse(line);
      if (typeof row.task_id === "string") ids.add(row.task_id);
    } catch {
      // Malformed line — skip. (paths.ts owns metrics-file format; we
      // tolerate hand-edited cruft rather than crashing.)
    }
  }
  return ids;
}

/**
 * Q42: like `makeTaskId`, but additionally checks the suffix-free candidate
 * against recent rows in `pipeline.jsonl` and appends a 4-hex-char
 * suffix (`-a3f9`) when a collision is detected. Used by
 * `driver/tools/run-task.ts` so two `/task` invocations with the same
 * preamble don't end up with identical task_ids.
 *
 * Explicit `task_id` (caller-provided) passes through `makeTaskId` and
 * is NEVER suffixed — explicit ids are the user's responsibility.
 */
export async function makeUniqueTaskId(input: {
  task: string;
  task_id?: string;
  date?: Date;
  metricsFile?: string;
}): Promise<string> {
  if (input.task_id) {
    return makeTaskId({ task: input.task, task_id: input.task_id });
  }
  const base = makeTaskId({ task: input.task, date: input.date });
  const jsonl = input.metricsFile ?? pipelineJsonl;
  const recent = await readRecentTaskIds(jsonl);
  if (!recent.has(base)) return base;

  // Collision — append a short hash suffix. Re-roll once if the suffixed
  // form also collides (probability ≈ 1/65536, essentially never).
  const mkSuffixed = () => `${base}-${randomBytes(2).toString("hex")}`;
  let candidate = mkSuffixed();
  if (recent.has(candidate)) candidate = mkSuffixed();
  return candidate;
}
