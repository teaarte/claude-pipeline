/**
 * H10 — set-pattern-confidence rewrites agent-feedback.jsonl. Without a
 * shared lock with log-agent-feedback, a concurrent append could be
 * clobbered by the rewrite. Coordinate via withFeedbackLock.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFile, mkdir } from "node:fs/promises";
import { pipelineLogAgentFeedback } from "../../src/tools/log-agent-feedback.js";
import { pipelineSetPatternConfidence } from "../../src/tools/set-pattern-confidence.js";
import { agentFeedbackJsonl, homeMetricsDir } from "../../src/lib/paths.js";
import { writeFile } from "node:fs/promises";

async function clearFeedback() {
  await mkdir(homeMetricsDir, { recursive: true }).catch(() => {});
  await writeFile(agentFeedbackJsonl, "", "utf8").catch(() => {});
}

async function readEntries(): Promise<any[]> {
  const raw = await readFile(agentFeedbackJsonl, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

describe("H10 — concurrent log + set-pattern-confidence", () => {
  afterEach(async () => {
    await clearFeedback();
  });

  it("interleaved log + set-pattern-confidence preserves both writes", async () => {
    await clearFeedback();
    // Seed one entry so set-pattern-confidence has something to flip.
    const seeded = await pipelineLogAgentFeedback({
      agent: "logic-reviewer",
      category: "race-condition",
      pattern_to_look_for: "unsynchronised counter",
    });
    const seededId = (seeded.entry as any).feedback_id as string;
    // Fire both writes simultaneously: a new log AND a confidence update on
    // the seeded entry. Without the shared lock, the rewrite would clobber
    // the second append.
    await Promise.all([
      pipelineLogAgentFeedback({
        agent: "challenger-reviewer",
        category: "off-by-one",
        pattern_to_look_for: "loop boundary",
      }),
      pipelineSetPatternConfidence({ feedback_id: seededId, confidence: 0 }),
    ]);
    const entries = await readEntries();
    expect(entries.length).toBe(2);
    const seededAfter = entries.find((e) => e.feedback_id === seededId);
    const newEntry = entries.find((e) => e.feedback_id !== seededId);
    expect(seededAfter?.manual_confidence).toBe(0);
    expect(newEntry?.agent).toBe("challenger-reviewer");
  });
});
