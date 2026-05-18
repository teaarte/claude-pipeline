/**
 * pickFromCandidates — pure LLM-classification primitive (Item 9 of v2.2.5).
 *
 * Given a task description + a closed set of candidate strings, ask an LLM
 * (via the optional `query` callback) which candidates apply, and return
 * the filtered + capped subset. Caller never receives anything not in the
 * supplied candidate set — defensive filter against hallucinated names.
 *
 * No regex on the task text. No multilingual keyword list. The LLM is the
 * authority; this function is the defensively-typed glue.
 *
 * Usage shape:
 *   - query undefined         → return []  (caller decides fallback)
 *   - query throws            → return []
 *   - malformed JSON          → return []
 *   - candidates contain ✗    → drop them, keep ✓
 *   - more than cap returned  → slice to cap (preserves LLM ordering)
 */

export interface PickQueryArgs {
  prompt: string;
  model?: string;
  max_tokens?: number;
  output_format?: "json-array" | "string";
}

export type PickQueryFn = (args: PickQueryArgs) => Promise<string>;

export interface PickFromCandidatesArgs<T extends string> {
  /** LLM query callback. Undefined → returns []. */
  query: PickQueryFn | undefined;
  /** Free-form task / context description. Passed verbatim into the prompt. */
  task: string;
  /** Closed candidate set. Empty → returns []. */
  candidates: readonly T[];
  /** Max returned items. Output is sliced after defensive filter. */
  cap: number;
  /** Optional extra context appended to the prompt (e.g. stack, agent list). */
  context_hint?: string;
  /** Override the haiku default (e.g. when caller wants opus for harder picks). */
  model?: string;
  /** Override the default 300-token cap on output. */
  max_tokens?: number;
}

export async function pickFromCandidates<T extends string>(
  args: PickFromCandidatesArgs<T>,
): Promise<T[]> {
  if (!args.query || args.candidates.length === 0) return [];
  const prompt = buildPrompt(args);
  try {
    const raw = await args.query({
      prompt,
      model: args.model ?? "haiku",
      max_tokens: args.max_tokens ?? 300,
      output_format: "json-array",
    });
    return parsePicked(raw, args.candidates).slice(0, args.cap);
  } catch {
    return [];
  }
}

function buildPrompt<T extends string>(args: PickFromCandidatesArgs<T>): string {
  const lines: string[] = [];
  lines.push(
    `You are a classifier. Return a JSON array (no prose, no markdown fences) of items from the candidate list that apply to the task. At most ${args.cap}. Empty array if nothing applies.`,
  );
  lines.push("");
  lines.push(`## Task`);
  lines.push(args.task);
  lines.push("");
  if (args.context_hint) {
    lines.push(`## Context`);
    lines.push(args.context_hint);
    lines.push("");
  }
  lines.push(`## Candidates`);
  for (const c of args.candidates) lines.push(`- ${c}`);
  lines.push("");
  lines.push(
    `## Output\nJSON array of at most ${args.cap} strings, each matching one candidate above exactly.`,
  );
  return lines.join("\n");
}

function parsePicked<T extends string>(raw: string, candidates: readonly T[]): T[] {
  const known = new Set<string>(candidates);
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: T[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    if (known.has(item)) out.push(item as T);
  }
  return out;
}
