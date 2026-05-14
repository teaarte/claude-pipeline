/**
 * Q12 regression: the cleanup sequence /done performs (unlock → rm protected
 * files → relock) must leave the project directory clean — no leftover MCP-
 * managed state file, no leftover bypass marker, no Q13 orphan.
 *
 * The guard hook itself is a shell script (hooks/pipeline-guard.sh) so we
 * can't simulate the deny path from TypeScript; this test stays at the MCP
 * tool layer and asserts the state transitions the /done skill markdown
 * relies on.
 */

import { describe, it, expect, afterEach } from "vitest";
import { access, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tempProject, initArgs, clearMetrics } from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";
import {
  pipelineUnlockWrites,
  pipelineRelockWrites,
  readBypassMarker,
} from "../../src/tools/unlock-writes.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("Q12 — /done cleanup sequence", () => {
  afterEach(async () => {
    await clearMetrics();
  });

  it("unlock → rm protected files → relock leaves no bypass marker or .mcp-managed orphan", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      const claudeDir = join(proj.dir, ".claude");
      const stateJson = join(claudeDir, "pipeline-state.json");
      const findingsJsonl = join(claudeDir, "findings.jsonl");
      const summaryMd = join(claudeDir, "pipeline-state-summary.md");
      const managedMarker = join(claudeDir, ".mcp-managed");
      const bypassMarker = join(claudeDir, ".mcp-bypass-allowed");

      // Sanity: the files /done is supposed to clean exist.
      expect(await fileExists(stateJson)).toBe(true);
      expect(await fileExists(managedMarker)).toBe(true);

      // The skill calls pipeline_unlock_writes first.
      const unlock = await pipelineUnlockWrites({
        project_dir: proj.dir,
        ttl_seconds: 300,
        reason: "/done cleanup",
      });
      expect(unlock.marker_file).toBe(bypassMarker);
      expect(await fileExists(bypassMarker)).toBe(true);

      // …then deletes every protected file (the skill enumerates them).
      for (const f of [stateJson, findingsJsonl, summaryMd, managedMarker]) {
        await unlink(f).catch(() => undefined);
      }

      // …finally calls pipeline_relock_writes, which is the ONLY correct
      // way to remove .mcp-bypass-allowed (Q13 — manual rm leaves it as an
      // orphan in older flows).
      const relock = await pipelineRelockWrites({ project_dir: proj.dir });
      expect(relock.relocked).toBe(true);
      expect(relock.marker_existed).toBe(true);

      // Post-conditions: no protected file remains in .claude/.
      expect(await fileExists(bypassMarker)).toBe(false);
      expect(await readBypassMarker(proj.dir)).toBeNull();
      expect(await fileExists(stateJson)).toBe(false);
      expect(await fileExists(managedMarker)).toBe(false);
    } finally {
      await proj.cleanup();
    }
  });
});
