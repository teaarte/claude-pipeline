import { z } from "zod";
import { agentFeedbackJsonl, homeMetricsDir } from "../lib/paths.js";
import { readJsonl } from "../lib/state-io.js";
import { join } from "node:path";

export const getPastMissesSchema = {
  agent: z.string().describe("Agent name to filter on, e.g. 'logic-reviewer'"),
  top_n: z.number().int().min(1).max(50).default(10),
  human_confirmed_only: z.boolean().default(true),
  category_hint: z
    .string()
    .optional()
    .describe(
      "Optional category bias. Entries matching this category get a +0.5 score bonus before ranking.",
    ),
};

// Decay constants (item 11):
//   recency_weight = exp(-age_days / DECAY_TIMECONSTANT_DAYS)
//   confidence     = entry.manual_confidence ?? 1.0
//   match_rate     = (matches_in_last_N_runs / MATCH_WINDOW) + MATCH_RATE_FLOOR
//   score          = recency_weight × confidence × match_rate
//
// DECAY_TIMECONSTANT_DAYS=60 gives half-life ≈ ln(2)*60 ≈ 41.6 days — call
// it "~42-day half-life" in docs (Challenger #2). Old export name retained
// as alias for backwards compatibility within the suite.
export const DECAY_TIMECONSTANT_DAYS = 60;
export const DECAY_HALFLIFE_DAYS_RAW = DECAY_TIMECONSTANT_DAYS;
export const MATCH_WINDOW = 20;
export const MATCH_RATE_FLOOR = 0.05;
export const CATEGORY_HINT_BONUS = 0.5;

/**
 * Score one feedback entry against the recent N runs from
 * ~/.claude/metrics/pipeline.jsonl. We match on `categories_seen[]` —
 * that's the array of finding categories the run actually emitted
 * (populated by pipeline_finish). The original implementation looked at
 * row.category which doesn't exist; match_rate was effectively dead
 * (Challenger #3).
 */
export function scoreEntry(
  entry: any,
  now: number,
  recentRuns: any[],
  categoryHint?: string,
): number {
  const date = Date.parse(entry.date + "T00:00:00Z");
  const ageDays = Number.isFinite(date) ? Math.max(0, (now - date) / 86_400_000) : 0;
  const recency = Math.exp(-ageDays / DECAY_TIMECONSTANT_DAYS);
  const confidence = typeof entry.manual_confidence === "number" ? entry.manual_confidence : 1.0;
  const matches = recentRuns.filter((row) => {
    if (Array.isArray(row?.categories_seen) && row.categories_seen.includes(entry.category)) return true;
    // Legacy back-compat: some test fixtures put `category` directly on the
    // row instead of `categories_seen[]`.
    return row?.category === entry.category;
  }).length;
  const matchRate = matches / MATCH_WINDOW + MATCH_RATE_FLOOR;
  let score = recency * confidence * matchRate;
  if (categoryHint && entry.category === categoryHint) score += CATEGORY_HINT_BONUS;
  return score;
}

export async function pipelineGetPastMisses(input: {
  agent: string;
  top_n?: number;
  human_confirmed_only?: boolean;
  category_hint?: string;
}): Promise<any> {
  const all = await readJsonl(agentFeedbackJsonl);
  const candidates = all.filter((e) => {
    if (e.agent !== input.agent) return false;
    if ((input.human_confirmed_only ?? true) && !e.human_confirmed) return false;
    if (typeof e.manual_confidence === "number" && e.manual_confidence <= 0) return false;
    return true;
  });

  // Recent runs from the global pipeline.jsonl. Each row carries
  // categories_seen[] — the list of finding categories from that run.
  const recentRuns = (await readJsonl(join(homeMetricsDir, "pipeline.jsonl"))).slice(-MATCH_WINDOW);

  const now = Date.now();
  const ranked = candidates
    .map((e) => ({ entry: e, score: scoreEntry(e, now, recentRuns, input.category_hint) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.top_n ?? 10);

  return {
    agent: input.agent,
    count: ranked.length,
    entries: ranked.map((r) => ({ ...r.entry, _score: Number(r.score.toFixed(4)) })),
  };
}
