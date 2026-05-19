import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

// src/lib/paths.ts → ../../  = mcp/  → ../  = claude-pipeline/
// dist/lib/paths.js → ../../ = mcp/  → ../  = claude-pipeline/
export const pipelineRoot = resolve(here, "..", "..", "..");

export const schemasDir = join(pipelineRoot, "templates", "schemas");
export const templatesDir = join(pipelineRoot, "templates");

export const homeMetricsDir =
  process.env.CLAUDE_PIPELINE_METRICS_DIR ?? join(homedir(), ".claude", "metrics");
export const pipelineJsonl = join(homeMetricsDir, "pipeline.jsonl");
export const agentFeedbackJsonl = join(homeMetricsDir, "agent-feedback.jsonl");

/**
 * Q66 / D5: per-project working subdirectory name. Defaults to `.claude`
 * (Claude Code convention). Headless / daemon / non-CC users can override
 * via the CLAUDE_PIPELINE_PROJECT_SUBDIR env var. Read once at module
 * load time so all path helpers stay consistent inside a process.
 *
 * No migration logic — projects either use the default OR explicitly opt
 * into a different subdir. Cross-machine portability is the env-var's
 * job, not the pipeline's.
 */
export const PROJECT_SUBDIR = process.env.CLAUDE_PIPELINE_PROJECT_SUBDIR ?? ".claude";

export function stateFile(projectDir: string): string {
  return join(projectDir, PROJECT_SUBDIR, "pipeline-state.json");
}

export function findingsFile(projectDir: string): string {
  return join(projectDir, PROJECT_SUBDIR, "findings.jsonl");
}

export function summaryFile(projectDir: string): string {
  return join(projectDir, PROJECT_SUBDIR, "pipeline-state-summary.md");
}

export function claudeDir(projectDir: string): string {
  return join(projectDir, PROJECT_SUBDIR);
}
