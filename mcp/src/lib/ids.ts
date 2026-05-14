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

const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * task_id pattern shared with the JSON schema and the zod schemas in
 * `tools/init.ts` and `driver/tools/run-task.ts`. Slug part is
 * alphanumeric-only — hyphens, underscores, and unicode are stripped.
 */
export const TASK_ID_PATTERN = /^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}$/;

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
