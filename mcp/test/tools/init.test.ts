import { describe, it, expect, afterEach } from "vitest";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";

describe("pipeline_init", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("creates pipeline-state.json + findings.jsonl + summary.md", async () => {
    const proj = await tempProject();
    try {
      const result = await pipelineInit(initArgs(proj.dir));
      expect(result.task_id).toBe("t-2026-05-13-test");
      expect(result.state_file).toMatch(/pipeline-state\.json$/);
      const stateRaw = await readFile(result.state_file, "utf8");
      const state = JSON.parse(stateRaw);
      expect(state.task_id).toBe("t-2026-05-13-test");
      expect(state.complexity).toBe("medium");
      expect(state.tests_mode).toBe("regression-only");
      expect(state.stack.language).toBe("TypeScript");
      expect(state.agents_count).toBe(0);
      expect(state.verdict).toBe(null);
      // findings.jsonl exists and is empty
      await access(result.findings_file, constants.F_OK);
      const findings = await readFile(result.findings_file, "utf8");
      expect(findings).toBe("");
      // summary.md exists
      await access(result.summary_file, constants.F_OK);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q10: initialized state does not carry deprecated current_step field", async () => {
    const proj = await tempProject();
    try {
      const result = await pipelineInit(initArgs(proj.dir));
      const state = JSON.parse(await readFile(result.state_file, "utf8"));
      expect(state).not.toHaveProperty("current_step");
      // Validate the template and schema also dropped the field.
      const { join } = await import("node:path");
      const { pipelineRoot } = await import("../../src/lib/paths.js");
      const tpl = JSON.parse(
        await readFile(join(pipelineRoot, "templates", "pipeline-state.json"), "utf8"),
      );
      expect(tpl).not.toHaveProperty("current_step");
      const schemaRaw = await readFile(
        join(pipelineRoot, "templates", "schemas", "pipeline-state.schema.json"),
        "utf8",
      );
      expect(schemaRaw).not.toContain("current_step");
    } finally {
      await proj.cleanup();
    }
  });

  it("item 2: writes schema_version=1.1 and bundle='code' (default)", async () => {
    const proj = await tempProject();
    try {
      const result = await pipelineInit(initArgs(proj.dir));
      const state = JSON.parse(await readFile(result.state_file, "utf8"));
      expect(state.schema_version).toBe("1.1");
      expect(state.bundle).toBe("code");
    } finally {
      await proj.cleanup();
    }
  });

  it("refuses to overwrite a finished state", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      // Simulate a finished task by setting verdict via re-init shouldn't work
      const stateFilePath = `${proj.dir}/.claude/pipeline-state.json`;
      const stateRaw = await readFile(stateFilePath, "utf8");
      const state = JSON.parse(stateRaw);
      state.verdict = "accepted";
      // Hand-write — bypasses the MCP guard for the purposes of this test.
      await (await import("node:fs/promises")).writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf8");
      await expect(pipelineInit(initArgs(proj.dir))).rejects.toThrow(/Refusing to overwrite/);
    } finally {
      await proj.cleanup();
    }
  });
});
