/**
 * Project-config loader. v2 stub: returns the default config + no
 * overrides. v3 will pick up `<project>/claude-pipeline.config.ts` at
 * runtime via dynamic import and swap registry entries.
 */

import type { PluginRegistry } from "../types/plugin.js";
import type { ClaudePipelineConfig } from "../types/config.js";
import { defaultConfig } from "../types/config.js";

export async function loadProjectConfigIfPresent(
  _registry: PluginRegistry,
  _projectDir: string,
): Promise<ClaudePipelineConfig> {
  // v2: no-op. The full loader is a v3 task (see specs/v3-productization-roadmap.md).
  return defaultConfig;
}
