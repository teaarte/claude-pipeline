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
//   recency_weight = exp(-age_days / 60)  → half-life ≈ 42 days
//   confidence     = entry.manual_confidence ?? 1.0
//   match_rate     = (times_matched_last_20 / 20) + 0.05
//   score          = recency_weight × confidence × match_rate
export const DECAY_HALFLIFE_DAYS_RAW = 60;
export const MATCH_WINDOW = 20;
export const MATCH_RATE_FLOOR = 0.05;
export const CATEGORY_HINT_BONUS = 0.5;

export function scoreEntry(
  entry: any,
  now: number,
  recentFindings: any[],
  categoryHint?: string,
): number {
  const date = Date.parse(entry.date + "T00:00:00Z");
  const ageDays = Number.isFinite(date) ? Math.max(0, (now - date) / 86_400_000) : 0;
  const recency = Math.exp(-ageDays / DECAY_HALFLIFE_DAYS_RAW);
  const confidence = typeof entry.manual_confidence === "number" ? entry.manual_confidence : 1.0;
  const matches = recentFindings.filter((f) => f.category === entry.category).length;
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

  // Read the most recent findings.jsonl to compute times_matched_last_20.
  // Pull from the global metrics dir's pipeline.jsonl row stream — that
  // captures "runs". For simplicity v2 reads the agent-feedback entries
  // themselves as a proxy when no per-task findings stream is available.
  const recentFindings = (await readJsonl(join(homeMetricsDir, "pipeline.jsonl"))).slice(-MATCH_WINDOW);

  const now = Date.now();
  const ranked = candidates
    .map((e) => ({ entry: e, score: scoreEntry(e, now, recentFindings, input.category_hint) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.top_n ?? 10);

  return {
    agent: input.agent,
    count: ranked.length,
    entries: ranked.map((r) => ({ ...r.entry, _score: Number(r.score.toFixed(4)) })),
  };
}
