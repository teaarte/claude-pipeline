/**
 * 3-stage parse of an agent's JSON header (item 6).
 *
 * Stage 1: locate a fenced ```json block, parse strictly. If valid → return.
 * Stage 2: lenient. Scan the first 500 chars for a top-level balanced
 *          {...} object; parse. If valid → return with repaired=true.
 *          Caller is responsible for schema-validating the result; success
 *          there means we recovered from a missing or malformed code fence.
 * Stage 3: throw with the strict reason.
 *
 * Bounds (Logic L7):
 *  - LENIENT_SCAN_LIMIT (500): where the opening `{` must start.
 *  - LENIENT_OBJECT_CEILING (128 KB): max bytes we'll walk to find the
 *    matching closing `}`. Agent outputs are realistically <100KB.
 *  - LENIENT_RETRY_CAP (5): if a balanced candidate fails JSON.parse, we
 *    try the next one up to this many times — defeats O(n²) on pathological
 *    `{xxx{xxx{...` input.
 *
 * Returns the parsed value plus a `repaired` boolean. Callers propagate
 * `_repaired: true` into their response payload for audit visibility; the
 * MCP driver treats it as informational, not an error.
 */
const LENIENT_SCAN_LIMIT = 500;
const LENIENT_OBJECT_CEILING = 128 * 1024;
const LENIENT_RETRY_CAP = 5;

export type ParseResult =
  | { ok: true; value: any; repaired: boolean }
  | { ok: false; reason: string };

export function extractJsonHeader(text: string): ParseResult {
  // Stage 1: strict fenced block.
  const match = text.match(/```json\s*\r?\n([\s\S]*?)\r?\n```/);
  if (match) {
    const raw = match[1].trim();
    try {
      return { ok: true, value: JSON.parse(raw), repaired: false };
    } catch (e: any) {
      // fall through to lenient
      const lenient = tryLenient(text);
      if (lenient) return { ok: true, value: lenient, repaired: true };
      return { ok: false, reason: `JSON parse error inside fenced block: ${e.message}` };
    }
  }
  // Stage 2: lenient scan of the head.
  const lenient = tryLenient(text);
  if (lenient) return { ok: true, value: lenient, repaired: true };

  // Stage 3: throw.
  return { ok: false, reason: "no fenced ```json block found in agent output" };
}

/**
 * Walk the head of `text` to find a top-level balanced {...} JSON object and
 * parse it. String-aware: skips brace characters inside JSON string literals
 * (handles \" escapes). When the first balanced candidate fails JSON.parse,
 * the scan continues forward to try the next one — useful when a broken
 * fenced block precedes a valid object in narrative text. Returns the first
 * parseable object or null.
 */
function tryLenient(text: string): any | null {
  let cursor = 0;
  let attempts = 0;
  while (cursor < text.length && attempts < LENIENT_RETRY_CAP) {
    attempts++;
    const head = text.slice(cursor, cursor + LENIENT_SCAN_LIMIT);
    const startRel = head.indexOf("{");
    if (startRel === -1) return null;
    const start = cursor + startRel;
    const inspectEnd = Math.min(text.length, start + LENIENT_OBJECT_CEILING);
    let depth = 0;
    let inString = false;
    let escape = false;
    let closed = -1;
    for (let i = start; i < inspectEnd; i++) {
      const c = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (c === "\\") {
          escape = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          closed = i;
          break;
        }
      }
    }
    if (closed === -1) return null;
    const candidate = text.slice(start, closed + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      cursor = closed + 1;
    }
  }
  return null;
}

// Re-export the canonical ID helpers from lib/ids.ts. Existing call sites
// keep importing from parse-json-header for backwards compatibility while
// the producer lives in one place (Style #3, #4).
export { makeFindingId } from "./ids.js";
