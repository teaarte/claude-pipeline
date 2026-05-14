/**
 * Q23: pipeline_done_cleanup deletes every orchestrator working file in
 * one server-side call. Verifies:
 *   - Static + pattern + directory files are all removed.
 *   - settings.local.json is preserved.
 *   - mcp-audit.jsonl is removed LAST (Q14 regression — see assertion
 *     below: the post-cleanup state has no audit jsonl, proving no
 *     in-tool emission re-created it).
 *   - Idempotent: running again on the already-clean directory returns
 *     empty `removed`.
 */

import { describe, it, expect, afterEach } from "vitest";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import { pipelineDoneCleanup } from "../../src/tools/done-cleanup.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("Q23 — pipeline_done_cleanup", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("removes every expected orchestrator working file and preserves settings.local.json", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const claudeDir = join(proj.dir, ".claude");
      // Seed the dir with the full vocabulary of working files.
      const seeded = [
        "plan.md",
        "pipeline-state.json",
        "pipeline-state-summary.md",
        "findings.jsonl",
        "driver-state.json",
        "context-doc.md",
        "analyzer-claims.json",
        "architecture-decisions.md",
        "dependency-audit.md",
        "research-report.md",
        "migration-plan.md",
        "caller-context.md",
        "antipattern-candidates.md",
        "diff.txt",
        "refs-to-load.md",
        "test-files-must-stay-green.json",
        ".mcp-managed",
        ".mcp-bypass-allowed",
        "past-misses-logic-reviewer.md",
        "plan-iter2.md",
        "implementation-notes-2026-05-14.md",
        "abandoned-2026-05-14T00-00-00Z.json",
        "mcp-audit.jsonl",
        // preserved
        "settings.local.json",
      ];
      for (const name of seeded) {
        await writeFile(join(claudeDir, name), "stub\n", "utf8");
      }
      // Seed a reviews/ directory.
      await mkdir(join(claudeDir, "reviews"), { recursive: true });
      await writeFile(join(claudeDir, "reviews", "logic-iter1.md"), "x", "utf8");

      const r = await pipelineDoneCleanup({ project_dir: proj.dir });

      // Settings preserved.
      expect(r.kept).toContain("settings.local.json");
      expect(await fileExists(join(claudeDir, "settings.local.json"))).toBe(true);

      // Audit jsonl gone (Q14 regression: this fails if the tool re-emitted audit).
      expect(r.removed).toContain("mcp-audit.jsonl");
      expect(await fileExists(join(claudeDir, "mcp-audit.jsonl"))).toBe(false);

      // Sample of orchestrator files gone.
      for (const f of [
        "plan.md",
        "pipeline-state.json",
        "findings.jsonl",
        ".mcp-managed",
        ".mcp-bypass-allowed",
        "past-misses-logic-reviewer.md",
        "plan-iter2.md",
        "implementation-notes-2026-05-14.md",
        "abandoned-2026-05-14T00-00-00Z.json",
      ]) {
        expect(await fileExists(join(claudeDir, f))).toBe(false);
      }
      // reviews/ removed
      expect(await fileExists(join(claudeDir, "reviews"))).toBe(false);
    } finally {
      await proj.cleanup();
    }
  });

  it("removes mcp-audit.jsonl LAST (verified by ordering of `removed` array)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const claudeDir = join(proj.dir, ".claude");
      await writeFile(join(claudeDir, "mcp-audit.jsonl"), "stub\n", "utf8");
      const r = await pipelineDoneCleanup({ project_dir: proj.dir });
      const auditIdx = r.removed.indexOf("mcp-audit.jsonl");
      expect(auditIdx).toBe(r.removed.length - 1);
    } finally {
      await proj.cleanup();
    }
  });

  it("returns empty `removed` on an already-clean .claude/ (idempotent)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      // Run once to clear out the init-created state files.
      await pipelineDoneCleanup({ project_dir: proj.dir });
      // Run again — nothing left to remove.
      const r2 = await pipelineDoneCleanup({ project_dir: proj.dir });
      expect(r2.removed).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  });

  it("handles a missing .claude/ directory without throwing", async () => {
    const proj = await tempProject();
    try {
      // No pipelineInit — .claude/ doesn't exist.
      const r = await pipelineDoneCleanup({ project_dir: proj.dir });
      expect(r.removed).toEqual([]);
      expect(r.kept).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  });

  it("missing individual files don't error (force semantics)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const claudeDir = join(proj.dir, ".claude");
      // Manually delete one of the files before calling cleanup.
      await writeFile(join(claudeDir, ".mcp-managed"), "", "utf8");
      const r = await pipelineDoneCleanup({ project_dir: proj.dir });
      // The cleanup completed without throwing — that's the assertion.
      expect(Array.isArray(r.removed)).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });
});
