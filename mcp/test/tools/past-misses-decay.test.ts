import { describe, it, expect, afterEach } from "vitest";
import { clearMetrics, metricsDir } from "../helpers/setup.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  pipelineGetPastMisses,
  scoreEntry,
  MATCH_WINDOW,
  DECAY_HALFLIFE_DAYS_RAW,
} from "../../src/tools/get-past-misses.js";
import { pipelineSetPatternConfidence } from "../../src/tools/set-pattern-confidence.js";
import { pipelineLogAgentFeedback } from "../../src/tools/log-agent-feedback.js";

describe("scoreEntry — decay math", () => {
  it("recency_weight halves around 42 days (halflife from raw=60)", () => {
    const now = Date.parse("2026-05-13T00:00:00Z");
    const fresh = { date: "2026-05-13", agent: "x", category: "c" };
    const old42 = { date: "2026-04-01", agent: "x", category: "c" }; // 42d ago
    const veryOld = { date: "2025-11-13", agent: "x", category: "c" }; // ~180d ago
    const sF = scoreEntry(fresh, now, []);
    const sH = scoreEntry(old42, now, []);
    const sV = scoreEntry(veryOld, now, []);
    expect(sF).toBeGreaterThan(sH);
    expect(sH).toBeGreaterThan(sV);
    // approximate half-life: 42 days → exp(-42/60) ≈ 0.495
    expect(sH / sF).toBeGreaterThan(0.4);
    expect(sH / sF).toBeLessThan(0.6);
  });

  it("confidence multiplies the score", () => {
    const now = Date.parse("2026-05-13T00:00:00Z");
    const full = { date: "2026-05-13", agent: "x", category: "c", manual_confidence: 1.0 };
    const half = { date: "2026-05-13", agent: "x", category: "c", manual_confidence: 0.5 };
    expect(scoreEntry(full, now, [])).toBeGreaterThan(scoreEntry(half, now, []));
    const zero = { date: "2026-05-13", agent: "x", category: "c", manual_confidence: 0 };
    expect(scoreEntry(zero, now, [])).toBe(0);
  });

  it("match_rate boosts score when category appears in recent findings", () => {
    const now = Date.parse("2026-05-13T00:00:00Z");
    const e = { date: "2026-05-13", agent: "x", category: "race-condition" };
    const recentNoMatches = new Array(MATCH_WINDOW).fill({ category: "other" });
    const recentManyMatches = new Array(MATCH_WINDOW).fill({ category: "race-condition" });
    expect(scoreEntry(e, now, recentManyMatches)).toBeGreaterThan(scoreEntry(e, now, recentNoMatches));
  });

  it("category_hint adds a fixed bonus", () => {
    const now = Date.parse("2026-05-13T00:00:00Z");
    const e = { date: "2026-05-13", agent: "x", category: "race-condition" };
    expect(scoreEntry(e, now, [], "race-condition")).toBeGreaterThan(scoreEntry(e, now, []));
  });
});

describe("pipeline_get_past_misses — ranking", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("stale entry (no matches, > 60d old) drops out of top-10", async () => {
    // Hand-write the agent-feedback file: 11 entries, one of them stale.
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(
        JSON.stringify({
          schema_version: "1.0",
          feedback_id: `fb-2026-05-13-fresh${i.toString().padStart(2, "0")}`,
          date: "2026-05-13",
          agent: "logic-reviewer",
          category: `cat${i}`,
          pattern_to_look_for: "x",
          severity: "high",
          found_by: "human-review",
          human_confirmed: true,
        }),
      );
    }
    lines.push(
      JSON.stringify({
        schema_version: "1.0",
        feedback_id: "fb-2025-01-01-stale1",
        date: "2025-01-01", // > 1 year ago vs cwd 2026-05-13
        agent: "logic-reviewer",
        category: "very-stale",
        pattern_to_look_for: "x",
        severity: "high",
        found_by: "human-review",
        human_confirmed: true,
      }),
    );
    await writeFile(join(metricsDir, "agent-feedback.jsonl"), lines.join("\n") + "\n", "utf8");
    const r = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 10 });
    expect(r.count).toBe(10);
    expect(r.entries.some((e: any) => e.feedback_id === "fb-2025-01-01-stale1")).toBe(false);
  });

  it("entry with manual_confidence=0 is filtered out", async () => {
    await pipelineLogAgentFeedback({
      agent: "logic-reviewer",
      category: "race-condition",
      pattern_to_look_for: "x",
      severity: "high",
    });
    const all = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 10 });
    expect(all.count).toBe(1);
    await pipelineSetPatternConfidence({
      feedback_id: all.entries[0].feedback_id,
      confidence: 0,
    });
    const after = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 10 });
    expect(after.count).toBe(0);
  });
});

describe("pipeline_set_pattern_confidence", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("updates manual_confidence on the matching entry", async () => {
    await pipelineLogAgentFeedback({
      agent: "logic-reviewer",
      category: "race-condition",
      pattern_to_look_for: "p",
      severity: "medium",
    });
    const all = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 1 });
    const id = all.entries[0].feedback_id;
    const r = await pipelineSetPatternConfidence({ feedback_id: id, confidence: 0.3 });
    expect(r.updated).toBe(true);
    expect(r.manual_confidence).toBe(0.3);
    const after = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 1 });
    expect(after.entries[0].manual_confidence).toBe(0.3);
  });

  it("throws when feedback_id is unknown", async () => {
    // Need a non-empty file so set-pattern-confidence doesn't fail on "not found".
    await pipelineLogAgentFeedback({
      agent: "logic-reviewer",
      category: "race-condition",
      pattern_to_look_for: "p",
      severity: "medium",
    });
    await expect(
      pipelineSetPatternConfidence({
        feedback_id: "fb-2099-01-01-nope000",
        confidence: 0.5,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("decay constants are documented", () => {
  it("halflife raw constant is 60 (≈42 day half-life via exp)", () => {
    expect(DECAY_HALFLIFE_DAYS_RAW).toBe(60);
    // exp(-42/60) ≈ 0.495 ≈ 1/2
    expect(Math.exp(-42 / DECAY_HALFLIFE_DAYS_RAW)).toBeGreaterThan(0.49);
    expect(Math.exp(-42 / DECAY_HALFLIFE_DAYS_RAW)).toBeLessThan(0.51);
  });

  it("match window is 20", () => {
    expect(MATCH_WINDOW).toBe(20);
  });
});
