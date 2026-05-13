import { describe, it, expect } from "vitest";
import { tempProject, initArgs } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

describe("pipeline_state_get", () => {
  it("returns the initialized state", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const got = await pipelineStateGet({ project_dir: proj.dir });
      expect(got.exists).toBe(true);
      expect(got.state.task_id).toBe("t-2026-05-13-test");
    } finally {
      await proj.cleanup();
    }
  });

  it("returns exists:false when no state file present", async () => {
    const proj = await tempProject();
    try {
      const got = await pipelineStateGet({ project_dir: proj.dir });
      expect(got.exists).toBe(false);
      expect(got.state).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });
});
