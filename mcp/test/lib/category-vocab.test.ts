/**
 * Q29: vocab-coverage regressions.
 *
 *   - logic-reviewer gains spec-deviation / scope-creep / coverage-gap,
 *     inserted before "other".
 *   - Every agent named in finding.schema.json's `agent` enum MUST have a
 *     non-empty vocab entry. Catches the Q9 "vocab loaded but agent name
 *     missing from the map" footgun.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schemasDir } from "../../src/lib/paths.js";

async function loadJson<T>(name: string): Promise<T> {
  const raw = await readFile(join(schemasDir, name), "utf8");
  return JSON.parse(raw) as T;
}

describe("Q29 — category vocab", () => {
  it("vocab.logic-reviewer contains the three new categories", async () => {
    const v = await loadJson<{ vocab: Record<string, string[]> }>(
      "category-vocab.json",
    );
    expect(v.vocab["logic-reviewer"]).toContain("spec-deviation");
    expect(v.vocab["logic-reviewer"]).toContain("scope-creep");
    expect(v.vocab["logic-reviewer"]).toContain("coverage-gap");
  });

  it("vocab.logic-reviewer still ends with 'other'", async () => {
    const v = await loadJson<{ vocab: Record<string, string[]> }>(
      "category-vocab.json",
    );
    const list = v.vocab["logic-reviewer"];
    expect(list[list.length - 1]).toBe("other");
  });

  it("every agent in finding.schema.json:agent enum has a non-empty vocab", async () => {
    const finding = await loadJson<{
      properties: { agent: { enum: string[] } };
    }>("finding.schema.json");
    const vocab = await loadJson<{ vocab: Record<string, string[]> }>(
      "category-vocab.json",
    );

    // `implementer` emits findings without going through the vocab gate
    // (it isn't a reviewer/validator class); vocab coverage is required
    // only for the agents that produce findings via record-agent-run.
    const REVIEWER_OR_VALIDATOR_AGENTS = finding.properties.agent.enum.filter(
      (a) => a !== "implementer",
    );

    for (const agent of REVIEWER_OR_VALIDATOR_AGENTS) {
      expect(vocab.vocab[agent], `vocab missing for ${agent}`).toBeDefined();
      expect(
        vocab.vocab[agent].length,
        `vocab.${agent} is empty`,
      ).toBeGreaterThan(0);
    }
  });
});
