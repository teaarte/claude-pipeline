import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetGate } from "../../src/tools/set-gate.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

describe("pipeline_set_gate", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("approves a gate and stores feedback", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineSetGate({
        project_dir: proj.dir,
        gate: "gate1",
        status: "approved",
        feedback: "looks good",
      });
      expect(r.status).toBe("approved");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.gates.gate1).toBe("approved");
      expect(state.gates.gate1_feedback).toBe("looks good");
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects when state file is missing", async () => {
    const proj = await tempProject();
    try {
      await expect(
        pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" }),
      ).rejects.toThrow(/not found/);
    } finally {
      await proj.cleanup();
    }
  });
});
