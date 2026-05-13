import { describe, it, expect } from "vitest";
import { pipelineRunTask } from "../../src/driver/tools/run-task.js";
import { pipelineContinueTask } from "../../src/driver/tools/continue-task.js";
import { tempProject } from "../helpers/setup.js";
import { readDriverState } from "../../src/driver/core/state.js";

describe("driver/tools — pipeline_run_task + pipeline_continue_task", () => {
  it("returns a spawn-agent shuttle on first call (simple flow)", async () => {
    const proj = await tempProject();
    try {
      const res = await pipelineRunTask({
        project_dir: proj.dir,
        task: "rename a single function",
        complexity_hint: "simple",
      });
      // The first non-trivial step after initialize+classify is "plan", which
      // spawns the planner.
      expect(res.status).toBe("spawn-agent");
      if (res.status === "spawn-agent") {
        expect(res.agent).toBe("planner");
        expect(res.claude_code_task.subagent_type).toBe("planner");
        expect(res.claude_code_task.model).toBe("opus");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("resumes with agent-result and advances", async () => {
    const proj = await tempProject();
    try {
      const r1 = await pipelineRunTask({
        project_dir: proj.dir,
        task: "rename a single function",
        complexity_hint: "simple",
      });
      expect(r1.status).toBe("spawn-agent");
      if (r1.status !== "spawn-agent") return;

      const stateBefore = await readDriverState(proj.dir);
      expect(stateBefore?.pending_spawns[r1.agent_run_id]).toBeTruthy();

      // The next pause point depends on the SIMPLE flow shape. We just
      // assert that resuming with the planner's result clears the pending
      // spawn and that the driver returns *some* shuttle (or completes).
      const r2 = await pipelineContinueTask({
        project_dir: proj.dir,
        driver_state_id: r1.driver_state_id,
        input: {
          driver_state_id: r1.driver_state_id,
          type: "agent-result",
          agent_run_id: r1.agent_run_id,
          agent_output: "synthetic planner reply",
        },
      });
      expect(["spawn-agent", "ask-user", "complete", "error"]).toContain(r2.status);
      const stateAfter = await readDriverState(proj.dir);
      expect(stateAfter?.pending_spawns[r1.agent_run_id]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects continue with mismatched driver_state_id", async () => {
    const proj = await tempProject();
    try {
      const r1 = await pipelineRunTask({
        project_dir: proj.dir,
        task: "x",
        complexity_hint: "simple",
      });
      if (r1.status !== "spawn-agent") throw new Error(`unexpected ${r1.status}`);
      await expect(
        pipelineContinueTask({
          project_dir: proj.dir,
          driver_state_id: "ds-wrong-0000-0000-0000-000000000000",
          input: {
            driver_state_id: "ds-wrong-0000-0000-0000-000000000000",
            type: "agent-result",
            agent_run_id: r1.agent_run_id,
            agent_output: "x",
          },
        }),
      ).rejects.toThrow(/mismatch/);
    } finally {
      await proj.cleanup();
    }
  });
});

describe("driver framework extensibility (item 13 prep)", () => {
  it("custom AgentPlugin registers without touching core", async () => {
    // Smoke: import core/registry directly, add a synthetic plugin, query it.
    const { createRegistry, requireAgent } = await import("../../src/driver/core/registry.js");
    const r = createRegistry();
    r.agents.set("custom-accessibility-reviewer", {
      name: "custom-accessibility-reviewer",
      template_path: "agents/custom-accessibility-reviewer.md",
      output_schema: "reviewer",
      default_model: "sonnet",
    });
    const found = requireAgent(r, "custom-accessibility-reviewer");
    expect(found.name).toBe("custom-accessibility-reviewer");
    expect(found.default_model).toBe("sonnet");
  });
});
