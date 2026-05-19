/**
 * Q72 / D11 regression: pipeline_run_task emits a one-time
 * `error_class: "owner-id-unset"` audit row when none of
 * CLAUDE_PIPELINE_OWNER_ID / CLAUDE_SESSION_ID / SESSION_ID is set in env.
 *
 * Real-task observation 2026-05-19: state.owner_id=null in production
 * because CC's stdio mcpServers config doesn't auto-forward
 * CLAUDE_SESSION_ID. Without this audit, the gap is silent — the Q64
 * cross-session OWNER_MISMATCH check just no-ops and we never know.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { pipelineRunTask } from "../../../src/driver/tools/run-task.js";
import { globalAuditFile } from "../../../src/lib/audit.js";
import { tempProject } from "../../helpers/setup.js";

const OWNER_VARS = ["CLAUDE_PIPELINE_OWNER_ID", "CLAUDE_SESSION_ID", "SESSION_ID"];

async function readGlobalAuditTail(): Promise<string> {
  try {
    return await readFile(globalAuditFile(), "utf8");
  } catch {
    return "";
  }
}

describe("Q72 / D11 — owner-id-unset audit on pipeline_run_task", () => {
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = {};
    for (const k of OWNER_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  function restore() {
    for (const k of OWNER_VARS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k]!;
      }
    }
  }

  it("emits an owner-id-unset audit row when no owner env vars are set", async () => {
    const proj = await tempProject();
    const beforeRaw = await readGlobalAuditTail();
    const beforeLen = beforeRaw.length;
    try {
      await pipelineRunTask({
        project_dir: proj.dir,
        task: "owner-id-unset audit smoke",
        complexity_hint: "simple",
        stack: { language: "TypeScript" },
      });
      const afterRaw = await readGlobalAuditTail();
      // Only inspect the delta written during this test invocation.
      const delta = afterRaw.slice(beforeLen);
      const lines = delta.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const ownerAudit = lines.find(
        (l: any) => l.tool === "pipeline_run_task" && l.error_class === "owner-id-unset",
      );
      expect(ownerAudit).toBeDefined();
      expect(ownerAudit?.verdict).toBe("ok");
    } finally {
      await proj.cleanup();
      restore();
    }
  });

  it("does NOT emit owner-id-unset when CLAUDE_PIPELINE_OWNER_ID is set", async () => {
    const proj = await tempProject();
    process.env.CLAUDE_PIPELINE_OWNER_ID = "test-owner-d11";
    const beforeRaw = await readGlobalAuditTail();
    const beforeLen = beforeRaw.length;
    try {
      await pipelineRunTask({
        project_dir: proj.dir,
        task: "owner-id present smoke",
        complexity_hint: "simple",
        stack: { language: "TypeScript" },
      });
      const afterRaw = await readGlobalAuditTail();
      const delta = afterRaw.slice(beforeLen);
      const lines = delta.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const ownerAudit = lines.find(
        (l: any) => l.tool === "pipeline_run_task" && l.error_class === "owner-id-unset",
      );
      expect(ownerAudit).toBeUndefined();
    } finally {
      await proj.cleanup();
      restore();
    }
  });
});
