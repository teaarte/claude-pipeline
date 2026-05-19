/**
 * Q66 / D5 regression: PROJECT_SUBDIR is read from CLAUDE_PIPELINE_PROJECT_SUBDIR
 * once at module-load time, with `.claude` as the default. All per-project
 * path helpers (stateFile, findingsFile, summaryFile, claudeDir) use the
 * resolved value consistently.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

async function importPathsWithSubdir(subdir: string | undefined) {
  if (subdir === undefined) {
    delete process.env.CLAUDE_PIPELINE_PROJECT_SUBDIR;
  } else {
    process.env.CLAUDE_PIPELINE_PROJECT_SUBDIR = subdir;
  }
  vi.resetModules();
  return await import("../../src/lib/paths.js");
}

describe("Q66 / D5 — PROJECT_SUBDIR env var", () => {
  beforeEach(() => {
    delete process.env.CLAUDE_PIPELINE_PROJECT_SUBDIR;
  });

  it("defaults to '.claude' when the env var is unset", async () => {
    const paths = await importPathsWithSubdir(undefined);
    expect(paths.PROJECT_SUBDIR).toBe(".claude");
    expect(paths.stateFile("/proj")).toBe("/proj/.claude/pipeline-state.json");
    expect(paths.findingsFile("/proj")).toBe("/proj/.claude/findings.jsonl");
    expect(paths.summaryFile("/proj")).toBe("/proj/.claude/pipeline-state-summary.md");
    expect(paths.claudeDir("/proj")).toBe("/proj/.claude");
  });

  it("uses the env var value when set", async () => {
    const paths = await importPathsWithSubdir(".pipeline");
    expect(paths.PROJECT_SUBDIR).toBe(".pipeline");
    expect(paths.stateFile("/proj")).toBe("/proj/.pipeline/pipeline-state.json");
    expect(paths.findingsFile("/proj")).toBe("/proj/.pipeline/findings.jsonl");
    expect(paths.summaryFile("/proj")).toBe("/proj/.pipeline/pipeline-state-summary.md");
    expect(paths.claudeDir("/proj")).toBe("/proj/.pipeline");
  });

  it("path helpers stay consistent — all four use the same subdir", async () => {
    const paths = await importPathsWithSubdir("custom-dir");
    const dir = paths.claudeDir("/proj");
    expect(paths.stateFile("/proj").startsWith(dir + "/")).toBe(true);
    expect(paths.findingsFile("/proj").startsWith(dir + "/")).toBe(true);
    expect(paths.summaryFile("/proj").startsWith(dir + "/")).toBe(true);
  });
});
