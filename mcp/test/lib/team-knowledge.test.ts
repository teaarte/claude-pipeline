import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempProject } from "../helpers/setup.js";
import {
  resolveTeamKnowledgePaths,
  loadTeamKnowledge,
  MAX_TEAM_KNOWLEDGE_BYTES,
  type TeamKnowledgeRef,
} from "../../src/lib/team-knowledge.js";

describe("team-knowledge (item 7)", () => {
  it("resolveTeamKnowledgePaths joins relative refs against baseDir", () => {
    const out = resolveTeamKnowledgePaths(["a.md", "/abs/b.md"], "/proj");
    expect(out).toEqual(["/proj/a.md", "/abs/b.md"]);
  });

  it("loadTeamKnowledge concatenates files with headers", async () => {
    const proj = await tempProject();
    try {
      await mkdir(join(proj.dir, "kb"), { recursive: true });
      await writeFile(join(proj.dir, "kb", "conventions.md"), "# Team conventions\nUse semicolons.\n", "utf8");
      await writeFile(join(proj.dir, "kb", "patterns.md"), "# Patterns\nPrefer composition.\n", "utf8");
      const refs: TeamKnowledgeRef[] = [
        { path: join(proj.dir, "kb", "conventions.md"), source: "project-config" },
        { path: join(proj.dir, "kb", "patterns.md"), source: "project-config" },
      ];
      const r = await loadTeamKnowledge(refs);
      expect(r.truncated).toBe(false);
      expect(r.missing).toEqual([]);
      expect(r.content).toContain("Team conventions");
      expect(r.content).toContain("Prefer composition");
      expect(r.content).toContain("<!-- team-knowledge:");
      expect(r.loaded).toHaveLength(2);
    } finally {
      await proj.cleanup();
    }
  });

  it("records missing files (ENOENT) without throwing", async () => {
    const proj = await tempProject();
    try {
      const refs: TeamKnowledgeRef[] = [
        { path: join(proj.dir, "missing.md"), source: "project-config" },
      ];
      const r = await loadTeamKnowledge(refs);
      expect(r.missing).toEqual([join(proj.dir, "missing.md")]);
      expect(r.content).toBe("");
    } finally {
      await proj.cleanup();
    }
  });

  it("truncates at the cap and stops loading further refs", async () => {
    const proj = await tempProject();
    try {
      const big = "x".repeat(100 * 1024);
      await writeFile(join(proj.dir, "big.md"), big, "utf8");
      await writeFile(join(proj.dir, "next.md"), "should-not-load", "utf8");
      const refs: TeamKnowledgeRef[] = [
        { path: join(proj.dir, "big.md"), source: "project-config" },
        { path: join(proj.dir, "next.md"), source: "project-config" },
      ];
      const r = await loadTeamKnowledge(refs);
      expect(r.truncated).toBe(true);
      expect(Buffer.byteLength(r.content, "utf8")).toBeLessThanOrEqual(MAX_TEAM_KNOWLEDGE_BYTES);
      expect(r.content).not.toContain("should-not-load");
    } finally {
      await proj.cleanup();
    }
  });

  it("custom cap respected", async () => {
    const proj = await tempProject();
    try {
      await writeFile(join(proj.dir, "k.md"), "y".repeat(500), "utf8");
      const refs: TeamKnowledgeRef[] = [
        { path: join(proj.dir, "k.md"), source: "project-config" },
      ];
      const r = await loadTeamKnowledge(refs, 100);
      expect(Buffer.byteLength(r.content, "utf8")).toBeLessThanOrEqual(100);
    } finally {
      await proj.cleanup();
    }
  });

  it("empty refs returns empty content", async () => {
    const r = await loadTeamKnowledge([]);
    expect(r.content).toBe("");
    expect(r.loaded).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});
