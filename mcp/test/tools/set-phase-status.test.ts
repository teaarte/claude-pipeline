import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tempProject, initArgs, clearMetrics, spawnNonreview, spawnReviewer, reviewerOutput } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

const exec = promisify(execFile);

describe("pipeline_set_phase_status", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("completes context (which is exempt from agents requirement)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      expect(r.status).toBe("completed");
      const state = (await pipelineStateGet({ project_dir: proj.dir })).state;
      expect(state.phases.context.status).toBe("completed");
      expect(state.phases.context.completed_at).toBeTruthy();
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects completing a phase with no agents (INV_002)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" }),
      ).rejects.toThrow(/INV_002/);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects reopening a completed phase (INV_010)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "in_progress" }),
      ).rejects.toThrow(/INV_010/);
    } finally {
      await proj.cleanup();
    }
  });

  it("rejects skipping test_first without a valid skipped_reason (INV_003)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await spawnNonreview(proj.dir, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" });
      await expect(
        pipelineSetPhaseStatus({
          project_dir: proj.dir,
          phase: "test_first",
          status: "skipped",
          skipped_reason: "no-such-reason",
        }),
      ).rejects.toThrow(/INV_003/);
    } finally {
      await proj.cleanup();
    }
  });

  it("force=true bypasses INV_002 and records pipeline_violation", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      const r = await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "planning",
        status: "completed",
        force: true,
      });
      expect(r.pipeline_violation).toMatch(/phase-force-planning/);
    } finally {
      await proj.cleanup();
    }
  });

  it("Q33: on implementation close, captures git diff into state.files", async () => {
    // Build a real git repo so `git diff --name-status HEAD` has output.
    const root = await mkdtemp(join(tmpdir(), "cp-q33-"));
    try {
      await exec("git", ["init", "-q", "-b", "main"], { cwd: root });
      await exec("git", ["config", "user.email", "test@test"], { cwd: root });
      await exec("git", ["config", "user.name", "test"], { cwd: root });
      await writeFile(join(root, "seed.ts"), "export const x = 1;\n", "utf8");
      await exec("git", ["add", "."], { cwd: root });
      await exec("git", ["commit", "-q", "-m", "seed"], { cwd: root });
      // Modify the seed and create a new file — represents implementer's diff.
      await writeFile(join(root, "seed.ts"), "export const x = 2;\n", "utf8");
      await writeFile(join(root, "new-file.ts"), "export const y = 1;\n", "utf8");
      // Stage so untracked file shows up under diff --name-status HEAD.
      await exec("git", ["add", "."], { cwd: root });

      await pipelineInit(initArgs(root));
      await pipelineSetPhaseStatus({ project_dir: root, phase: "context", status: "completed" });
      await spawnNonreview(root, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: root, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: root,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(root, "implementation", "implementer");
      await spawnReviewer(root, "implementation", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));
      await pipelineSetPhaseStatus({ project_dir: root, phase: "implementation", status: "completed" });

      const state = (await pipelineStateGet({ project_dir: root })).state;
      expect(state.files.modified).toContain("seed.ts");
      expect(state.files.created).toContain("new-file.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Q33: implementation close in a non-git directory stays empty + emits a git-unavailable audit entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-q33-nogit-"));
    try {
      await pipelineInit(initArgs(root));
      await pipelineSetPhaseStatus({ project_dir: root, phase: "context", status: "completed" });
      await spawnNonreview(root, "planning", "planner");
      await pipelineSetPhaseStatus({ project_dir: root, phase: "planning", status: "completed" });
      await pipelineSetPhaseStatus({
        project_dir: root,
        phase: "test_first",
        status: "skipped",
        skipped_reason: "regression-only",
      });
      await spawnNonreview(root, "implementation", "implementer");
      await spawnReviewer(root, "implementation", "logic-reviewer", reviewerOutput({ verdict: "APPROVE", findings: [] }));
      await pipelineSetPhaseStatus({ project_dir: root, phase: "implementation", status: "completed" });

      const state = (await pipelineStateGet({ project_dir: root })).state;
      expect(state.files.created).toEqual([]);
      // record-nonreview-agent seeded .claude/plan.md from the planner spawn,
      // so state.files.created from the spawn is empty here (planner used
      // no output_file). state.files.modified should also stay empty.
      expect(state.files.modified).toEqual([]);

      // Per-project audit should record one git-unavailable entry from the
      // implementation-close path.
      const auditRaw = await readFile(join(root, ".claude", "mcp-audit.jsonl"), "utf8");
      const lines = auditRaw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const gitNote = lines.find(
        (e) => e.tool === "pipeline_set_phase_status" && e.error_class === "git-unavailable",
      );
      expect(gitNote).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("INV_012: refuses to complete a phase with an open spawn", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      // Begin once, record once → 1 agent in agents[] but open_spawns[] empty.
      await spawnNonreview(proj.dir, "planning", "planner");
      // Then begin a second planner without recording.
      await pipelineBeginAgent({ project_dir: proj.dir, phase: "planning", agent: "planner" });
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" }),
      ).rejects.toThrow(/INV_012/);
    } finally {
      await proj.cleanup();
    }
  });
});
