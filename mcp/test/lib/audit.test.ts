import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import {
  audit,
  classifyErrorMessage,
  makeArgsSummary,
  pickProjectDir,
  pickForceFlag,
  withAudit,
  globalAuditFile,
  projectAuditFile,
  AUDIT_GLOBAL_CAP,
} from "../../src/lib/audit.js";
import {
  tempProject,
  initArgs,
  clearMetrics,
  readJsonl,
  metricsDir,
} from "../helpers/setup.js";
import { pipelineInit } from "../../src/tools/init.js";

async function clearAuditFiles(projectDir?: string) {
  await writeFile(globalAuditFile(), "", "utf8").catch(() => {});
  if (projectDir) {
    try {
      await writeFile(projectAuditFile(projectDir), "", "utf8");
    } catch {
      /* file may not yet exist */
    }
  }
}

describe("makeArgsSummary", () => {
  it("omits agent_output as a length marker", () => {
    const s = makeArgsSummary({ agent_output: "a".repeat(5000), other: 1 });
    expect(s.agent_output).toBe("<5000 chars>");
    expect(s.other).toBe(1);
  });

  it("collapses any string > 200 chars to a length marker", () => {
    const long = "x".repeat(300);
    const s = makeArgsSummary({ short: "hi", long });
    expect(s.short).toBe("hi");
    expect(s.long).toBe("<300 chars>");
  });

  it("handles non-object input", () => {
    expect(makeArgsSummary(null)).toEqual({});
    expect(makeArgsSummary("string")).toEqual({});
  });
});

describe("pickProjectDir / pickForceFlag", () => {
  it("pickProjectDir reads project_dir string or null", () => {
    expect(pickProjectDir({ project_dir: "/x" })).toBe("/x");
    expect(pickProjectDir({})).toBeNull();
    expect(pickProjectDir(null)).toBeNull();
  });

  it("pickForceFlag detects force arg and unlock tool", () => {
    expect(pickForceFlag("pipeline_finish", { force: true })).toBe(true);
    expect(pickForceFlag("pipeline_finish", { force: false })).toBe(false);
    expect(pickForceFlag("pipeline_finish", {})).toBe(false);
    expect(pickForceFlag("pipeline_unlock_writes", {})).toBe(true);
  });
});

