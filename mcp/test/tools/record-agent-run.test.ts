import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  tempProject,
  initArgs,
  clearMetrics,
  reviewerOutput,
  validatorOutput,
  spawnNonreview,
  spawnReviewer,
} from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineRecordAgentRun } from "../../src/tools/record-agent-run.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";

async function bootstrapToImpl(dir: string) {
  await pipelineInit(initArgs(dir));
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "context", status: "completed" });
  await spawnNonreview(dir, "planning", "planner");
  await pipelineSetPhaseStatus({ project_dir: dir, phase: "planning", status: "completed" });
  await pipelineSetPhaseStatus({
    project_dir: dir,
    phase: "test_first",
    status: "skipped",
    skipped_reason: "regression-only",
  });
  await spawnNonreview(dir, "implementation", "implementer");
}

describe("pipeline_record_agent_run", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("writes a reviewer finding to findings.jsonl and updates state", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      const res = await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput());
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
      const res = await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
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
      const { agent_run_id } = await pipelineBeginAgent({
        project_dir: proj.dir,
        phase: "implementation",
        agent: "logic-reviewer",
      });
      await expect(
        pipelineRecordAgentRun({
          project_dir: proj.dir,
          phase: "implementation",
          agent_run_id,
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
      const { agent_run_id } = await pipelineBeginAgent({
        project_dir: proj.dir,
        phase: "implementation",
        agent: "made-up-agent",
      });
      await expect(
        pipelineRecordAgentRun({
          project_dir: proj.dir,
          phase: "implementation",
          agent_run_id,
          agent_output: reviewerOutput({ agent: "made-up-agent" }),
        }),
      ).rejects.toThrow(/Unknown agent class/);
    } finally {
      await proj.cleanup();
    }
  });

  it("lenient parse recovers a missing ```json fence and flags _repaired", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      // No fence — raw JSON object embedded in narrative.
      const validBody = {
        schema_version: "1.0",
        agent: "logic-reviewer",
        task_id: "t-2026-05-13-test",
        iteration: 1,
        verdict: "APPROVE",
        summary_line: "looks good",
        findings: [],
        past_misses_applied: 0,
        past_miss_matches: [],
        ref_rules_consulted: [],
      };
      const naked = `# Logic Review\n\n${JSON.stringify(validBody, null, 2)}\n\nMore prose.`;
      const { agent_run_id } = await pipelineBeginAgent({
        project_dir: proj.dir,
        phase: "implementation",
        agent: "logic-reviewer",
      });
      const r = await pipelineRecordAgentRun({
        project_dir: proj.dir,
        phase: "implementation",
        agent_run_id,
        agent_output: naked,
      });
      expect(r.agent).toBe("logic-reviewer");
      expect(r._repaired).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q20: tags each reviewer_verdicts entry with its phase, so multi-phase agents stay distinguishable", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      // Reviewer in implementation phase (bootstrap already opened it).
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));
      // Close implementation, open validation, run a second reviewer there.
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput({ verdict: "PASS" }));

      const { pipelineStateGet } = await import("../../src/tools/state-get.js");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      const verdicts = state.reviewer_verdicts as Array<{ agent: string; phase: string }>;
      expect(verdicts).toHaveLength(2);
      expect(verdicts[0].agent).toBe("logic-reviewer");
      expect(verdicts[0].phase).toBe("implementation");
      expect(verdicts[1].agent).toBe("acceptance");
      expect(verdicts[1].phase).toBe("validation");
    } finally {
      await proj.cleanup();
    }
  });

  it("Q20: same reviewer running in two phases yields two distinguishable verdicts", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      // logic-reviewer at planning (plan-review).
      await spawnNonreview(proj.dir, "planning", "planner");
      await spawnReviewer(proj.dir, "planning", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      // logic-reviewer at implementation (review).
      await spawnNonreview(proj.dir, "implementation", "implementer");
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));

      const { pipelineStateGet } = await import("../../src/tools/state-get.js");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      const lrVerdicts = (state.reviewer_verdicts as Array<{ agent: string; phase: string }>)
        .filter((v) => v.agent === "logic-reviewer");
      expect(lrVerdicts).toHaveLength(2);
      expect(lrVerdicts.map((v) => v.phase).sort()).toEqual(["implementation", "planning"]);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q34: plan-grounding-check verdict still flows into reviewer_verdicts[]; deprecated planning.grounding_check is gone", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      // plan-grounding-check runs against the plan inside the planning phase.
      await spawnReviewer(
        proj.dir,
        "planning",
        "plan-grounding-check",
        validatorOutput({ agent: "plan-grounding-check", verdict: "GROUNDED" }),
      );
      const { pipelineStateGet } = await import("../../src/tools/state-get.js");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      const verdict = (state.reviewer_verdicts as Array<{ agent: string; verdict: string; phase: string }>)
        .find((v) => v.agent === "plan-grounding-check");
      expect(verdict).toBeDefined();
      expect(verdict!.verdict).toBe("GROUNDED");
      expect(verdict!.phase).toBe("planning");
      // Deprecated field must not have been resurrected anywhere on planning.
      expect(state.phases.planning).not.toHaveProperty("grounding_check");
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects when agent_run_id does not match the output's agent (INV_012)", async () => {
    const proj = await tempProject();
    try {
      await bootstrapToImpl(proj.dir);
      // Begin for logic-reviewer, but feed a security agent output (with a
      // security-valid category so category-vocab check doesn't fire first).
      const { agent_run_id } = await pipelineBeginAgent({
        project_dir: proj.dir,
        phase: "implementation",
        agent: "logic-reviewer",
      });
      const out = reviewerOutput({
        agent: "security",
        findings: [
          {
            schema_version: "1.0",
            id: "f-2026-05-13-sec123",
            agent: "security",
            task_id: "t-2026-05-13-test",
            iteration: 1,
            file: "src/auth.ts",
            line_start: 10,
            line_end: 20,
            severity: "blocking",
            category: "auth-bypass",
            summary: "x",
            evidence_excerpt: "x",
            suggested_fix: "x",
            status: "open",
          },
        ],
      });
      await expect(
        pipelineRecordAgentRun({
          project_dir: proj.dir,
          phase: "implementation",
          agent_run_id,
          agent_output: out,
        }),
      ).rejects.toThrow(/INV_012/);
    } finally {
      await proj.cleanup();
    }
  });
});
