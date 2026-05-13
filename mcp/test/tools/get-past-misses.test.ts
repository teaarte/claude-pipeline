import { describe, it, expect, afterEach } from "vitest";
import { clearMetrics } from "../helpers/setup.js";
import { pipelineLogAgentFeedback } from "../../src/tools/log-agent-feedback.js";
import { pipelineGetPastMisses } from "../../src/tools/get-past-misses.js";

describe("pipeline_get_past_misses", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("returns the last N human-confirmed entries for an agent", async () => {
    for (let i = 0; i < 3; i++) {
      await pipelineLogAgentFeedback({
        agent: "logic-reviewer",
        category: "race-condition",
        pattern_to_look_for: `pattern ${i}`,
        severity: "high",
        found_by: "human-review",
        human_confirmed: true,
      });
    }
    await pipelineLogAgentFeedback({
      agent: "security",
      category: "auth-bypass",
      pattern_to_look_for: "different agent",
      severity: "high",
      found_by: "human-review",
      human_confirmed: true,
    });
    const r = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 10 });
    expect(r.count).toBe(3);
    expect(r.entries.every((e: any) => e.agent === "logic-reviewer")).toBe(true);
  });

  it("filters out non-human-confirmed entries by default", async () => {
    await pipelineLogAgentFeedback({
      agent: "logic-reviewer",
      category: "race-condition",
      pattern_to_look_for: "not confirmed",
      severity: "high",
      human_confirmed: false,
    });
    const r = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 10 });
    expect(r.count).toBe(0);
  });

  it("returns 0 entries when no feedback exists", async () => {
    const r = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 10 });
    expect(r.count).toBe(0);
    expect(r.entries).toEqual([]);
  });
});
