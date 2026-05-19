/**
 * D8 / Q69 regression: gate-1 message aggregates planning-phase reviewer
 * findings into a pre-filled "Suggested revision" block. UserAnswer's
 * decision enum gains "auto-apply" — when the harness emits it,
 * continue-task substitutes the stashed suggested-revision text as the
 * reject feedback so the planner respawn sees it.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { requireGate } from "../../../../../src/driver/core/registry.js";
import {
  pickLatestPlanningFindings,
  renderSuggestedRevision,
} from "../../../../../src/driver/bundles/code/gates/index.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import type { DriverState } from "../../../../../src/driver/types/plugin.js";

function baseState(projectDir: string): DriverState {
  const s = makeInitialDriverState({
    project_dir: projectDir,
    task: "implement feature X",
    flow_name: "medium",
  });
  s.decisions["complexity"] = "medium";
  s.decisions["tests_mode"] = "regression-only";
  return s;
}

async function writeFindings(projectDir: string, findings: any[]): Promise<void> {
  await mkdir(join(projectDir, ".claude"), { recursive: true });
  const body = findings.map((f) => JSON.stringify(f)).join("\n") + "\n";
  await writeFile(join(projectDir, ".claude", "findings.jsonl"), body, "utf8");
}

describe("D8 — gate-1 auto-derived suggested-revision", () => {
  it("pickLatestPlanningFindings filters to plan-phase reviewers + latest iteration only", () => {
    const findings = [
      {
        id: "f-1",
        agent: "logic-reviewer",
        iteration: 1,
        severity: "blocking",
        summary: "S1 (old iter)",
        status: "open",
      },
      {
        id: "f-2",
        agent: "logic-reviewer",
        iteration: 2,
        severity: "warn",
        summary: "S2",
        status: "open",
      },
      {
        id: "f-3",
        agent: "plan-grounding-check",
        iteration: 2,
        severity: "blocking",
        summary: "S3",
        status: "open",
      },
      {
        id: "f-4",
        agent: "style-reviewer", // impl-phase; should not appear
        iteration: 2,
        severity: "blocking",
        summary: "should not appear",
        status: "open",
      },
      {
        id: "f-5",
        agent: "logic-reviewer",
        iteration: 2,
        severity: "info",
        summary: "S5 (fixed already)",
        status: "fixed",
      },
    ];
    const latest = pickLatestPlanningFindings(findings);
    const ids = latest.map((f) => f.id);
    expect(ids).toContain("f-2");
    expect(ids).toContain("f-3");
    expect(ids).not.toContain("f-1"); // older iteration
    expect(ids).not.toContain("f-4"); // wrong phase
    expect(ids).not.toContain("f-5"); // status=fixed
    // Sort order: blocking before warn.
    expect(latest[0].severity).toBe("blocking");
  });

  it("renderSuggestedRevision produces a markdown block with severity + category + summary + suggested_fix", () => {
    const findings = [
      {
        id: "f-a",
        agent: "logic-reviewer",
        iteration: 1,
        severity: "blocking",
        category: "race-condition",
        summary: "missing await on async cache write",
        suggested_fix: "await cache.set before returning",
        status: "open",
      },
    ];
    const block = renderSuggestedRevision(findings);
    expect(block).toContain("Suggested revision");
    expect(block).toContain("BLOCKING");
    expect(block).toContain("race-condition");
    expect(block).toContain("missing await on async cache write");
    expect(block).toContain("Suggested fix: await cache.set before returning");
  });

  it("renderSuggestedRevision caps at 8 findings and reports overflow count", () => {
    const findings = Array.from({ length: 12 }, (_, i) => ({
      id: `f-${i}`,
      agent: "logic-reviewer",
      iteration: 1,
      severity: "info",
      category: "other",
      summary: `finding-${i}`,
      status: "open",
    }));
    const block = renderSuggestedRevision(findings);
    expect(block).toContain("finding-0");
    expect(block).toContain("finding-7");
    expect(block).not.toContain("finding-8");
    expect(block).toContain("(4 more findings)");
  });

  it("gate-1.message embeds the suggested-revision block when findings.jsonl has open planning findings", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d8-msg-"));
    try {
      await writeFindings(proj, [
        {
          id: "f-2026-05-19-aaaaaa",
          agent: "logic-reviewer",
          iteration: 1,
          task_id: "t-x",
          severity: "blocking",
          category: "missing-evidence",
          summary: "plan references undocumented seam",
          suggested_fix: "cite ROADMAP.md#item-7 in plan.md step 3",
          status: "open",
        },
      ]);
      const registry = createRegistry();
      await loadBundle("code", registry);
      const gate = requireGate(registry, "gate-1");
      const state = baseState(proj);
      const msg = await Promise.resolve(gate.message(state));
      expect(msg).toContain("Suggested revision");
      expect(msg).toContain("plan references undocumented seam");
      // Auto-apply prompt appears when revision is present.
      expect(msg).toContain("auto-apply");
      // The revision block is stashed on driver-state for D9 to reuse.
      expect(state.scratch["__gate_1_suggested_revision"]).toBeTruthy();
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("gate-1.message falls back to the simple accept/reject prompt when no planning findings exist", async () => {
    const proj = await mkdtemp(join(tmpdir(), "cp-d8-empty-"));
    try {
      const registry = createRegistry();
      await loadBundle("code", registry);
      const gate = requireGate(registry, "gate-1");
      const state = baseState(proj);
      const msg = await Promise.resolve(gate.message(state));
      expect(msg).toContain("Reply 1/accept or 2/reject");
      expect(msg).not.toContain("Suggested revision");
      expect(msg).not.toContain("auto-apply");
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });
});
