import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

describe("pipeline_begin_agent", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("returns an ar-* id and appends an open_spawn", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      const r = await pipelineBeginAgent({
        project_dir: proj.dir,
        phase: "planning",
        agent: "planner",
        model: "opus",
      });
      expect(r.agent_run_id).toMatch(/^ar-[0-9a-f-]+$/);
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.phases.planning.open_spawns).toHaveLength(1);
      const spawn = state.phases.planning.open_spawns[0];
      expect(spawn.id).toBe(r.agent_run_id);
      expect(spawn.agent).toBe("planner");
      expect(spawn.model).toBe("opus");
      expect(spawn.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Phase auto-transitions to in_progress.
      expect(state.phases.planning.status).toBe("in_progress");
    } finally {
      await proj.cleanup();
    }
  });

  it("refuses to begin in a completed phase", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await expect(
        pipelineBeginAgent({ project_dir: proj.dir, phase: "context", agent: "code-analyzer" }),
      ).rejects.toThrow(/Phase is closed/);
    } finally {
      await proj.cleanup();
    }
  });

  it("multiple begins accumulate in open_spawns; first record removes only its own", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      const a = await pipelineBeginAgent({ project_dir: proj.dir, phase: "planning", agent: "planner" });
      const b = await pipelineBeginAgent({ project_dir: proj.dir, phase: "planning", agent: "planner" });
      expect(a.agent_run_id).not.toBe(b.agent_run_id);
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.phases.planning.open_spawns).toHaveLength(2);
    } finally {
      await proj.cleanup();
    }
  });
});
