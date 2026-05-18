import { readFile, writeFile, rename } from "node:fs/promises";
import { z } from "zod";
import { agentFeedbackJsonl } from "../lib/paths.js";
import { fileExists, withFeedbackLock } from "../lib/state-io.js";

export const setPatternConfidenceSchema = {
  feedback_id: z
    .string()
    .regex(/^fb-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}$/)
    .describe("feedback_id from agent-feedback.jsonl (fb-YYYY-MM-DD-slug)."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0.0 → permanently demote (drops out of past-misses ranking); 1.0 → trust fully."),
};

/**
 * The ONE place an agent-feedback.jsonl line is mutated. Rewrites the file
 * atomically so concurrent reads either see the old or new state, never a
 * torn write. Used by /agent-feedback to tune a past-miss pattern's weight.
 */
export async function pipelineSetPatternConfidence(input: {
  feedback_id: string;
  confidence: number;
}): Promise<{ updated: boolean; feedback_id: string; manual_confidence: number }> {
  if (!(await fileExists(agentFeedbackJsonl))) {
    throw new Error(`agent-feedback.jsonl not found at ${agentFeedbackJsonl}`);
  }
  return withFeedbackLock(agentFeedbackJsonl, async () => {
    const raw = await readFile(agentFeedbackJsonl, "utf8");
    const lines = raw.split("\n");
    let updated = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.feedback_id === input.feedback_id) {
          obj.manual_confidence = input.confidence;
          lines[i] = JSON.stringify(obj);
          updated = true;
          break;
        }
      } catch {
        /* skip malformed lines */
      }
    }
    if (!updated) {
      throw new Error(`feedback_id '${input.feedback_id}' not found in agent-feedback.jsonl`);
    }
    const tmp = `${agentFeedbackJsonl}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, lines.join("\n"), "utf8");
    await rename(tmp, agentFeedbackJsonl);
    return { updated: true, feedback_id: input.feedback_id, manual_confidence: input.confidence };
  });
}
