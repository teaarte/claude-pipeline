/**
 * pipeline_done_cleanup — Q23 architectural upgrade that supersedes Q12
 * Plan A. The /done skill used to open a 300s guard bypass, run `Bash rm`
 * over MCP-managed files, then re-lock — which (a) contradicted the
 * guard-design intent (you opened a bypass window only to do raw writes),
 * (b) left a stub `mcp-audit.jsonl` behind because `pipeline_relock_writes`
 * audited itself AFTER the rm (Q14), and (c) kept the file-list in
 * markdown where it drifted from MCP-side reality.
 *
 * This tool runs the deletion server-side. It needs no guard bypass — the
 * guard hook lives in Claude Code's PreToolUse and never intercepts MCP
 * internal IO. Files are removed in a deterministic order with
 * `mcp-audit.jsonl` LAST so any audit entry emitted earlier in the call
 * chain isn't re-created. The tool itself emits NO audit entry (the
 * standard `withAudit` wrapper is bypassed at registration time) — the
 * task's completion has already been audited by `pipeline_finish`.
 */

import { rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { claudeDir } from "../lib/paths.js";
import { assertProjectDirAllowed } from "../lib/project-dir.js";

export const doneCleanupSchema = {
  project_dir: z.string(),
};

/**
 * Static file list (in the order they're removed). `mcp-audit.jsonl` is
 * the last entry so any audit emission earlier in this MCP-server process
 * doesn't get re-created after deletion.
 */
const STATIC_FILES = [
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
];

/**
 * Glob-like patterns matched by basename prefix/suffix. Each entry is a
 * predicate against the directory listing — keeps us free of an external
 * glob library while covering past-misses-*.md, plan-*.md, etc.
 */
const GLOB_PATTERNS: { test: (name: string) => boolean }[] = [
  { test: (n) => n.startsWith("past-misses-") && n.endsWith(".md") },
  { test: (n) => n.startsWith("plan-") && n.endsWith(".md") },
  { test: (n) => n.startsWith("implementation-notes") && n.endsWith(".md") },
  { test: (n) => n.startsWith("abandoned-") && n.endsWith(".json") },
];

/** Directories whose entire tree we remove (when present). */
const DIRECTORIES = ["reviews"];

/** Files we explicitly preserve. */
const PRESERVED = new Set(["settings.local.json"]);

/** Audit jsonl — handled last so the tool itself doesn't recreate it. */
const AUDIT_LAST = "mcp-audit.jsonl";

export async function pipelineDoneCleanup(input: {
  project_dir: string;
}): Promise<{ removed: string[]; kept: string[] }> {
  await assertProjectDirAllowed(input.project_dir);
  const dir = claudeDir(input.project_dir);

  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    // .claude/ doesn't exist — nothing to clean.
    return { removed: [], kept: [] };
  }

  const present = new Set(entries);
  const removed: string[] = [];
  const kept: string[] = [];

  // 1. Static files in their declared order.
  for (const name of STATIC_FILES) {
    if (!present.has(name)) continue;
    await rm(join(dir, name), { force: true, recursive: false });
    removed.push(name);
  }

  // 2. Pattern-matched files (one pass over the listing).
  for (const name of entries) {
    if (PRESERVED.has(name) || removed.includes(name)) continue;
    if (name === AUDIT_LAST) continue;
    if (GLOB_PATTERNS.some((p) => p.test(name))) {
      await rm(join(dir, name), { force: true, recursive: false });
      removed.push(name);
    }
  }

  // 3. Directories (recursive).
  for (const name of DIRECTORIES) {
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (st.isDirectory()) {
        await rm(full, { recursive: true, force: true });
        removed.push(name + "/");
      }
    } catch {
      /* not present */
    }
  }

  // 4. Tally what we kept (anything not removed and not the audit file).
  for (const name of entries) {
    if (PRESERVED.has(name)) {
      kept.push(name);
      continue;
    }
    if (removed.includes(name) || removed.includes(name + "/")) continue;
    if (name === AUDIT_LAST) continue;
    if (GLOB_PATTERNS.some((p) => p.test(name))) continue;
    if (DIRECTORIES.includes(name)) continue;
    kept.push(name);
  }

  // 5. Audit jsonl last. The withAudit wrapper is intentionally NOT applied
  // to this tool (see server.ts), so no post-cleanup audit emission will
  // re-create the file.
  if (present.has(AUDIT_LAST)) {
    await rm(join(dir, AUDIT_LAST), { force: true, recursive: false });
    removed.push(AUDIT_LAST);
  }

  return { removed, kept };
}
