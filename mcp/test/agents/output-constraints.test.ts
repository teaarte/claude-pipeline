/**
 * Q21: reviewer/validator output examples must respect their JSON-schema
 * constraints (summary_line ≤ 100, findings[].id pattern, findings[].summary
 * ≤ 200). Verifies via direct schema validation calls.
 *
 * Two prongs of Q21:
 *   - Prong A: each agent template now carries an "Output constraints"
 *     bullet list; this test grep-asserts that.
 *   - Prong B: schema negative checks — a 101-char summary_line and a
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
    expect(md).toContain("`summary_line`: ≤ 100 chars");
    expect(md).toContain("f-\\d{4}-\\d{2}-\\d{2}-[a-z0-9]{6}");
    expect(md).toContain("`findings[].summary`: ≤ 200 chars");
  });

  it("schema rejects a summary_line over 100 chars", async () => {
    const header = {
      schema_version: "1.0",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q21test",
      iteration: 1,
      verdict: "APPROVE",
      summary_line: "x".repeat(101),
      findings: [],
      past_misses_applied: 0,
      past_miss_matches: [],
      ref_rules_consulted: [],
    };
    const r = await validate("reviewer-output.schema.json", header);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /summary_line/.test(e.path) && /more than 100/.test(e.message))).toBe(true);
    }
  });

  it("schema accepts summary_line of exactly 100 chars", async () => {
    const header = {
      schema_version: "1.0",
      agent: "logic-reviewer",
      task_id: "t-2026-05-14-q21test",
      iteration: 1,
      verdict: "APPROVE",
      summary_line: "x".repeat(100),
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
