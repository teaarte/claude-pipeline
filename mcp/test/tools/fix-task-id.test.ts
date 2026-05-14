import { describe, it, expect, afterEach } from "vitest";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineFixTaskId } from "../../src/tools/fix-task-id.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

describe("pipeline_fix_task_id", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("rewrites task_id under lock and returns the {old, new} pair", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineFixTaskId({
        project_dir: proj.dir,
        new_task_id: "t-2026-05-14-recovered",
        reason: "test recovery from malformed slug",
      });
      expect(r.old_task_id).toBe("t-2026-05-13-test");
      expect(r.new_task_id).toBe("t-2026-05-14-recovered");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.task_id).toBe("t-2026-05-14-recovered");
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects an invalid new_task_id (hyphens in slug)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await expect(
        pipelineFixTaskId({
          project_dir: proj.dir,
          new_task_id: "t-2026-05-14-bad-slug-here",
          reason: "test",
        }),
      ).rejects.toThrow(/does not match/);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects an invalid new_task_id (slug too short)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await expect(
        pipelineFixTaskId({
          project_dir: proj.dir,
          new_task_id: "t-2026-05-14-ab",
          reason: "test",
        }),
      ).rejects.toThrow(/does not match/);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects empty / too-short reason", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await expect(
        pipelineFixTaskId({
          project_dir: proj.dir,
          new_task_id: "t-2026-05-14-recovered",
          reason: "",
        }),
      ).rejects.toThrow();
      await expect(
        pipelineFixTaskId({
          project_dir: proj.dir,
          new_task_id: "t-2026-05-14-recovered",
          reason: "no",
        }),
      ).rejects.toThrow();
    } finally {
      await proj.cleanup();
    }
  });

  it("throws when pipeline-state.json is absent (no init)", async () => {
    const proj = await tempProject();
    try {
      await expect(
        pipelineFixTaskId({
          project_dir: proj.dir,
          new_task_id: "t-2026-05-14-recovered",
          reason: "no prior init",
        }),
      ).rejects.toThrow(/not found/);
    } finally {
      await proj.cleanup();
    }
  });
});
