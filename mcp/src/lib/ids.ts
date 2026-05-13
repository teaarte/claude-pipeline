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
import { randomUUID } from "node:crypto";

const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

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
