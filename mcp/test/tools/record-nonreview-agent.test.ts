import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics, spawnNonreview } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineRecordNonreviewAgent } from "../../src/tools/record-nonreview-agent.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";
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
      await spawnNonreview(proj.dir, "planning", "planner", { output_file: ".claude/plan.md" });
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.phases.planning.status).toBe("in_progress");
      expect(state.phases.planning.agents).toContain("planner");
      // Q31: phases.X.iterations is deprecated; the field is no longer
      // written. reviewer_verdicts[].iteration is the source of truth.
      expect(state.phases.planning).not.toHaveProperty("iterations");
      expect(state.files.created).toContain(".claude/plan.md");
      expect(state.agents_count).toBe(1);
      // open_spawns drained after record
      expect(state.phases.planning.open_spawns).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects implementer begin before test_first is done (INV_011)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await expect(
        pipelineBeginAgent({ project_dir: proj.dir, phase: "implementation", agent: "implementer" }),
      ).rejects.toThrow(/INV_011/);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q31: phases.{planning,implementation}.iterations is gone from schema + template", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { pipelineRoot } = await import("../../src/lib/paths.js");
    const tpl = JSON.parse(
      await readFile(join(pipelineRoot, "templates", "pipeline-state.json"), "utf8"),
    );
    expect(tpl.phases.planning).not.toHaveProperty("iterations");
    expect(tpl.phases.implementation).not.toHaveProperty("iterations");
    const schemaRaw = await readFile(
      join(pipelineRoot, "templates", "schemas", "pipeline-state.schema.json"),
      "utf8",
    );
    // No "iterations" property declaration in any phase's allOf
    expect(schemaRaw).not.toMatch(/"iterations":\s*\{/);
  });

  it("rejects record without a matching agent_run_id (INV_012)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await expect(
        pipelineRecordNonreviewAgent({
          project_dir: proj.dir,
          phase: "planning",
          agent: "planner",
          agent_run_id: "ar-deadbeef-0000-0000-0000-000000000000",
        }),
      ).rejects.toThrow(/INV_012/);
    } finally {
      await proj.cleanup();
    }
  });
});
