import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("H13: rewrites findings.jsonl task_id atomically with state mutation", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const findingsPath = join(proj.dir, ".claude", "findings.jsonl");
      // Seed findings.jsonl with two entries on the OLD task_id and one on
      // an unrelated id (must remain untouched).
      const lines = [
        JSON.stringify({
          schema_version: "1.0",
          id: "f-2026-05-19-aa1100",
          agent: "logic-reviewer",
          iteration: 1,
          task_id: "t-2026-05-13-test",
          file: "src/x.ts",
          line_start: 1,
          line_end: 2,
          severity: "blocking",
          category: "race-condition",
          rationale: "x",
          fix_suggestion: "y",
        }),
        JSON.stringify({
          schema_version: "1.0",
          id: "f-2026-05-19-aa1101",
          agent: "security",
          iteration: 1,
          task_id: "t-2026-05-13-test",
          file: "src/y.ts",
          line_start: 3,
          line_end: 4,
          severity: "non-blocking",
          category: "auth-bypass",
          rationale: "x",
          fix_suggestion: "y",
        }),
        JSON.stringify({
          schema_version: "1.0",
          id: "f-2026-05-19-zzzzzz",
          agent: "logic-reviewer",
          iteration: 1,
          task_id: "t-2026-05-12-other",
          file: "src/z.ts",
          line_start: 5,
          line_end: 6,
          severity: "blocking",
          category: "off-by-one",
          rationale: "x",
          fix_suggestion: "y",
        }),
      ];
      await writeFile(findingsPath, lines.join("\n") + "\n", "utf8");
      await pipelineFixTaskId({
        project_dir: proj.dir,
        new_task_id: "t-2026-05-19-h13new",
        reason: "test atomic findings rewrite",
      });
      const after = (await readFile(findingsPath, "utf8"))
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
      const ids = after.map((e: any) => e.task_id).sort();
      expect(ids).toEqual([
        "t-2026-05-12-other",
        "t-2026-05-19-h13new",
        "t-2026-05-19-h13new",
      ]);
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.task_id).toBe("t-2026-05-19-h13new");
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
