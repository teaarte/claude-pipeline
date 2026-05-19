/**
 * Q73 / D12 regression: summary_line schema cap raised from 100 → 150 chars.
 *
 * Real-task observation 2026-05-19: 2 schema-validation errors at planning
 * phase, both /summary_line: must NOT have more than 100 characters.
 * Templates explicitly said ≤100 chars in Output constraints, but agents
 * emit longer summaries on complex tasks. The system self-corrected via
 * lenient-parse retry (`error_class: "schema-validation"`) — at the cost of
 * audit noise + extra latency. 150 is roomy enough for legitimate
 * single-line summaries on complex tasks without becoming a paragraph.
 */

import { describe, it, expect } from "vitest";
import { validate } from "../../src/lib/schemas.js";

const REVIEWER_BASE = {
  schema_version: "1.0",
  agent: "logic-reviewer",
  task_id: "t-2026-05-19-test",
  iteration: 1,
  verdict: "APPROVE",
  findings: [],
  past_misses_applied: 0,
  past_miss_matches: [],
  ref_rules_consulted: [],
};

const VALIDATOR_BASE = {
  schema_version: "1.0",
  agent: "acceptance",
  task_id: "t-2026-05-19-test",
  iteration: 1,
  verdict: "PASS",
  findings: [],
  details: {},
};

describe("Q73 / D12 — summary_line cap is 150 chars", () => {
  it("reviewer-output: 100-char summary_line passes (regression: didn't fail before, must not fail now)", async () => {
    const v = await validate("reviewer-output.schema.json", {
      ...REVIEWER_BASE,
      summary_line: "a".repeat(100),
    });
    expect(v.ok).toBe(true);
  });

  it("reviewer-output: 150-char summary_line passes (the new cap)", async () => {
    const v = await validate("reviewer-output.schema.json", {
      ...REVIEWER_BASE,
      summary_line: "a".repeat(150),
    });
    expect(v.ok).toBe(true);
  });

  it("reviewer-output: 200-char summary_line fails", async () => {
    const v = await validate("reviewer-output.schema.json", {
      ...REVIEWER_BASE,
      summary_line: "a".repeat(200),
    });
    expect(v.ok).toBe(false);
  });

  it("reviewer-output: 151-char summary_line fails (cap is exactly 150)", async () => {
    const v = await validate("reviewer-output.schema.json", {
      ...REVIEWER_BASE,
      summary_line: "a".repeat(151),
    });
    expect(v.ok).toBe(false);
  });

  it("validator-output: 150-char summary_line passes (the new cap)", async () => {
    const v = await validate("validator-output.schema.json", {
      ...VALIDATOR_BASE,
      summary_line: "a".repeat(150),
    });
    expect(v.ok).toBe(true);
  });

  it("validator-output: 200-char summary_line fails", async () => {
    const v = await validate("validator-output.schema.json", {
      ...VALIDATOR_BASE,
      summary_line: "a".repeat(200),
    });
    expect(v.ok).toBe(false);
  });
});
