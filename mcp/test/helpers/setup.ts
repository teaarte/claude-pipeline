import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function tempProject(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "cp-mcp-test-"));
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export const metricsDir = process.env.CLAUDE_PIPELINE_METRICS_DIR!;

export function metricsFile(name: string): string {
  return join(metricsDir, name);
}

export async function readJsonl<T = any>(path: string): Promise<T[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function clearMetrics(): Promise<void> {
  // Reset both jsonl files so each test sees a clean slate. paths.ts has
  // already evaluated CLAUDE_PIPELINE_METRICS_DIR — we never change the path,
  // only the contents.
  await mkdir(metricsDir, { recursive: true });
  await writeFile(join(metricsDir, "pipeline.jsonl"), "", "utf8");
  await writeFile(join(metricsDir, "agent-feedback.jsonl"), "", "utf8");
}

export type InitArgs = Parameters<
  typeof import("../../src/tools/init.js").pipelineInit
>[0];

export const defaultStack = {
  language: "TypeScript",
  package_manager: "pnpm",
  test_command: "pnpm test",
  lint_command: "pnpm lint",
  build_command: "pnpm build",
  project_type: "backend" as const,
};

export function initArgs(projectDir: string, overrides: Partial<InitArgs> = {}): InitArgs {
  return {
    project_dir: projectDir,
    task: "Test task",
    task_id: "t-2026-05-13-test",
    complexity: "medium",
    tests_mode: "regression-only",
    stack: defaultStack,
    ...overrides,
  };
}

/**
 * Spawn the begin/record dance for a non-reviewer agent. Returns the record
 * result (so tests can assert on agents_count, etc.).
 */
export async function spawnNonreview(
  projectDir: string,
  phase: "context" | "planning" | "test_first" | "implementation" | "validation" | "final",
  agent: "planner" | "implementer" | "architect" | "code-analyzer" | "dependency-auditor" | "research" | "migration",
  extras: { output_file?: string } = {},
): Promise<any> {
  const { pipelineBeginAgent } = await import("../../src/tools/begin-agent.js");
  const { pipelineRecordNonreviewAgent } = await import("../../src/tools/record-nonreview-agent.js");
  const { agent_run_id } = await pipelineBeginAgent({ project_dir: projectDir, phase, agent });
  return pipelineRecordNonreviewAgent({
    project_dir: projectDir,
    phase,
    agent,
    agent_run_id,
    ...extras,
  });
}

/**
 * Spawn the begin/record dance for a reviewer/validator agent. Returns the
 * record result.
 */
export async function spawnReviewer(
  projectDir: string,
  phase: "context" | "planning" | "test_first" | "implementation" | "validation" | "final",
  agent: string,
  agentOutput: string,
): Promise<any> {
  const { pipelineBeginAgent } = await import("../../src/tools/begin-agent.js");
  const { pipelineRecordAgentRun } = await import("../../src/tools/record-agent-run.js");
  const { agent_run_id } = await pipelineBeginAgent({ project_dir: projectDir, phase, agent });
  return pipelineRecordAgentRun({
    project_dir: projectDir,
    phase,
    agent_run_id,
    agent_output: agentOutput,
  });
}

export const reviewerOutput = (overrides: {
  agent?: string;
  verdict?: string;
  findings?: any[];
  iteration?: number;
} = {}) => {
  const body = {
    schema_version: "1.0",
    agent: overrides.agent ?? "logic-reviewer",
    task_id: "t-2026-05-13-test",
    iteration: overrides.iteration ?? 1,
    verdict: overrides.verdict ?? "REQUEST_CHANGES",
    summary_line: "summary",
    findings: overrides.findings ?? [
      {
        schema_version: "1.0",
        id: "f-2026-05-13-aaaaaa",
        agent: overrides.agent ?? "logic-reviewer",
        task_id: "t-2026-05-13-test",
        iteration: overrides.iteration ?? 1,
        file: "src/x.ts",
        line_start: 1,
        line_end: 2,
        severity: "blocking",
        category: "race-condition",
        summary: "summary",
        evidence_excerpt: "code",
        suggested_fix: "fix",
        status: "open",
      },
    ],
    past_misses_applied: 0,
    past_miss_matches: [],
    ref_rules_consulted: [],
  };
  return "```json\n" + JSON.stringify(body, null, 2) + "\n```\n\n# Body\n";
};

export const validatorOutput = (overrides: { agent?: string; verdict?: string } = {}) => {
  const body = {
    schema_version: "1.0",
    agent: overrides.agent ?? "acceptance",
    task_id: "t-2026-05-13-test",
    iteration: 1,
    verdict: overrides.verdict ?? "PASS",
    summary_line: "all good",
    findings: [],
    details: { lint: "pass", typecheck: "pass" },
  };
  return "```json\n" + JSON.stringify(body, null, 2) + "\n```\n\n# Body\n";
};
