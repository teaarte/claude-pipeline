/**
 * Q41: refs-to-load picks the senior-pattern references that should be
 * threaded into agent prompts for this task. Two paths:
 *
 *   1. LLM-driven (preferred). When `ctx.spawn_provider.query` is available
 *      (i.e. the registered provider can make one-shot classification calls
 *      out-of-band), the decision builds a prompt containing the task, the
 *      detected stack, the list of active agents, and the parsed frontmatter
 *      summaries of every ref file. The LLM returns a ranked JSON array; we
 *      cap at 5.
 *
 *   2. Regex fallback. When no `query()` is available (shuttle-only provider,
 *      test contexts that didn't inject a mock, or a query throw at runtime),
 *      the decision falls back to the pre-Q41 task-text regex matching. This
 *      keeps the behavior at least as good as before — never worse.
 *
 * Cached results are returned as-is so re-entry doesn't re-evaluate.
 */

import type {
  DecisionContext,
  DecisionPlugin,
  DriverState,
} from "../../../types/plugin.js";
import {
  loadRefsMetadata,
  type RefMetadata,
} from "./refs-metadata.js";

const MAX_REFS = 5;

export const refsToLoadDecision: DecisionPlugin<string[]> = {
  name: "refs_to_load",
  async decide(state: DriverState, ctx?: DecisionContext): Promise<string[]> {
    const cached = state.decisions["refs_to_load"];
    if (Array.isArray(cached) && cached.every((c) => typeof c === "string")) {
      return cached as string[];
    }
    const query = ctx?.spawn_provider?.query?.bind(ctx.spawn_provider);
    if (query) {
      try {
        const refsMetadata = await loadRefsMetadata();
        if (refsMetadata.length > 0) {
          const prompt = buildSelectionPrompt({
            task: state.task,
            stack: extractStack(state),
            active_agents: ctx?.active_agents ?? [],
            refs: refsMetadata,
            cap: MAX_REFS,
          });
          const result = await query({
            prompt,
            model: "haiku",
            max_tokens: 200,
            output_format: "json-array",
          });
          const picked = parsePickedRefs(result, refsMetadata);
          if (picked.length > 0) return picked.slice(0, MAX_REFS);
        }
      } catch {
        // Fall through to the regex fallback. Audit emission is handled by
        // the FSM's invoke wrapper; refs-to-load itself stays pure.
      }
    }
    return regexFallback(state).slice(0, MAX_REFS);
  },
};

interface SelectionPromptInput {
  task: string;
  stack: Record<string, unknown> | null;
  active_agents: string[];
  refs: RefMetadata[];
  cap: number;
}

/**
 * Exported so tests can assert the shape of the prompt without going through
 * the spawn provider.
 */
export function buildSelectionPrompt(input: SelectionPromptInput): string {
  const lines: string[] = [];
  lines.push(
    `You are a reference-selection classifier. Pick at most ${input.cap} reference files most relevant to the task. Output ONLY a JSON array of filename strings (no prose, no markdown fences).`,
  );
  lines.push("");
  lines.push(`## Task`);
  lines.push(input.task);
  lines.push("");
  if (input.stack) {
    lines.push(`## Project stack`);
    lines.push(JSON.stringify(input.stack));
    lines.push("");
  }
  if (input.active_agents.length > 0) {
    lines.push(`## Active agents (these will read the picked refs)`);
    lines.push(input.active_agents.join(", "));
    lines.push("");
  }
  lines.push(`## Available references`);
  for (const ref of input.refs) {
    lines.push(`### ${ref.filename}`);
    if (ref.tags.length > 0) lines.push(`tags: ${ref.tags.join(", ")}`);
    if (ref.agent_hints.length > 0)
      lines.push(`agent_hints: ${ref.agent_hints.join(", ")}`);
    lines.push(`summary: ${ref.summary}`);
    lines.push(`when_to_load: ${ref.when_to_load}`);
    lines.push("");
  }
  lines.push(`## Output`);
  lines.push(
    `JSON array, at most ${input.cap} entries, each entry exactly matching one filename above. Empty array if nothing fits. No prose.`,
  );
  return lines.join("\n");
}

/**
 * Parse the LLM's JSON-array output and filter to known ref filenames so a
 * hallucinated filename can't leak into the prompt. Exported for tests.
 */
export function parsePickedRefs(raw: string, refs: RefMetadata[]): string[] {
  const known = new Set(refs.map((r) => r.filename));
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    if (known.has(item)) out.push(item);
  }
  return out;
}

function extractStack(state: DriverState): Record<string, unknown> | null {
  const fromScratch = state.scratch?.stack;
  if (fromScratch && typeof fromScratch === "object") return fromScratch as Record<string, unknown>;
  return null;
}

/**
 * Pre-Q41 regex-based ref selection. Preserved as a safety net so the
 * decision never returns a worse result than the old implementation when
 * the LLM path is unavailable.
 */
function regexFallback(state: DriverState): string[] {
  const refs: string[] = [];
  const task = state.task.toLowerCase();
  const complexity =
    (state.decisions["complexity"] as string) ??
    (state.scratch?.complexity as string) ??
    "medium";

  if (complexity === "complex" || /architecture|service|design|refactor|migrate|split/.test(task)) {
    refs.push("agents/references/arch-patterns.md");
  }
  if (/cache|cdn|invalidat|stale|ttl/.test(task)) refs.push("agents/references/caching.md");
  if (/query|index|migration|schema|sql/.test(task)) refs.push("agents/references/db-postgres.md");
  if (/cache|queue|rate.?limit|session.?store|lock|redis/.test(task)) refs.push("agents/references/redis.md");

  if (/api|endpoint|rest|graphql|contract/.test(task)) refs.push("agents/references/api-design.md");
  if (/race|concurrent|parallel|lock|queue|retry|atomicity/.test(task)) refs.push("agents/references/concurrency.md");
  if (/log|metric|trace|telemetry|alert|slo/.test(task)) refs.push("agents/references/observability.md");

  if (/auth|login|permission|secret|password|jwt|csrf|oauth/.test(task)) {
    refs.push("agents/references/security-backend.md");
  }
  if (/perf|optimize|latency|throughput|slow|bottleneck/.test(task)) {
    refs.push("agents/references/optimization-strategy.md");
  }
  return refs;
}
