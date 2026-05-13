import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics, spawnNonreview } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

describe("pipeline_set_phase_status", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("completes context (which is exempt from agents requirement)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      expect(r.status).toBe("completed");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.phases.context.status).toBe("completed");
      expect(state.phases.context.completed_at).toBeTruthy();
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects completing a phase with no agents (INV_002)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" }),
      ).rejects.toThrow(/INV_002/);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects reopening a completed phase (INV_010)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "in_progress" }),
      ).rejects.toThrow(/INV_010/);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects skipping test_first without a valid skipped_reason (INV_003)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await expect(
        pipelineSetPhaseStatus({
          project_dir: proj.dir,
          phase: "test_first",
          status: "skipped",
          skipped_reason: "no-such-reason",
        }),
      ).rejects.toThrow(/INV_003/);
    } finally {
      await proj.cleanup();
    }
  });

  it("force=true bypasses INV_002 and records pipeline_violation", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      const r = await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "planning",
        status: "completed",
        force: true,
      });
      expect(r.pipeline_violation).toMatch(/phase-force-planning/);
    } finally {
      await proj.cleanup();
    }
  });

  it("INV_012: refuses to complete a phase with an open spawn", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      // Begin once, record once → 1 agent in agents[] but open_spawns[] empty.
      await spawnNonreview(proj.dir, "planning", "planner");
      // Then begin a second planner without recording.
      await pipelineBeginAgent({ project_dir: proj.dir, phase: "planning", agent: "planner" });
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" }),
      ).rejects.toThrow(/INV_012/);
    } finally {
      await proj.cleanup();
    }
  });
});
