/**
 * Project-config loader. Reads `<project>/.claude/pipeline.config.json` if
 * present and returns:
 *   - bundle name (default "code")
 *   - mcp_clients[] (Item 6 — external MCP integrations)
 *   - team_knowledge_refs[] (Item 7 — shared knowledge slot)
 *
 * The model-routing config (`ClaudePipelineConfig` in `types/config.ts`)
 * remains the v2.5 Web UI edit target; this loader is the project-level
 * bundle config from v2.2.5.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginRegistry } from "../types/plugin.js";
import type { ClaudePipelineConfig } from "../types/config.js";
import { defaultConfig } from "../types/config.js";

export interface ProjectBundleConfig {
  bundle: string;
  mcp_clients: ReadonlyArray<unknown>;
  team_knowledge_refs: ReadonlyArray<string>;
}

const DEFAULT_BUNDLE_CONFIG: ProjectBundleConfig = {
  bundle: "code",
  mcp_clients: [],
  team_knowledge_refs: [],
};

export async function readProjectBundleConfig(
  projectDir: string,
): Promise<ProjectBundleConfig> {
  const configPath = join(projectDir, ".claude", "pipeline.config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      bundle: typeof parsed.bundle === "string" ? parsed.bundle : "code",
      mcp_clients: Array.isArray(parsed.mcp_clients) ? parsed.mcp_clients : [],
      team_knowledge_refs: Array.isArray(parsed.team_knowledge_refs)
        ? parsed.team_knowledge_refs.filter((r: unknown): r is string => typeof r === "string")
        : [],
    };
  } catch {
    return DEFAULT_BUNDLE_CONFIG;
  }
}

export async function loadProjectConfigIfPresent(
  _registry: PluginRegistry,
  _projectDir: string,
): Promise<ClaudePipelineConfig> {
  // Model-routing config — still a stub; Web UI editor lands in v2.3+.
  return defaultConfig;
}
