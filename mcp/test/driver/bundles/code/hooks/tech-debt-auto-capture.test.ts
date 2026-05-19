/**
 * Q-tech-debt / D3 regression: extract-tech-debt-from-prose hook back-fills
 * implementer prose observations into .claude/issues-found.md when the
 * implementer forgot to write them directly. Real-task observation
 * frontend-core 2026-05-18: implementer mentioned "Pre-existing prettier
 * debt in repo (19 files): ... not a regression." in its prose. The
 * observation lived only in driver-state.scratch and got cleaned at /done.
 *
 * Properties:
 *  - implementer-only: other agents are skipped
 *  - signal-phrase filter: paragraphs without "pre-existing" / "out-of-scope"
 *    / "TODO:" / "FIXME:" / etc. are NOT captured
 *  - idempotent: re-firing the hook on the same prose doesn't duplicate
 *    entries (paragraph hash is embedded in the auto-captured marker)
 *  - multi-paragraph: each matching paragraph captured as its own bullet
 */

import { describe, it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { __internals } from "../../../../../src/driver/bundles/code/hooks/index.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import { claudeDir } from "../../../../../src/lib/paths.js";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { tempProject } from "../../../../helpers/setup.js";
import type { DriverState } from "../../../../../src/driver/types/plugin.js";

async function fire(state: DriverState, agent: string, output: string) {
  const ctx = { registry: createRegistry(), agent, agent_output: output };
  await __internals.EXTRACT_TECH_DEBT_FROM_PROSE.run(state, ctx);
}

function baseState(projectDir: string): DriverState {
  return makeInitialDriverState({
    project_dir: projectDir,
    task: "tech-debt auto-capture smoke",
    flow_name: "medium",
  });
}

describe("Q-tech-debt / D3 — extract-tech-debt-from-prose hook", () => {
  it("captures a paragraph with 'pre-existing' as a bullet under an auto-captured marker", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const prose = [
        "# Implementation Complete",
        "",
        "## Steps Completed",
        "- [x] Step 1: wire the new flag",
        "",
        "Pre-existing prettier debt in repo (19 files): mostly .md files plus a few pre-existing TS files; not a regression.",
        "",
        "## Test Results",
        "All green.",
      ].join("\n");
      await fire(state, "implementer", prose);
      const file = await readFile(join(claudeDir(proj.dir), "issues-found.md"), "utf8");
      expect(file).toContain("<!-- auto-captured hash=");
      expect(file).toContain("Pre-existing prettier debt");
      expect(file).toContain("not a regression");
    } finally {
      await proj.cleanup();
    }
  });

  it("captures multiple matching paragraphs as separate bullets", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const prose = [
        "Pre-existing prettier debt in 3 unrelated files.",
        "",
        "TODO: refactor the auth helper — out-of-scope for this task.",
        "",
        "Implementation finished without issues.",
      ].join("\n");
      await fire(state, "implementer", prose);
      const file = await readFile(join(claudeDir(proj.dir), "issues-found.md"), "utf8");
      const markers = file.match(/<!-- auto-captured hash=/g) ?? [];
      expect(markers.length).toBe(2);
      expect(file).toContain("Pre-existing prettier debt");
      expect(file).toContain("TODO: refactor the auth helper");
      // The benign paragraph is NOT captured.
      expect(file).not.toContain("Implementation finished without issues");
    } finally {
      await proj.cleanup();
    }
  });

  it("is idempotent — running twice on the same prose doesn't duplicate", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const prose = "Noticed a leak in the WebSocket cleanup — pre-existing, not a regression.";
      await fire(state, "implementer", prose);
      await fire(state, "implementer", prose);
      const file = await readFile(join(claudeDir(proj.dir), "issues-found.md"), "utf8");
      const markers = file.match(/<!-- auto-captured hash=/g) ?? [];
      expect(markers.length).toBe(1);
    } finally {
      await proj.cleanup();
    }
  });

  it("skips non-implementer agents", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const prose = "Pre-existing prettier debt in the repo.";
      await fire(state, "planner", prose);
      await fire(state, "logic-reviewer", prose);
      // No file should have been written.
      await expect(
        readFile(join(claudeDir(proj.dir), "issues-found.md"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await proj.cleanup();
    }
  });

  it("preserves existing issues-found.md content + appends new auto-captured entries", async () => {
    const proj = await tempProject();
    try {
      await mkdir(claudeDir(proj.dir), { recursive: true });
      const existing = "# issues-found.md\n\n- Manually-written issue #1\n";
      await writeFile(join(claudeDir(proj.dir), "issues-found.md"), existing, "utf8");
      const state = baseState(proj.dir);
      await fire(state, "implementer", "TODO: handle the empty-list edge case.");
      const file = await readFile(join(claudeDir(proj.dir), "issues-found.md"), "utf8");
      expect(file).toContain("Manually-written issue #1");
      expect(file).toContain("TODO: handle the empty-list edge case");
      expect(file).toContain("<!-- auto-captured hash=");
    } finally {
      await proj.cleanup();
    }
  });

  it("emits no file when prose has no signal phrases", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      await fire(state, "implementer", "Implementation finished. All tests green.");
      await expect(
        readFile(join(claudeDir(proj.dir), "issues-found.md"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await proj.cleanup();
    }
  });
});

describe("Q-tech-debt / D3 — paragraphHash determinism", () => {
  it("produces the same hash for the same paragraph regardless of surrounding whitespace", () => {
    const a = __internals.paragraphHash("Pre-existing debt in 3 files.");
    const b = __internals.paragraphHash("  Pre-existing debt in 3 files.  ");
    expect(a).toBe(b);
  });

  it("produces different hashes for distinct paragraphs", () => {
    const a = __internals.paragraphHash("Pre-existing debt #A.");
    const b = __internals.paragraphHash("Pre-existing debt #B.");
    expect(a).not.toBe(b);
  });
});
