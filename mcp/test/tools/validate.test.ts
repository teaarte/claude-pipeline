import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics, reviewerOutput, validatorOutput } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineSetGate } from "../../src/tools/set-gate.js";
import { pipelineRecordAgentRun } from "../../src/tools/record-agent-run.js";
import { pipelineRecordNonreviewAgent } from "../../src/tools/record-nonreview-agent.js";
import { pipelineValidate } from "../../src/tools/validate.js";

describe("pipeline_validate", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("returns ok=true on a clean fresh init", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const v = await pipelineValidate({ project_dir: proj.dir });
      expect(v.ok).toBe(true);
      expect(v.violations).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  });

  it("returns INV_NO_STATE when state file is missing", async () => {
    const proj = await tempProject();
    try {
      const v = await pipelineValidate({ project_dir: proj.dir });
      expect(v.ok).toBe(false);
      expect(v.violations[0].code).toBe("INV_NO_STATE");
    } finally {
      await proj.cleanup();
    }
  });

  it("returns ok=true after a full pipeline-complete walk", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await pipelineRecordNonreviewAgent({ project_dir: proj.dir, phase: "planning", agent: "planner" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await pipelineRecordNonreviewAgent({
        project_dir: proj.dir,
        phase: "implementation",
        agent: "implementer",
      });
      await pipelineRecordAgentRun({
        project_dir: proj.dir,
        phase: "implementation",
        agent_output: reviewerOutput(),
      });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await pipelineRecordAgentRun({
        project_dir: proj.dir,
        phase: "validation",
        agent_output: validatorOutput(),
      });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });
      const v = await pipelineValidate({ project_dir: proj.dir });
      expect(v.ok).toBe(true);
      expect(v.violations).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  });
});
