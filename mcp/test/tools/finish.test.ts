import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import {
  tempProject,
  initArgs,
  clearMetrics,
  reviewerOutput,
  validatorOutput,
  spawnNonreview,
  spawnReviewer,
  readJsonl,
  metricsDir,
} from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineSetGate } from "../../src/tools/set-gate.js";
import { pipelineFinish } from "../../src/tools/finish.js";

async function runFullPipeline(dir: string) {
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
  await spawnReviewer(dir, "implementation", "logic-reviewer", reviewerOutput());
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "implementation", status: "completed" });
  await spawnReviewer(dir, "validation", "acceptance", validatorOutput());
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "validation", status: "completed" });
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "final", status: "completed" });
  await pipelineSetGate({ project_dir: dir, gate: "gate0", status: "approved" });
  await pipelineSetGate({ project_dir: dir, gate: "gate1", status: "approved" });
  await pipelineSetGate({ project_dir: dir, gate: "gate2", status: "approved" });
}

describe("pipeline_finish", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("writes a metrics row on a clean accepted run", async () => {
    const proj = await tempProject();
    try {
      await runFullPipeline(proj.dir);
      const fin = await pipelineFinish({
        project_dir: proj.dir,
        verdict: "accepted",
        project_short: "test",
        task_short: "smoke",
      });
      expect(fin.verdict).toBe("accepted");
      expect(fin.metrics_row.task_id).toBe("t-2026-05-13-test");
      expect(fin.metrics_row.agents_count).toBeGreaterThanOrEqual(3);
      expect(fin.metrics_row.verdict).toBe("accepted");
      const rows = await readJsonl(join(metricsDir, "pipeline.jsonl"));
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[rows.length - 1].task_id).toBe("t-2026-05-13-test");
    } finally {
      await proj.cleanup();
    }
  });

  it("Q22: metrics row carries tests_mode from pipeline-state", async () => {
    const proj = await tempProject();
    try {
      await runFullPipeline(proj.dir);
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.tests_mode).toBe("regression-only");
    } finally {
      await proj.cleanup();
    }
  });

  it("Q22: tests_mode reflects 'tdd' when set at init time", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir, { tests_mode: "tdd" }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await spawnReviewer(proj.dir, "test_first", "test", validatorOutput({ agent: "test", verdict: "PASS" }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "test_first", status: "completed" });
      await spawnNonreview(proj.dir, "implementation", "implementer");
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.tests_mode).toBe("tdd");
    } finally {
      await proj.cleanup();
    }
  });

  it("Q22: impl_iters reads max iteration of a reviewer in implementation phase (uses Q20 phase field)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(proj.dir, "implementation", "implementer");
      // Two iterations of logic-reviewer in implementation (REQUEST_CHANGES → APPROVE).
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ iteration: 1, verdict: "REQUEST_CHANGES" }));
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ iteration: 2, verdict: "APPROVE", findings: [] }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.impl_iters).toBe(2);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q22: acceptance_first_pass=true when iter-1 acceptance PASSes", async () => {
    const proj = await tempProject();
    try {
      await runFullPipeline(proj.dir);
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.acceptance_first_pass).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q22: acceptance_first_pass=false when iter-1 acceptance FAILs but iter-2 passes", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(proj.dir, "implementation", "implementer");
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput({ verdict: "FAIL" }));
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput({ verdict: "PASS" }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.acceptance_first_pass).toBe(false);
    } finally {
      await proj.cleanup();
    }
  });

  it("refuses to finish when invariants fail", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      await expect(
        pipelineFinish({ project_dir: proj.dir, verdict: "accepted" }),
      ).rejects.toThrow(/invariant violation/);
    } finally {
      await proj.cleanup();
    }
  });
});
