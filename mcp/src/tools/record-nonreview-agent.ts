import { z } from "zod";
import { stateFile, summaryFile } from "../lib/paths.js";
import { withStateLock, writeText } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";

const NONREVIEW_AGENTS = [
  "planner",
  "implementer",
  "architect",
  "code-analyzer",
  "dependency-auditor",
  "research",
  "migration",
] as const;

const VALID_PHASES = ["context", "planning", "test_first", "implementation", "validation", "final"] as const;

export const recordNonreviewSchema = {
  project_dir: z.string(),
  phase: z.enum(VALID_PHASES),
  agent: z.enum(NONREVIEW_AGENTS),
  output_file: z.string().optional().describe("Relative path to the file the agent produced, e.g. '.claude/plan.md'"),
  iterations: z.number().int().min(0).optional().describe("If this is a re-spawn, current iteration count"),
};

export async function pipelineRecordNonreviewAgent(input: {
  project_dir: string;
  phase: (typeof VALID_PHASES)[number];
  agent: (typeof NONREVIEW_AGENTS)[number];
  output_file?: string;
  iterations?: number;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) throw new Error(`pipeline-state.json not found at ${file}. Call pipeline_init first.`);
    if (!state.phases?.[input.phase]) {
      throw new Error(`Unknown phase '${input.phase}' in pipeline-state.json`);
    }
    const phase = state.phases[input.phase];
    phase.agents = Array.isArray(phase.agents) ? phase.agents : [];
    phase.agents.push(input.agent);
    if (phase.status === "pending") phase.status = "in_progress";

    if (input.iterations != null && "iterations" in phase) {
      phase.iterations = input.iterations;
    }

    state.agents_count = (state.agents_count ?? 0) + 1;

    if (input.output_file) {
      state.files = state.files ?? { created: [], modified: [] };
      state.files.created = Array.isArray(state.files.created) ? state.files.created : [];
      if (!state.files.created.includes(input.output_file)) {
        state.files.created.push(input.output_file);
      }
    }

    await writeText(summary, await buildSummary(state));

    return {
      state,
      result: {
        agent: input.agent,
        phase: input.phase,
        agents_count: state.agents_count,
      },
    };
  });
}
