/**
 * Q33: parseDiffOutput maps `git diff --name-status HEAD` lines to
 * { created, modified }. Renames/copies (R/C) route to modified using the
 * new path; deletes (D) are silently dropped because state.files has no
 * deleted slot.
 *
 * Also covers captureGitDiff's degraded path — running in a non-repo tmp
 * dir must return null instead of throwing.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiffOutput, captureGitDiff } from "../../src/lib/git-diff.js";

describe("Q33 — git-diff helper", () => {
  it("parses A/M into created/modified", () => {
    const out = ["A\tdocs/ROADMAP.md", "M\tpackages/module-contract/src/index.ts"].join("\n");
    expect(parseDiffOutput(out)).toEqual({
      created: ["docs/ROADMAP.md"],
      modified: ["packages/module-contract/src/index.ts"],
    });
  });

  it("treats renames (R) as modified using the new path", () => {
    const out = "R100\tsrc/old/path.ts\tsrc/new/path.ts";
    expect(parseDiffOutput(out)).toEqual({
      created: [],
      modified: ["src/new/path.ts"],
    });
  });

  it("treats copies (C) as modified using the new path", () => {
    const out = "C075\tsrc/origin.ts\tsrc/copy.ts";
    expect(parseDiffOutput(out)).toEqual({
      created: [],
      modified: ["src/copy.ts"],
    });
  });

  it("drops deletes (D) because state.files has no deleted slot", () => {
    const out = ["D\tsrc/removed.ts", "A\tsrc/added.ts"].join("\n");
    expect(parseDiffOutput(out)).toEqual({
      created: ["src/added.ts"],
      modified: [],
    });
  });

  it("ignores blank lines and trailing CR", () => {
    const out = "A\tfile.ts\r\n\nM\tother.ts\r\n";
    expect(parseDiffOutput(out)).toEqual({
      created: ["file.ts"],
      modified: ["other.ts"],
    });
  });

  it("captureGitDiff returns null for a non-git directory (degraded path)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp-no-git-"));
    try {
      const r = await captureGitDiff(dir);
      expect(r).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
