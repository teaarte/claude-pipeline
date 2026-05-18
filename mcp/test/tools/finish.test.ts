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

  it("Q43: impl_iters counts reviewer_verdicts entries in implementation phase", async () => {
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

  it("Q43: cross-phase same-agent — iter=1 in planning + iter=2 in implementation → impl_iters=1, plan_iters=1", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      // logic-reviewer iter=1 in planning (e.g., plan review).
      await spawnReviewer(
        proj.dir,
        "planning",
        "logic-reviewer",
        reviewerOutput({ iteration: 1, verdict: "APPROVE", findings: [] }),
      );
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(proj.dir, "implementation", "implementer");
      // Same logic-reviewer in implementation. Global iter=2 (Q20 semantics),
      // but only 1 verdict for the implementation phase ⇒ impl_iters MUST be 1,
      // not 2 (which the old max(iteration) derivation incorrectly produced).
      await spawnReviewer(
        proj.dir,
        "implementation",
        "logic-reviewer",
        reviewerOutput({ iteration: 2, verdict: "APPROVE", findings: [] }),
      );
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.impl_iters).toBe(1);
      expect(fin.metrics_row.plan_iters).toBe(1);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q43: empty implementation phase reviews → impl_iters=0", async () => {
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
      // No reviewer verdicts in implementation (degenerate but possible during fixture work).
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.impl_iters).toBe(0);
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

  it("Q32: deprecated phases.validation.acceptance_first_pass is absent from initial template and schema", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { pipelineRoot } = await import("../../src/lib/paths.js");
    const tpl = JSON.parse(
      await readFile(join(pipelineRoot, "templates", "pipeline-state.json"), "utf8"),
    );
    expect(tpl.phases.validation).not.toHaveProperty("acceptance_first_pass");
    const schemaRaw = await readFile(
      join(pipelineRoot, "templates", "schemas", "pipeline-state.schema.json"),
      "utf8",
    );
    expect(schemaRaw).not.toContain("acceptance_first_pass");
  });

  it("Q37: metrics row carries state.stack (object, not null)", async () => {
    const proj = await tempProject();
    try {
      await runFullPipeline(proj.dir);
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.stack).toBeDefined();
      expect(fin.metrics_row.stack).not.toBeNull();
      // setup.ts seeds defaultStack { language: "TypeScript", package_manager: "pnpm", ... }
      expect(fin.metrics_row.stack.language).toBe("TypeScript");
      expect(fin.metrics_row.stack.package_manager).toBe("pnpm");
      expect(fin.metrics_row.stack.test_command).toBe("pnpm test");
      expect(fin.metrics_row.stack.project_type).toBe("backend");
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

  it("Q48 (item 11): metric row includes force_used, pipeline_violation, started_at, ended_at, reviewer_count, gate2_revisions", async () => {
    const proj = await tempProject();
    try {
      await runFullPipeline(proj.dir);
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row).toHaveProperty("force_used");
      expect(fin.metrics_row.force_used).toBe(false);
      expect(fin.metrics_row.pipeline_violation).toBeNull();
      expect(typeof fin.metrics_row.started_at).toBe("string");
      expect(typeof fin.metrics_row.ended_at).toBe("string");
      expect(fin.metrics_row.gate2_revisions).toBe(0);
      expect(fin.metrics_row.reviewer_count).toBeGreaterThanOrEqual(1);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q48 (item 11): force_used + pipeline_violation propagate to the metric row", async () => {
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
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      // Force the final phase — records pipeline_violation per set-phase-status logic.
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "final",
        status: "completed",
        force: true,
      });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      expect(fin.metrics_row.pipeline_violation).toMatch(/phase-force-final/);
      // force_used is true because pipeline_violation != null (any forced step counts).
      expect(fin.metrics_row.force_used).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q47/Q48 (item 11): gate2_revisions counter increments on rejected gate2", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "rejected", feedback: "first pass" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "rejected", feedback: "second pass" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const { readStateSafe } = await import("../../src/lib/state-io.js");
      const ps = await readStateSafe(join(proj.dir, ".claude", "pipeline-state.json"));
      expect(ps?.phases?.implementation?.gate2_revisions).toBe(2);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q55: pipeline_finish rewrites pipeline-state-summary.md with the final verdict", async () => {
    const proj = await tempProject();
    try {
      await runFullPipeline(proj.dir);
      await pipelineFinish({ project_dir: proj.dir, verdict: "accepted" });
      const { readFile } = await import("node:fs/promises");
      const summaryPath = join(proj.dir, ".claude", "pipeline-state-summary.md");
      const summary = await readFile(summaryPath, "utf8");
      // The summary builder includes the verdict — assert it reflects the
      // freshly-set "accepted" rather than the pre-finish snapshot.
      expect(summary).toContain("accepted");
    } finally {
      await proj.cleanup();
    }
  });
});
