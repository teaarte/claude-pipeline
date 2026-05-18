import { describe, it, expect, afterEach } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  tempProject,
  initArgs,
  clearMetrics,
  spawnNonreview,
  metricsDir,
  readJsonl,
} from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineSetPhaseStatus } from "../../src/tools/set-phase-status.js";
import { pipelineBeginAgent } from "../../src/tools/begin-agent.js";
import { pipelineAbandon } from "../../src/tools/abandon.js";
import { pipelineCancelSpawn } from "../../src/tools/cancel-spawn.js";
import { pipelineStateGet } from "../../src/tools/state-get.js";

describe("pipeline_abandon", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("moves pipeline-state.json to abandoned-<ts>.json", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const r = await pipelineAbandon({ project_dir: proj.dir, reason: "rebase mid-flight" });
      expect(r.moved_to).toMatch(/abandoned-/);
      expect(r.reason).toBe("rebase mid-flight");
      // pipeline-state.json should be gone (moved).
      const exists = await pipelineStateGet({ project_dir: proj.dir });
      expect(exists.exists).toBe(false);
      // The abandoned file is on disk under .claude/
      const dir = await readdir(join(proj.dir, ".claude"));
      expect(dir.some((f) => /^abandoned-/.test(f))).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  it("does NOT write a metrics row", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const rowsBefore = (await readJsonl(join(metricsDir, "pipeline.jsonl"))).length;
      await pipelineAbandon({ project_dir: proj.dir, reason: "x" });
      const rowsAfter = (await readJsonl(join(metricsDir, "pipeline.jsonl"))).length;
      expect(rowsAfter).toBe(rowsBefore);
    } finally {
      await proj.cleanup();
    }
  });

  it("throws when nothing to abandon", async () => {
    const proj = await tempProject();
    try {
      await expect(
        pipelineAbandon({ project_dir: proj.dir, reason: "x" }),
      ).rejects.toThrow(/Nothing to abandon/);
    } finally {
      await proj.cleanup();
    }
  });

  // v2.2.6 C8 / Q64: cross-session ownership safety on abandon.
  it("Q64: refuses pipeline_abandon when owner_id != current session", async () => {
    const proj = await tempProject();
    const prevOwnerEnv = process.env.CLAUDE_PIPELINE_OWNER_ID;
    try {
      await pipelineInit({ ...initArgs(proj.dir), owner_id: "session-A" } as any);
      process.env.CLAUDE_PIPELINE_OWNER_ID = "session-B";
      await expect(
        pipelineAbandon({ project_dir: proj.dir, reason: "wrong window" }),
      ).rejects.toThrow(/OWNER_MISMATCH.*session-A.*session-B/);
    } finally {
      if (prevOwnerEnv === undefined) {
        delete process.env.CLAUDE_PIPELINE_OWNER_ID;
      } else {
        process.env.CLAUDE_PIPELINE_OWNER_ID = prevOwnerEnv;
      }
      await proj.cleanup();
    }
  });

  it("Q64: pipeline_abandon with force_cross_owner=true succeeds", async () => {
    const proj = await tempProject();
    const prevOwnerEnv = process.env.CLAUDE_PIPELINE_OWNER_ID;
    try {
      await pipelineInit({ ...initArgs(proj.dir), owner_id: "session-A" } as any);
      process.env.CLAUDE_PIPELINE_OWNER_ID = "session-B";
      const r = await pipelineAbandon({
        project_dir: proj.dir,
        reason: "rebase mid-flight, force from other window",
        force_cross_owner: true,
      });
      expect(r.moved_to).toMatch(/abandoned-/);
    } finally {
      if (prevOwnerEnv === undefined) {
        delete process.env.CLAUDE_PIPELINE_OWNER_ID;
      } else {
        process.env.CLAUDE_PIPELINE_OWNER_ID = prevOwnerEnv;
      }
      await proj.cleanup();
    }
  });
});

describe("pipeline_cancel_spawn", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("removes an open spawn so the phase can complete", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      // 1 recorded planner so agents[] is non-empty.
      await spawnNonreview(proj.dir, "planning", "planner");
      // Begin a second planner that "crashes" (never records).
      const stuck = await pipelineBeginAgent({
        project_dir: proj.dir,
        phase: "planning",
        agent: "planner",
      });
      // Completing the phase now must fail with INV_012.
      await expect(
        pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "planning", status: "completed" }),
      ).rejects.toThrow(/INV_012/);
      // Cancel the stuck spawn.
      const r = await pipelineCancelSpawn({
        project_dir: proj.dir,
        phase: "planning",
        agent_run_id: stuck.agent_run_id,
        reason: "agent process killed",
      });
      expect(r.cancelled?.id).toBe(stuck.agent_run_id);
      // Now completion succeeds.
      const done = await pipelineSetPhaseStatus({
        project_dir: proj.dir,
        phase: "planning",
        status: "completed",
      });
      expect(done.status).toBe("completed");
    } finally {
      await proj.cleanup();
    }
  });

  it("throws when agent_run_id is not in open_spawns[]", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await pipelineSetPhaseStatus({ project_dir: proj.dir, phase: "context", status: "completed" });
      await expect(
        pipelineCancelSpawn({
          project_dir: proj.dir,
          phase: "planning",
          agent_run_id: "ar-no-such-spawn-0000-0000-000000000000",
          reason: "test",
        }),
      ).rejects.toThrow(/not in phase/);
    } finally {
      await proj.cleanup();
    }
  });
});

describe("commands/done.md — Recovery section", () => {
  it("lists every INV_001..INV_012 + stale-spawn with a recovery hint", async () => {
    const path = join(import.meta.dirname, "..", "..", "..", "commands", "done.md");
    const text = await readFile(path, "utf8");
    const codes = ["INV_001", "INV_002", "INV_003", "INV_004", "INV_005", "INV_006", "INV_007", "INV_008", "INV_009", "INV_010", "INV_011", "INV_012", "stale-spawn"];
    for (const c of codes) {
      expect(text, `done.md missing recovery hint for ${c}`).toMatch(new RegExp(c));
    }
    expect(text).toMatch(/Recovery/);
    expect(text).toMatch(/pipeline_abandon/);
    expect(text).toMatch(/pipeline_cancel_spawn/);
  });
});
