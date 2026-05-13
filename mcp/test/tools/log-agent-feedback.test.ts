import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { clearMetrics, metricsDir, readJsonl } from "../helpers/setup.js";
import { pipelineLogAgentFeedback } from "../../src/tools/log-agent-feedback.js";

describe("pipeline_log_agent_feedback", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("appends a valid entry to agent-feedback.jsonl", async () => {
    const r = await pipelineLogAgentFeedback({
      agent: "logic-reviewer",
      category: "race-condition",
      pattern_to_look_for: "await retry without mutex",
      severity: "high",
      found_by: "human-review",
      human_confirmed: true,
    });
    expect(r.written).toBe(true);
    expect(r.entry.agent).toBe("logic-reviewer");
    const rows = await readJsonl(join(metricsDir, "agent-feedback.jsonl"));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("race-condition");
    expect(rows[0].schema_version).toBe("1.0");
    expect(rows[0].feedback_id).toMatch(/^fb-/);
  });

  it("rejects an entry whose agent is not in the enum (schema validation)", async () => {
    // pipelineLogAgentFeedback runs schema validate; bypass zod by casting.
    await expect(
      pipelineLogAgentFeedback({
        agent: "not-a-real-agent" as any,
        category: "x",
        pattern_to_look_for: "y",
        severity: "high",
      } as any),
    ).rejects.toThrow(/schema validation/);
  });
});
