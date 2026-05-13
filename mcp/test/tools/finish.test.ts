import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import {
  tempProject,
  initArgs,
  clearMetrics,
  reviewerOutput,
  validatorOutput,
  readJsonl,
  metricsDir,
} from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineSetGate } from "../../src/tools/set-gate.js";
import { pipelineRecordAgentRun } from "../../src/tools/record-agent-run.js";
import { pipelineRecordNonreviewAgent } from "../../src/tools/record-nonreview-agent.js";
import { pipelineFinish } from "../../src/tools/finish.js";

async function runFullPipeline(dir: string) {
  await pipelineInit(initArgs(dir));
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "context", status: "completed" });
  await pipelineRecordNonreviewAgent({ project_dir: dir, phase: "planning", agent: "planner" });
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "planning", status: "completed" });
  await pipelineSetPhaseStatus({
    project_dir: dir,
    phase: "test_first",
    status: "skipped",
    skipped_reason: "regression-only",
  });
  await pipelineRecordNonreviewAgent({ project_dir: dir, phase: "implementation", agent: "implementer" });
  await pipelineRecordAgentRun({
    project_dir: dir,
    phase: "implementation",
    agent_output: reviewerOutput(),
  });
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "implementation", status: "completed" });
  await pipelineRecordAgentRun({
    project_dir: dir,
    phase: "validation",
    agent_output: validatorOutput(),
  });
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

  it("refuses to finish when invariants fail", async () => {
    const proj = await tempProject();
    try {
      // Bootstrap up to gate2-approved, but force gate2 with implementation incomplete.
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
