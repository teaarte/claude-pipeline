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

export function stateFile(projectDir: string): string {
  return join(projectDir, ".claude", "pipeline-state.json");
}

export function findingsFile(projectDir: string): string {
  return join(projectDir, ".claude", "findings.jsonl");
}

export function summaryFile(projectDir: string): string {
  return join(projectDir, ".claude", "pipeline-state-summary.md");
}

export function claudeDir(projectDir: string): string {
  return join(projectDir, ".claude");
}
