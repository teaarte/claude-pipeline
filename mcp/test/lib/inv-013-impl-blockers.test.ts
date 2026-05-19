/**
 * Q68 / D7 regression: INV_013 — acceptance verdict=PASS ⇒ no open
 * severity:blocking findings from impl-phase reviewers at the latest impl
 * iteration.
 *
 * Real-task observation 2026-05-19: style-reviewer at impl iter=2 emitted
 * 3 prettier blockers on changed files; acceptance returned PASS because
 * `pnpm test/lint/build` ran against project scope where those files were
 * excluded. Without this invariant, the task would have shipped with
 * blockers still open at gate-2. Two layers land:
 * (a) prompt-side instruction in agents/acceptance.md to downgrade PASS→FAIL;
 * (b) INV_013 as the load-bearing safety net here.
 *
 * INV_013 fires at two boundaries:
 *  1. pipeline_record_agent_run when acceptance is recorded — throws before
 *     the state mutation commits.
 *  2. pipeline_finish via runInvariants — refuses the metric row.
 */

import { describe, it, expect } from "vitest";
import {
  checkAcceptancePassWithoutImplBlockers,
  runInvariants,
} from "../../src/lib/invariants.js";
import { findingsFile, claudeDir } from "../../src/lib/paths.js";
import { tempProject } from "../helpers/setup.js";
import { mkdir, writeFile } from "node:fs/promises";

describe("INV_013 — checkAcceptancePassWithoutImplBlockers (pure)", () => {
  it("returns null when no acceptance entry exists yet", () => {
    expect(
      checkAcceptancePassWithoutImplBlockers({
        reviewer_verdicts: [
          { agent: "logic-reviewer", phase: "implementation", iteration: 1, blocking_issues: 3 },
        ],
      }),
    ).toBeNull();
  });

  it("returns null when acceptance verdict is FAIL", () => {
    expect(
      checkAcceptancePassWithoutImplBlockers({
        reviewer_verdicts: [
          { agent: "logic-reviewer", phase: "implementation", iteration: 1, blocking_issues: 3 },
          { agent: "acceptance", phase: "validation", iteration: 1, verdict: "FAIL" },
        ],
      }),
    ).toBeNull();
  });

  it("returns null when impl reviewers have zero blocking_issues at latest iteration", () => {
    expect(
      checkAcceptancePassWithoutImplBlockers({
        reviewer_verdicts: [
          { agent: "logic-reviewer", phase: "implementation", iteration: 2, blocking_issues: 0 },
          { agent: "acceptance", phase: "validation", iteration: 1, verdict: "PASS" },
        ],
      }),
    ).toBeNull();
  });

  it("ignores stale iterations — only checks the latest impl iteration", () => {
    // iter=1 had blockers; iter=2 cleaned them up; acceptance PASS at iter=2 is fine.
    expect(
      checkAcceptancePassWithoutImplBlockers({
        reviewer_verdicts: [
          { agent: "style-reviewer", phase: "implementation", iteration: 1, blocking_issues: 5 },
          { agent: "style-reviewer", phase: "implementation", iteration: 2, blocking_issues: 0 },
          { agent: "acceptance", phase: "validation", iteration: 1, verdict: "PASS" },
        ],
      }),
    ).toBeNull();
  });

  it("fires INV_013 when acceptance.verdict=PASS but a reviewer at latest iter has blockers", () => {
    // The real-task case: style-reviewer at iter=2 with 3 prettier blockers,
    // acceptance returns PASS.
    const v = checkAcceptancePassWithoutImplBlockers({
      reviewer_verdicts: [
        { agent: "logic-reviewer", phase: "implementation", iteration: 2, blocking_issues: 0 },
        {
          agent: "style-reviewer",
          phase: "implementation",
          iteration: 2,
          blocking_issues: 3,
          categories_seen: ["formatting"],
        },
        { agent: "acceptance", phase: "validation", iteration: 1, verdict: "PASS" },
      ],
    });
    expect(v).not.toBeNull();
    expect(v?.code).toBe("INV_013");
    expect(v?.message).toMatch(/3 open blocking finding/);
    expect(v?.message).toMatch(/iteration=2/);
  });

  it("fires INV_013 for PASS_WITH_WARNINGS just like PASS — clean tool exit ≠ no reviewer blockers", () => {
    const v = checkAcceptancePassWithoutImplBlockers({
      reviewer_verdicts: [
        { agent: "logic-reviewer", phase: "implementation", iteration: 1, blocking_issues: 1 },
        { agent: "acceptance", phase: "validation", iteration: 1, verdict: "PASS_WITH_WARNINGS" },
      ],
    });
    expect(v?.code).toBe("INV_013");
  });

  it("aggregates blocking_issues across multiple impl reviewers at the latest iter", () => {
    const v = checkAcceptancePassWithoutImplBlockers({
      reviewer_verdicts: [
        { agent: "logic-reviewer", phase: "implementation", iteration: 2, blocking_issues: 2 },
        { agent: "style-reviewer", phase: "implementation", iteration: 2, blocking_issues: 3 },
        { agent: "challenger-reviewer", phase: "implementation", iteration: 2, blocking_issues: 1 },
        { agent: "acceptance", phase: "validation", iteration: 1, verdict: "PASS" },
      ],
    });
    expect(v?.code).toBe("INV_013");
    expect(v?.message).toMatch(/6 open blocking finding/);
  });
});

describe("INV_013 — runInvariants integration", () => {
  it("runInvariants emits INV_013 in its violation list when acceptance PASS coexists with impl blockers", async () => {
    const proj = await tempProject();
    try {
      // runInvariants reads findings.jsonl — write an empty one so the
      // INV_008 loop has nothing to chew on. The INV_013 check is purely
      // over state.reviewer_verdicts.
      await mkdir(claudeDir(proj.dir), { recursive: true });
      await writeFile(findingsFile(proj.dir), "", "utf8");
      const state: any = {
        schema_version: "1.1",
        task_id: "t-2026-05-19-inv013",
        bundle: "code",
        complexity: "medium",
        phases: {},
        gates: {},
        agents_count: 2,
        reviewer_verdicts: [
          { agent: "style-reviewer", phase: "implementation", iteration: 1, blocking_issues: 2 },
          { agent: "acceptance", phase: "validation", iteration: 1, verdict: "PASS" },
        ],
      };
      const violations = await runInvariants(state, findingsFile(proj.dir));
      const inv013 = violations.find((v) => v.code === "INV_013");
      expect(inv013).toBeDefined();
      expect(inv013?.message).toMatch(/2 open blocking finding/);
    } finally {
      await proj.cleanup();
    }
  });

  it("runInvariants does NOT emit INV_013 when acceptance verdict=FAIL on its own merit", async () => {
    const proj = await tempProject();
    try {
      await mkdir(claudeDir(proj.dir), { recursive: true });
      await writeFile(findingsFile(proj.dir), "", "utf8");
      const state: any = {
        schema_version: "1.1",
        task_id: "t-2026-05-19-inv013-2",
        bundle: "code",
        complexity: "medium",
        phases: {},
        gates: {},
        agents_count: 2,
        reviewer_verdicts: [
          { agent: "style-reviewer", phase: "implementation", iteration: 1, blocking_issues: 2 },
          { agent: "acceptance", phase: "validation", iteration: 1, verdict: "FAIL" },
        ],
      };
      const violations = await runInvariants(state, findingsFile(proj.dir));
      expect(violations.some((v) => v.code === "INV_013")).toBe(false);
    } finally {
      await proj.cleanup();
    }
  });
});
