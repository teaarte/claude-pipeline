import { z } from "zod";
import { stateFile, summaryFile } from "../lib/paths.js";
import { withStateLock, writeText } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";
import {
  PHASES,
  STATUSES,
  type Phase,
  type Status,
  assertTransitionAllowed,
  assertPrereqSatisfied,
} from "../lib/phase-state-machine.js";
import { captureGitDiff } from "../lib/git-diff.js";
import { audit } from "../lib/audit.js";

const SKIPPED_REASON_BY_PHASE: Record<string, readonly string[]> = {
  test_first: ["regression-only", "no-test-framework-tdd-blocked", "user-override-no-tests"],
};

export const setPhaseStatusSchema = {
  project_dir: z.string(),
  phase: z.enum(PHASES),
  status: z.enum(STATUSES),
  skipped_reason: z.string().optional(),
  force: z.boolean().optional().describe("Bypass invariant check (allow completed with no agents, invalid transitions, missing prereqs). Records pipeline_violation."),
};

export async function pipelineSetPhaseStatus(input: {
  project_dir: string;
  phase: Phase;
  status: Status;
  skipped_reason?: string;
  force?: boolean;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) throw new Error(`pipeline-state.json not found at ${file}`);
    const phase = state.phases?.[input.phase];
    if (!phase) throw new Error(`Unknown phase '${input.phase}'`);

    // INV_010: state-machine transition guard.
    const fromStatus: Status = (phase.status as Status) ?? "pending";
    if (!input.force) {
      assertTransitionAllowed(input.phase, fromStatus, input.status);
      // INV_011: phase prerequisite ordering.
      assertPrereqSatisfied(state, input.phase, input.status);
    }

    if (input.status === "completed" && !input.force) {
      const agents: string[] = phase.agents ?? [];
      if (agents.length === 0 && input.phase !== "context" && input.phase !== "final") {
        throw new Error(
          `INV_002: cannot set phase '${input.phase}' to 'completed' with empty agents[]. ` +
            `Spawn at least one agent or use 'skipped' with a reason. Pass force=true to override (records pipeline_violation).`,
        );
      }
    }
    // INV_012: open_spawns[] must be empty before CLOSING a phase (completed
    // OR skipped). A skipped phase with open spawns is the same leak as
    // completed; this used to only check completed.
    if (
      (input.status === "completed" || input.status === "skipped") &&
      !input.force
    ) {
      const open: any[] = phase.open_spawns ?? [];
      if (open.length > 0) {
        const ids = open.map((s) => `${s.id}(${s.agent})`).join(", ");
        throw new Error(
          `INV_012: cannot set phase '${input.phase}' to '${input.status}' while ${open.length} spawn(s) are still open: ${ids}. ` +
            `Record them with pipeline_record_agent_run / pipeline_record_nonreview_agent, or cancel with pipeline_cancel_spawn.`,
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

    // Q33: at implementation close, snapshot the working-tree diff so
    // state.files.{created,modified} reflects what changed instead of the
    // empty arrays the v2 driver never wrote. Best-effort: git absence /
    // non-repo / exec errors degrade to empty arrays + an audit note.
    if (input.phase === "implementation" && input.status === "completed") {
      const diff = await captureGitDiff(input.project_dir);
      state.files = state.files ?? { created: [], modified: [] };
      state.files.created = Array.isArray(state.files.created) ? state.files.created : [];
      state.files.modified = Array.isArray(state.files.modified) ? state.files.modified : [];
      if (diff) {
        for (const p of diff.created) {
          if (!state.files.created.includes(p)) state.files.created.push(p);
        }
        for (const p of diff.modified) {
          if (!state.files.modified.includes(p)) state.files.modified.push(p);
        }
      } else {
        // Surface the gap; analyser can grep for git-unavailable in audit.
        await audit({
          tool: "pipeline_set_phase_status",
          args: { phase: input.phase, status: input.status },
          projectDir: input.project_dir,
          verdict: "ok",
          error_class: "git-unavailable",
        }).catch(() => undefined);
      }
    }

    await writeText(summary, await buildSummary(state));

    return {
      state,
      result: { phase: input.phase, status: phase.status, pipeline_violation: state.pipeline_violation ?? null },
    };
  });
}
