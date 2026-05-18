import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempProject } from "../../helpers/setup.js";
import { readProjectBundleConfig } from "../../../src/driver/loaders/project-config.js";

describe("loaders/project-config — readProjectBundleConfig (item 5)", () => {
  it("returns the code-bundle default when no pipeline.config.json present", async () => {
    const proj = await tempProject();
    try {
      const cfg = await readProjectBundleConfig(proj.dir);
      expect(cfg.bundle).toBe("code");
      expect(cfg.mcp_clients).toEqual([]);
      expect(cfg.team_knowledge_refs).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  });

  it("reads bundle name from pipeline.config.json when present", async () => {
    const proj = await tempProject();
    try {
      await mkdir(join(proj.dir, ".claude"), { recursive: true });
      await writeFile(
        join(proj.dir, ".claude", "pipeline.config.json"),
        JSON.stringify({ bundle: "research" }),
        "utf8",
      );
      const cfg = await readProjectBundleConfig(proj.dir);
      expect(cfg.bundle).toBe("research");
    } finally {
      await proj.cleanup();
    }
  });

  it("reads team_knowledge_refs and mcp_clients arrays", async () => {
    const proj = await tempProject();
    try {
      await mkdir(join(proj.dir, ".claude"), { recursive: true });
      await writeFile(
        join(proj.dir, ".claude", "pipeline.config.json"),
        JSON.stringify({
          bundle: "code",
          team_knowledge_refs: ["knowledge/team-conventions.md", "knowledge/learned-patterns.md"],
          mcp_clients: [{ name: "claude-mem", server_command: ["echo", "mock"] }],
        }),
        "utf8",
      );
      const cfg = await readProjectBundleConfig(proj.dir);
      expect(cfg.team_knowledge_refs).toEqual([
        "knowledge/team-conventions.md",
        "knowledge/learned-patterns.md",
      ]);
      expect(cfg.mcp_clients).toHaveLength(1);
    } finally {
      await proj.cleanup();
    }
  });

  it("filters non-string entries out of team_knowledge_refs (defensive)", async () => {
    const proj = await tempProject();
    try {
      await mkdir(join(proj.dir, ".claude"), { recursive: true });
      await writeFile(
        join(proj.dir, ".claude", "pipeline.config.json"),
        JSON.stringify({ team_knowledge_refs: ["valid.md", 42, null] }),
        "utf8",
      );
      const cfg = await readProjectBundleConfig(proj.dir);
      expect(cfg.team_knowledge_refs).toEqual(["valid.md"]);
    } finally {
      await proj.cleanup();
    }
  });

  it("returns defaults when pipeline.config.json is malformed JSON", async () => {
    const proj = await tempProject();
    try {
      await mkdir(join(proj.dir, ".claude"), { recursive: true });
      await writeFile(
        join(proj.dir, ".claude", "pipeline.config.json"),
        "{ not json",
        "utf8",
      );
      const cfg = await readProjectBundleConfig(proj.dir);
      expect(cfg.bundle).toBe("code");
    } finally {
      await proj.cleanup();
    }
  });
});
