import { z } from "zod";
import { stateFile, summaryFile } from "../lib/paths.js";
import { withStateLock, writeText } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";

const VALID_PHASES = ["context", "planning", "test_first", "implementation", "validation", "final"] as const;
const VALID_STATUS = ["pending", "in_progress", "completed", "skipped"] as const;

const SKIPPED_REASON_BY_PHASE: Record<string, readonly string[]> = {
  test_first: ["regression-only", "no-test-framework-tdd-blocked", "user-override-no-tests"],
};

export const setPhaseStatusSchema = {
  project_dir: z.string(),
  phase: z.enum(VALID_PHASES),
  status: z.enum(VALID_STATUS),
  skipped_reason: z.string().optional(),
  force: z.boolean().optional().describe("Bypass invariant check (allow completed with no agents). Use rarely."),
};

export async function pipelineSetPhaseStatus(input: {
  project_dir: string;
  phase: (typeof VALID_PHASES)[number];
  status: (typeof VALID_STATUS)[number];
  skipped_reason?: string;
  force?: boolean;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) throw new Error(`pipeline-state.json not found at ${file}`);
    const phase = state.phases?.[input.phase];
    if (!phase) throw new Error(`Unknown phase '${input.phase}'`);

    if (input.status === "completed" && !input.force) {
      const agents: string[] = phase.agents ?? [];
      if (agents.length === 0 && input.phase !== "context" && input.phase !== "final") {
        throw new Error(
          `INV_002: cannot set phase '${input.phase}' to 'completed' with empty agents[]. ` +
            `Spawn at least one agent or use 'skipped' with a reason. Pass force=true to override (records pipeline_violation).`,
        );
      }
    }

    if (input.status === "skipped") {
      if (input.phase === "test_first" || input.phase === "context") {
        const allowed = SKIPPED_REASON_BY_PHASE[input.phase];
        if (allowed && (!input.skipped_reason || !allowed.includes(input.skipped_reason))) {
          throw new Error(
            `INV_003: phase '${input.phase}' skipped requires skipped_reason ∈ ${JSON.stringify(allowed)}, got '${input.skipped_reason}'`,
          );
        }
        if (!input.skipped_reason) {
          throw new Error(`INV_003: skipped_reason is required when skipping phase '${input.phase}'`);
        }
      }
    }

    const now = new Date().toISOString();
    if (input.status === "in_progress" && !phase.started_at) phase.started_at = now;
    if (input.status === "completed" || input.status === "skipped") {
      phase.completed_at = now;
    }

    phase.status = input.status;
    if (input.status === "skipped" && input.skipped_reason && "skipped_reason" in phase) {
      phase.skipped_reason = input.skipped_reason;
    }

    if (input.force) {
      state.pipeline_violation = state.pipeline_violation
        ? `${state.pipeline_violation}; phase-force-${input.phase}`
        : `phase-force-${input.phase}`;
    }

    await writeText(summary, await buildSummary(state));

    return {
      state,
      result: { phase: input.phase, status: phase.status, pipeline_violation: state.pipeline_violation ?? null },
    };
  });
}
