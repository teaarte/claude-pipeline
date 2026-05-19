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
  /**
   * D9 (Q70): cap on the auto-replan loop at planning gate-1. Default `0`
   * (today's manual gate-1 every time). `1` or `2` opts in — when
   * REQUEST_CHANGES fires at planning iter=N and N < max, the pipeline
   * uses D8's auto-derived suggested-revision as a synthetic
   * gate-1-reject and replans automatically (no human pause).
   *
   * Cap exists because real-task observation 2026-05-19 showed a
   * reject-respawn-respawn confirmation-bias risk. Forcing manual review
   * after N attempts keeps the human in the loop.
   */
  auto_replan_on_blocking_max: 0 | 1 | 2;
}

const DEFAULT_BUNDLE_CONFIG: ProjectBundleConfig = {
  bundle: "code",
  mcp_clients: [],
  team_knowledge_refs: [],
  auto_replan_on_blocking_max: 0,
};

function pickAutoReplanCap(v: unknown): 0 | 1 | 2 {
  if (v === 1 || v === 2) return v;
  return 0;
}

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
      auto_replan_on_blocking_max: pickAutoReplanCap(parsed.auto_replan_on_blocking_max),
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
