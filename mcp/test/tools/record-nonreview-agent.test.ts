import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineRecordNonreviewAgent } from "../../src/tools/record-nonreview-agent.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

describe("pipeline_record_nonreview_agent", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("records a planner and transitions planning to in_progress", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      const r = await pipelineRecordNonreviewAgent({
        project_dir: proj.dir,
        phase: "planning",
        agent: "planner",
        output_file: ".claude/plan.md",
        iterations: 1,
      });
      expect(r.agent).toBe("planner");
      expect(r.agents_count).toBe(1);
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.phases.planning.status).toBe("in_progress");
      expect(state.phases.planning.agents).toContain("planner");
      expect(state.phases.planning.iterations).toBe(1);
      expect(state.files.created).toContain(".claude/plan.md");
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects implementer recording before test_first is done (INV_011)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await expect(
        pipelineRecordNonreviewAgent({
          project_dir: proj.dir,
          phase: "implementation",
          agent: "implementer",
        }),
      ).rejects.toThrow(/INV_011/);
    } finally {
      await proj.cleanup();
    }
  });
});
