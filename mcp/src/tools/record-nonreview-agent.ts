import { z } from "zod";
import { stateFile, summaryFile } from "../lib/paths.js";
import { withStateLock, writeText } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";
import { CODE_PHASES, assertPrereqSatisfied, type Phase } from "../lib/phase-state-machine.js";
import { AGENT_RUN_ID_PATTERN } from "../lib/ids.js";
import { consumeOpenSpawn } from "./begin-agent.js";

const NONREVIEW_AGENTS = [
  "planner",
  "implementer",
  "architect",
  "code-analyzer",
  "dependency-auditor",
  "research",
  "migration",
] as const;

export const recordNonreviewSchema = {
  project_dir: z.string(),
  phase: z.enum(CODE_PHASES),
  agent: z.enum(NONREVIEW_AGENTS),
  agent_run_id: z
    .string()
    .regex(AGENT_RUN_ID_PATTERN)
    .describe("Run id returned by pipeline_begin_agent. Required — must match an entry in phase.open_spawns[]."),
  output_file: z.string().optional().describe("Relative path to the file the agent produced, e.g. '.claude/plan.md'"),
};

export async function pipelineRecordNonreviewAgent(input: {
  project_dir: string;
  phase: Phase;
  agent: (typeof NONREVIEW_AGENTS)[number];
  agent_run_id: string;
  output_file?: string;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) throw new Error(`pipeline-state.json not found at ${file}. Call pipeline_init first.`);
    if (!state.phases?.[input.phase]) {
      throw new Error(`Unknown phase '${input.phase}' in pipeline-state.json`);
    }
    const phase = state.phases[input.phase];
    // INV_011: refuse to record an agent into a phase whose prereq isn't
    // completed/skipped. Catches out-of-order recording.
    if (phase.status === "pending") {
      assertPrereqSatisfied(state, input.phase as Phase, "in_progress");
    }
    // INV_012: agent_run_id MUST match an open_spawn begun for this agent.
    consumeOpenSpawn(phase, input.agent_run_id, input.agent);

    phase.agents = Array.isArray(phase.agents) ? phase.agents : [];
    phase.agents.push(input.agent);
    if (phase.status === "pending") phase.status = "in_progress";

    // Q31 (v2.2-clear-bundle): phase.iterations was a v1 summary slot
    // that the v2 driver never maintained. reviewer_verdicts[].iteration
    // is now the only source. No write here.

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
