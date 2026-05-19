/**
 * Q68 / D7 regression — pipeline_record_agent_run side of INV_013.
 *
 * When acceptance is recorded with verdict=PASS but impl-phase reviewers at
 * the latest iteration still hold open blocking findings, the record MUST
 * be refused at the boundary — before pipeline-state and findings.jsonl are
 * committed. Without this gate, the silent ship-with-blockers anti-pattern
 * (observed in real-task frontend-core 2026-05-19) can complete the run and
 * land a metric row with verdict="accepted".
 */

import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics, reviewerOutput, validatorOutput, spawnReviewer, spawnNonreview } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";

async function driveToValidation(dir: string) {
  await pipelineInit(initArgs(dir));
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "context", status: "completed" });
  await spawnNonreview(dir, "planning", "planner");
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "planning", status: "completed" });
  await pipelineSetPhaseStatus({
    project_dir: dir,
    phase: "test_first",
    status: "skipped",
    skipped_reason: "regression-only",
  });
  await spawnNonreview(dir, "implementation", "implementer");
}

describe("Q68 / D7 — INV_013 fires at pipeline_record_agent_run", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("refuses acceptance PASS while a style-reviewer blocker is still open at the latest impl iter", async () => {
    const proj = await tempProject();
    try {
      await driveToValidation(proj.dir);
      // Record a style-reviewer with one blocking finding at impl iter=1.
      await spawnReviewer(
        proj.dir,
        "implementation",
        "logic-reviewer",
        reviewerOutput({ agent: "logic-reviewer", verdict: "REQUEST_CHANGES", iteration: 1 }),
      );
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "implementation",
        status: "completed",
      });
      // Now an acceptance PASS arrives. INV_013 must veto.
      await expect(
        spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput({ verdict: "PASS" })),
      ).rejects.toThrow(/INV_013/);
    } finally {
      await proj.cleanup();
    }
  });

  it("accepts acceptance PASS when impl reviewers have zero blockers", async () => {
    const proj = await tempProject();
    try {
      await driveToValidation(proj.dir);
      // Reviewer with NO findings — verdict APPROVE, blocking_issues=0.
      await spawnReviewer(
        proj.dir,
        "implementation",
        "logic-reviewer",
        reviewerOutput({ agent: "logic-reviewer", verdict: "APPROVE", findings: [] }),
      );
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "implementation",
        status: "completed",
      });
      const res = await spawnReviewer(
        proj.dir,
        "validation",
        "acceptance",
        validatorOutput({ verdict: "PASS" }),
      );
      expect(res.verdict).toBe("PASS");
    } finally {
      await proj.cleanup();
    }
  });

  it("accepts acceptance FAIL even when impl reviewers have open blockers", async () => {
    const proj = await tempProject();
    try {
      await driveToValidation(proj.dir);
      await spawnReviewer(
        proj.dir,
        "implementation",
        "logic-reviewer",
        reviewerOutput({ agent: "logic-reviewer", verdict: "REQUEST_CHANGES", iteration: 1 }),
      );
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "implementation",
        status: "completed",
      });
      // FAIL is the correct verdict here — INV_013 only fires on PASS-shaped verdicts.
      const res = await spawnReviewer(
        proj.dir,
        "validation",
        "acceptance",
        validatorOutput({ verdict: "FAIL" }),
      );
      expect(res.verdict).toBe("FAIL");
    } finally {
      await proj.cleanup();
    }
  });
});
