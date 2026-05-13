import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tempProject, initArgs, clearMetrics, reviewerOutput, validatorOutput } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineRecordAgentRun } from "../../src/tools/record-agent-run.js";
import { pipelineRecordNonreviewAgent } from "../../src/tools/record-nonreview-agent.js";

async function bootstrapToImpl(dir: string) {
  await pipelineInit(initArgs(dir));
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "context", status: "completed" });
  await pipelineRecordNonreviewAgent({ project_dir: dir, phase: "planning", agent: "planner" });
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "planning", status: "completed" });
  await pipelineSetPhaseStatus({
    project_dir: dir,
    phase: "test_first",
    status: "skipped",
    skipped_reason: "regression-only",
  });
  await pipelineRecordNonreviewAgent({ project_dir: dir, phase: "implementation", agent: "implementer" });
}

describe("pipeline_record_agent_run", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("writes a reviewer finding to findings.jsonl and updates state", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      const res = await pipelineRecordAgentRun({
        project_dir: proj.dir,
        phase: "implementation",
        agent_output: reviewerOutput(),
      });
      expect(res.agent).toBe("logic-reviewer");
      expect(res.findings_written).toBe(1);
      expect(res.blocking).toBe(1);
      const findingsRaw = await readFile(join(proj.dir, ".claude", "findings.jsonl"), "utf8");
      const lines = findingsRaw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const finding = JSON.parse(lines[0]);
      expect(finding.category).toBe("race-condition");
      expect(finding.severity).toBe("blocking");
    } finally {
      await proj.cleanup();
    }
  });

  it("accepts a validator (acceptance) agent", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      const res = await pipelineRecordAgentRun({
        project_dir: proj.dir,
        phase: "validation",
        agent_output: validatorOutput(),
      });
      expect(res.agent).toBe("acceptance");
      expect(res.verdict).toBe("PASS");
      expect(res.findings_written).toBe(0);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects output missing the fenced ```json header", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      await expect(
        pipelineRecordAgentRun({
          project_dir: proj.dir,
          phase: "implementation",
          agent_output: "# just markdown body, no json",
        }),
      ).rejects.toThrow(/no fenced/);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects an unknown agent class", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      await expect(
        pipelineRecordAgentRun({
          project_dir: proj.dir,
          phase: "implementation",
          agent_output: reviewerOutput({ agent: "made-up-agent" }),
        }),
      ).rejects.toThrow(/Unknown agent class/);
    } finally {
      await proj.cleanup();
    }
  });
});
