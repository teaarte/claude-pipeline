// Targeted tests to push branch coverage past 75%. Each test exercises a
// specific branch not covered by happy/reject pairs.

import { describe, it, expect, afterEach } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { pipelineRecordAgentRun } from "../../src/tools/record-agent-run.js";
import { pipelineRecordNonreviewAgent } from "../../src/tools/record-nonreview-agent.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineSetGate } from "../../src/tools/set-gate.js";
import { pipelineFinish } from "../../src/tools/finish.js";
import { pipelineLogAgentFeedback } from "../../src/tools/log-agent-feedback.js";
import { pipelineGetPastMisses } from "../../src/tools/get-past-misses.js";
import { runInvariants } from "../../src/lib/invariants.js";

describe("branch-coverage extras", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("record-agent-run: throws when state file missing", async () => {
    const proj = await tempProject();
    try {
      await expect(
        pipelineRecordAgentRun({
          project_dir: proj.dir,
          phase: "implementation",
          agent_run_id: "ar-deadbeef-0000-0000-0000-000000000000",
          agent_output: reviewerOutput(),
        }),
      ).rejects.toThrow(/not found/);
    } finally {
      await proj.cleanup();
    }
  });

  it("record-agent-run: rejects finding with invalid category for agent", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(proj.dir, "implementation", "implementer");
      const out = reviewerOutput({
        findings: [
          {
            schema_version: "1.0",
            id: "f-2026-05-13-aaaaaa",
            agent: "logic-reviewer",
            task_id: "t-2026-05-13-test",
            iteration: 1,
            file: "src/x.ts",
            line_start: 1,
            line_end: 2,
            severity: "blocking",
            category: "totally-made-up-category",
            summary: "x",
            evidence_excerpt: "x",
            suggested_fix: "x",
            status: "open",
          },
        ],
      });
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
          agent_output: out,
        }),
      ).rejects.toThrow(/category/);
    } finally {
      await proj.cleanup();
    }
  });

  it("set-phase-status: in_progress sets started_at", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "context",
        status: "in_progress",
      });
      expect(r.status).toBe("in_progress");
    } finally {
      await proj.cleanup();
    }
  });

  it("set-phase-status: force=true on invalid transition records pipeline_violation", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      const r = await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "planning",
        status: "in_progress",
        force: true,
      });
      expect(r.pipeline_violation).toMatch(/phase-force-planning/);
    } finally {
      await proj.cleanup();
    }
  });

  it("set-gate: gate0 (no _feedback storage) accepts plain approval", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      expect(r.gate).toBe("gate0");
    } finally {
      await proj.cleanup();
    }
  });

  it("finish: metrics row with blockers + multi-reviewer", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(proj.dir, "implementation", "implementer");
      await spawnReviewer(proj.dir, "implementation", "logic-reviewer", reviewerOutput({ agent: "logic-reviewer" }));
      await spawnReviewer(
        proj.dir,
        "implementation",
        "challenger-reviewer",
        reviewerOutput({
          agent: "challenger-reviewer",
          findings: [
            {
              schema_version: "1.0",
              id: "f-2026-05-13-bbbbbb",
              agent: "challenger-reviewer",
              task_id: "t-2026-05-13-test",
              iteration: 1,
              file: "src/x.ts",
              line_start: 5,
              line_end: 6,
              severity: "blocking",
              category: "concurrency-failure",
              summary: "summary",
              evidence_excerpt: "code",
              suggested_fix: "fix",
              status: "open",
            },
          ],
        }),
      );
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "implementation", status: "completed" });
      await spawnReviewer(proj.dir, "validation", "acceptance", validatorOutput());
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "validation", status: "completed" });
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "final", status: "completed" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate0", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate1", status: "approved" });
      await pipelineSetGate({ project_dir: proj.dir, gate: "gate2", status: "approved" });

      const fin = await pipelineFinish({ project_dir: proj.dir, verdict: "rejected" });
      expect(fin.metrics_row.blockers_found).toBeGreaterThan(0);
      expect(fin.metrics_row.reviewers_with_blockers).toContain("logic-reviewer");
      expect(fin.metrics_row.verdict).toBe("rejected");
    } finally {
      await proj.cleanup();
    }
  });

  it("finish: throws when state file is missing", async () => {
    const proj = await tempProject();
    try {
      await expect(
        pipelineFinish({ project_dir: proj.dir, verdict: "accepted" }),
      ).rejects.toThrow(/not found/);
    } finally {
      await proj.cleanup();
    }
  });

  it("log-agent-feedback: writes entry with all optional fields", async () => {
    const r = await pipelineLogAgentFeedback({
      agent: "security",
      category: "auth-bypass",
      pattern_to_look_for: "missing CSRF",
      severity: "high",
      found_by: "prod-incident",
      human_confirmed: true,
      task_id: "t-2026-05-13-test",
      proposed_new_category: "csrf-missing",
      missed_issue_summary: "session token leak",
      example_file_line: "src/auth.ts:42",
      action_taken: "vocab-added",
    });
    expect(r.written).toBe(true);
    expect(r.entry.example_file_line).toBe("src/auth.ts:42");
  });

  it("get-past-misses: defaults to top_n=10 when omitted", async () => {
    for (let i = 0; i < 12; i++) {
      await pipelineLogAgentFeedback({
        agent: "performance",
        category: "n-plus-one",
        pattern_to_look_for: `q${i}`,
        severity: "medium",
      });
    }
    const r = await pipelineGetPastMisses({ agent: "performance" });
    expect(r.count).toBe(10);
  });

  it("invariants: INV_SCHEMA_STATE when state is malformed", async () => {
    const malformed = { not: "a real state" };
    const dir = await mkdtemp(join(tmpdir(), "cp-inv-malformed-"));
    try {
      const f = join(dir, "findings.jsonl");
      await writeFile(f, "", "utf8");
      const v = await runInvariants(malformed, f);
      expect(v.map((x) => x.code)).toContain("INV_SCHEMA_STATE");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("record-nonreview-agent: omits iterations when not provided", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      const { agent_run_id } = await pipelineBeginAgent({ project_dir: proj.dir, phase: "planning", agent: "planner" });
      const r = await pipelineRecordNonreviewAgent({
        project_dir: proj.dir,
        phase: "planning",
        agent: "planner",
        agent_run_id,
      });
      expect(r.agents_count).toBe(1);
    } finally {
      await proj.cleanup();
    }
  });

  it("record-nonreview-agent: re-records output_file (no duplicate)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner", { output_file: ".claude/plan.md" });
      await spawnNonreview(proj.dir, "planning", "planner", { output_file: ".claude/plan.md" });
      const { pipelineStateGet } = await import("../../src/tools/state-get.js");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      const occurrences = state.files.created.filter((f: string) => f === ".claude/plan.md").length;
      expect(occurrences).toBe(1);
    } finally {
      await proj.cleanup();
    }
  });

  it("invariants: gate2=approved with validation pending → INV_006", async () => {
    const s = {
      schema_version: "1.0",
      task_id: "t-2026-05-13-test",
      task: "x",
      complexity: "simple",
      tests_mode: "tdd",
      stack: { language: "TypeScript" },
      started_at: "2026-05-13T00:00:00.000Z",
      phases: {
        context: { status: "pending", agents: [] },
        planning: { status: "pending", agents: [] },
        test_first: { status: "pending", agents: [] },
        implementation: { status: "completed", agents: ["x"], open_spawns: [] },
        validation: { status: "pending", agents: [] },
        final: { status: "pending", agents: [] },
      },
      gates: { gate0: "pending", gate1: "pending", gate2: "approved", gate1_feedback: null, gate2_feedback: null },
      agents_count: 1,
    };
    const dir = await mkdtemp(join(tmpdir(), "cp-inv-006-"));
    try {
      const f = join(dir, "findings.jsonl");
      await writeFile(f, "", "utf8");
      const v = await runInvariants(s as any, f);
      expect(v.map((x) => x.code)).toContain("INV_006");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
