/**
 * Q21: reviewer/validator output examples must respect their JSON-schema
 * constraints (summary_line ≤ 150 since Q73 / D12, findings[].id pattern,
 * findings[].summary ≤ 200). Verifies via direct schema validation calls.
 *
 * Two prongs of Q21:
 *   - Prong A: each agent template now carries an "Output constraints"
 *     bullet list; this test grep-asserts that.
 *   - Prong B: schema negative checks — an over-cap summary_line and a
 *     wrong-shaped finding id both fail validation, proving the schema
 *     itself still enforces what we claim to the agent.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipelineRoot } from "../../src/lib/paths.js";
import { validate } from "../../src/lib/schemas.js";

const REVIEWER_AGENTS = [
  "logic-reviewer",
  "challenger-reviewer",
  "style-reviewer",
  "security",
  "performance",
];
const VALIDATOR_AGENTS = [
  "acceptance",
  "plan-conformance",
  "plan-grounding-check",
  "context-doc-verifier",
  "ui-consistency",
  "api-contract",
  "playwright",
  "test",
];
const ALL_AGENTS = [...REVIEWER_AGENTS, ...VALIDATOR_AGENTS];

describe("Q21 — agent output constraints", () => {
  it.each(ALL_AGENTS)("agents/%s.md carries the Output constraints bullet list", async (agent) => {
    const md = await readFile(join(pipelineRoot, "agents", `${agent}.md`), "utf8");
    expect(md).toContain("## Output constraints (hard validation)");
    expect(md).toContain("`summary_line`: ≤ 150 chars");
    expect(md).toContain("f-\\d{4}-\\d{2}-\\d{2}-[a-z0-9]{6}");
    expect(md).toContain("`findings[].summary`: ≤ 200 chars");
    // Q28: per-finding schema_version rule must appear in every template
    expect(md).toContain("`findings[].schema_version`: required");
  });

  // Q73 / D12: cap raised 100 → 150. Schema rejects summary_line > 150.
  it("schema rejects a summary_line over 150 chars", async () => {
    const header = {
      schema_version: "1.0",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q21test",
      iteration: 1,
      verdict: "APPROVE",
      summary_line: "x".repeat(151),
      findings: [],
      past_misses_applied: 0,
      past_miss_matches: [],
      ref_rules_consulted: [],
    };
    const r = await validate("reviewer-output.schema.json", header);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /summary_line/.test(e.path) && /more than 150/.test(e.message))).toBe(true);
    }
  });

  it("schema accepts summary_line of exactly 150 chars (Q73 / D12 cap)", async () => {
    const header = {
      schema_version: "1.0",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q21test",
      iteration: 1,
      verdict: "APPROVE",
      summary_line: "x".repeat(150),
      findings: [],
      past_misses_applied: 0,
      past_miss_matches: [],
      ref_rules_consulted: [],
    };
    const r = await validate("reviewer-output.schema.json", header);
    expect(r.ok).toBe(true);
  });

  it("finding.schema rejects an id that doesn't match the pattern", async () => {
    const finding = {
      schema_version: "1.0",
      id: "f-bad-id",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q21test",
      iteration: 1,
      file: "src/x.ts",
      line_start: 1,
      line_end: 2,
      severity: "info",
      category: "other",
      summary: "x",
      evidence_excerpt: "x",
      suggested_fix: "x",
      status: "open",
    };
    const r = await validate("finding.schema.json", finding);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /id/.test(e.path))).toBe(true);
    }
  });

  it("finding.schema accepts an id of the documented form", async () => {
    const finding = {
      schema_version: "1.0",
      id: "f-2026-05-14-a3b9k7",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q21test",
      iteration: 1,
      file: "src/x.ts",
      line_start: 1,
      line_end: 2,
      severity: "info",
      category: "other",
      summary: "x",
      evidence_excerpt: "x",
      suggested_fix: "x",
      status: "open",
    };
    const r = await validate("finding.schema.json", finding);
    expect(r.ok).toBe(true);
  });

  it("Q28: reviewer-output validates clean when each finding carries schema_version", async () => {
    const header = {
      schema_version: "1.0",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q28test",
      iteration: 1,
      verdict: "APPROVE",
      summary_line: "no issues",
      findings: [
        {
          schema_version: "1.0",
          id: "f-2026-05-14-a3b9k7",
          agent: "logic-reviewer",
          iteration: 1,
          task_id: "t-2026-05-14-q28test",
          file: "src/x.ts",
          line_start: 1,
          line_end: 2,
          severity: "info",
          category: "other",
          summary: "x",
          evidence_excerpt: "x",
          suggested_fix: "x",
          status: "open",
        },
      ],
      past_misses_applied: 0,
      past_miss_matches: [],
      ref_rules_consulted: [],
    };
    const r = await validate("reviewer-output.schema.json", header);
    expect(r.ok).toBe(true);
  });

  it("Q28: validator-output rejects a finding missing schema_version", async () => {
    const header = {
      schema_version: "1.0",
      agent: "acceptance",
      task_id: "t-2026-05-14-q28test",
      iteration: 1,
      verdict: "PASS",
      summary_line: "ok",
      findings: [
        {
          // intentionally omit schema_version
          id: "f-2026-05-14-a3b9k7",
          agent: "acceptance",
          iteration: 1,
          task_id: "t-2026-05-14-q28test",
          file: null,
          line_start: null,
          line_end: null,
          severity: "warn",
          category: "other",
          summary: "x",
          evidence_excerpt: null,
          suggested_fix: null,
          status: "open",
        },
      ],
    };
    const r = await validate("validator-output.schema.json", header);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some(
          (e) => /findings\/0/.test(e.path) && /schema_version/.test(e.message + e.path),
        ),
      ).toBe(true);
    }
  });

  it("finding.schema rejects a summary > 200 chars", async () => {
    const finding = {
      schema_version: "1.0",
      id: "f-2026-05-14-a3b9k7",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q21test",
      iteration: 1,
      file: "src/x.ts",
      line_start: 1,
      line_end: 2,
      severity: "info",
      category: "other",
      summary: "x".repeat(201),
      evidence_excerpt: "x",
      suggested_fix: "x",
      status: "open",
    };
    const r = await validate("finding.schema.json", finding);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /summary/.test(e.path) && /more than 200/.test(e.message))).toBe(true);
    }
  });
});