describe("audit() — single write", () => {
  beforeEach(async () => {
    await clearAuditFiles();
  });

  afterEach(async () => {
    await clearMetrics();
    await clearAuditFiles();
  });

  it("writes a valid JSON entry to global audit jsonl", async () => {
    await audit({
      tool: "pipeline_state_get",
      args: { project_dir: "/x" },
      projectDir: null,
      verdict: "ok",
    });
    const rows = await readJsonl(globalAuditFile());
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows[rows.length - 1];
    expect(last.tool).toBe("pipeline_state_get");
    expect(last.verdict).toBe("ok");
    expect(last.schema_version).toBe("1.0");
    expect(last.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(last.force_used).toBe(false);
  });

  it("writes to both per-project and global streams (global redacts project_dir)", async () => {
    const proj = await tempProject();
    try {
      await pipelineInit(initArgs(proj.dir));
      await clearAuditFiles(proj.dir);
      await audit({
        tool: "pipeline_state_get",
        args: { project_dir: proj.dir },
        projectDir: proj.dir,
        verdict: "ok",
      });
      // Per-project stream keeps full project_dir + task_id.
      const projRows = await readJsonl(projectAuditFile(proj.dir));
      expect(projRows).toHaveLength(1);
      expect(projRows[0].project_dir).toBe(proj.dir);
      expect(projRows[0].task_id).toBe("t-2026-05-13-test");
      // Global stream redacts project_dir to a length-marker (Security sec007).
      const globalRows = await readJsonl(globalAuditFile());
      expect(globalRows.length).toBeGreaterThanOrEqual(1);
      const last = globalRows[globalRows.length - 1];
      expect(last.project_dir).toMatch(/^<project-dir \d+ chars>$/);
      expect(last.task_id).toBe("t-2026-05-13-test"); // task_id stays
    } finally {
      await proj.cleanup();
    }
  });

  it("records force_used=true with verdict=force_bypass", async () => {
    await audit({
      tool: "pipeline_finish",
      args: { force: true, project_dir: "/x" },
      projectDir: null,
      verdict: "force_bypass",
      force_used: true,
    });
    const rows = await readJsonl(globalAuditFile());
    const last = rows[rows.length - 1];
    expect(last.verdict).toBe("force_bypass");
    expect(last.force_used).toBe(true);
  });

  it("records error with verdict=error", async () => {
    await audit({
      tool: "pipeline_init",
      args: {},
      projectDir: null,
      verdict: "error",
      error: "boom",
    });
    const rows = await readJsonl(globalAuditFile());
    const last = rows[rows.length - 1];
    expect(last.verdict).toBe("error");
    expect(last.error).toBe("boom");
  });
});

describe("withAudit() wrapper", () => {
  beforeEach(async () => {
    await clearAuditFiles();
  });

  afterEach(async () => {
    await clearMetrics();
    await clearAuditFiles();
  });

  it("produces one audit entry per successful call", async () => {
    const proj = await tempProject();
    try {
      await clearAuditFiles(proj.dir);
      const wrapped = withAudit("pipeline_init", pipelineInit);
      for (let i = 0; i < 3; i++) {
        await wrapped({ ...initArgs(proj.dir), task_id: `t-2026-05-13-iter${i}` });
        // The second iteration will hit "Refusing to overwrite" once verdict
        // is set — but verdict is null at init time. Subsequent inits update
        // the same state file. That's fine — each call still writes audit.
        // Refresh state by deleting the file between iterations.
        // Reset between iterations — must delete (not write `{}`), because
        // withStateLock now treats a pre-existing `{}` as CORRUPT_STATE (H12).
        await rm(`${proj.dir}/.claude/pipeline-state.json`).catch(() => undefined);
      }
      const rows = await readJsonl(projectAuditFile(proj.dir));
      expect(rows.length).toBe(3);
      expect(rows.every((r: any) => r.tool === "pipeline_init")).toBe(true);
    } finally {
      await proj.cleanup();
    }
  });

  it("produces an audit entry on error and re-throws", async () => {
    const proj = await tempProject();
    try {
      const wrapped = withAudit("pipeline_state_get", async () => {
        throw new Error("manufactured failure");
      });
      await expect(wrapped({ project_dir: proj.dir })).rejects.toThrow(/manufactured failure/);
      const rows = await readJsonl(globalAuditFile());
      const last = rows[rows.length - 1];
      expect(last.verdict).toBe("error");
      expect(last.error).toMatch(/manufactured failure/);
    } finally {
      await proj.cleanup();
    }
  });
});

describe("Q11 — error_class field on audit entries", () => {
  beforeEach(async () => {
    await clearAuditFiles();
  });
  afterEach(async () => {
    await clearMetrics();
    await clearAuditFiles();
  });

  it("classifyErrorMessage maps each observed pattern correctly", () => {
    expect(classifyErrorMessage("INV_011: cannot advance phase 'planning'")).toBe("swallowed-inv");
    expect(classifyErrorMessage("INV_002: phase 'planning' has 0 agents")).toBe("swallowed-inv");
    expect(classifyErrorMessage("INV_010: invalid status transition")).toBe("swallowed-inv");
    expect(classifyErrorMessage("Agent header failed reviewer-output.schema.json validation: ...")).toBe("schema-validation");
    expect(classifyErrorMessage("Finding failed schema validation: /id mismatch")).toBe("schema-validation");
    expect(classifyErrorMessage("Failed to parse JSON header: unexpected token")).toBe("schema-validation");
    expect(classifyErrorMessage("Finding category 'made-up' is not in vocab for agent 'logic-reviewer'")).toBe("vocab-rejected");
    expect(classifyErrorMessage("pipeline-state.json not found")).toBe("genuine-failure");
    expect(classifyErrorMessage("ECONNRESET: socket hang up")).toBe("genuine-failure");
  });

  it("audit() round-trips an explicit error_class field", async () => {
    await audit({
      tool: "pipeline_record_agent_run",
      args: {},
      projectDir: null,
      verdict: "ok",
      error_class: "retry-recovered",
    });
    const rows = await readJsonl(globalAuditFile());
    const last = rows[rows.length - 1];
    expect(last.verdict).toBe("ok");
    expect(last.error_class).toBe("retry-recovered");
  });

  it("audit() omits error_class when not supplied (legacy callers)", async () => {
    await audit({
      tool: "pipeline_state_get",
      args: {},
      projectDir: null,
      verdict: "ok",
    });
    const rows = await readJsonl(globalAuditFile());
    const last = rows[rows.length - 1];
    expect(last.error_class).toBeUndefined();
  });

  it("withAudit() auto-classifies a thrown error from its message", async () => {
    const wrapped = withAudit("pipeline_record_agent_run", async () => {
      throw new Error("Finding category 'invented' is not in vocab for agent 'logic-reviewer'");
    });
    await expect(wrapped({ project_dir: "/x" })).rejects.toThrow();
    const rows = await readJsonl(globalAuditFile());
    const last = rows[rows.length - 1];
    expect(last.verdict).toBe("error");
    expect(last.error_class).toBe("vocab-rejected");
  });

  it("withAudit() falls back to genuine-failure for unrecognised errors", async () => {
    const wrapped = withAudit("pipeline_state_get", async () => {
      throw new Error("disk on fire");
    });
    await expect(wrapped({ project_dir: "/x" })).rejects.toThrow();
    const rows = await readJsonl(globalAuditFile());
    const last = rows[rows.length - 1];
    expect(last.error_class).toBe("genuine-failure");
  });
});

describe("audit() — global cap", () => {
  beforeEach(async () => {
    await clearAuditFiles();
  });

  afterEach(async () => {
    await clearMetrics();
    await clearAuditFiles();
  });

  it("H11: concurrent audits at cap boundary preserve both entries and stay at cap", async () => {
    // Seed at cap - 1. Fire 2 concurrent audits. Both must be preserved
    // and the file must end at exactly cap (one append + one trim path).
    // The pre-fix fast path let both observers see "under cap" via stat and
    // skip the lock, blowing past the cap.
    const filler = "x".repeat(270);
    const seedLines: string[] = [];
    for (let i = 0; i < AUDIT_GLOBAL_CAP - 1; i++) {
      seedLines.push(JSON.stringify({ schema_version: "1.0", seq: i, filler }));
    }
    await writeFile(globalAuditFile(), seedLines.join("\n") + "\n", "utf8");

    await Promise.all([
      audit({ tool: "pipeline_state_get", args: {}, projectDir: null, verdict: "ok" }),
      audit({ tool: "pipeline_state_get", args: {}, projectDir: null, verdict: "ok" }),
    ]);
    const after = (await readFile(globalAuditFile(), "utf8"))
      .split("\n")
      .filter(Boolean);
    expect(after.length).toBeLessThanOrEqual(AUDIT_GLOBAL_CAP);
    const newAudits = after.filter((l) => {
      try {
        return JSON.parse(l).tool === "pipeline_state_get";
      } catch {
        return false;
      }
    });
    expect(newAudits.length).toBe(2);
  }, 20_000);

  it("FIFO-truncates global jsonl when > AUDIT_GLOBAL_CAP", async () => {
    // Pre-seed the global file with AUDIT_GLOBAL_CAP entries each padded out
    // to ~300 bytes so the size-gate in appendCapped triggers the slow path
    // (and thus the truncation branch). Real audit entries are ~300+ bytes;
    // tiny synthetic entries would mask the rotation behavior.
    const lines: string[] = [];
    const filler = "x".repeat(270);
    for (let i = 0; i < AUDIT_GLOBAL_CAP; i++) {
      lines.push(JSON.stringify({ schema_version: "1.0", seq: i, filler }));
    }
    await writeFile(globalAuditFile(), lines.join("\n") + "\n", "utf8");
    // Now write one more — total would be CAP+1; expect FIFO truncation back to CAP.
    await audit({
      tool: "pipeline_state_get",
      args: {},
      projectDir: null,
      verdict: "ok",
    });
    const after = (await readFile(globalAuditFile(), "utf8")).split("\n").filter(Boolean);
    expect(after.length).toBe(AUDIT_GLOBAL_CAP);
    // Oldest entry (seq=0) should be dropped; newest entry should be the one we wrote.
    const oldest = JSON.parse(after[0]);
    expect(oldest.seq).toBe(1);
    const newest = JSON.parse(after[after.length - 1]);
    expect(newest.tool).toBe("pipeline_state_get");
  }, 15_000);
});
