import { z } from "zod";
import { stateFile, findingsFile, pipelineJsonl } from "../lib/paths.js";
import { withStateLock, appendJsonl } from "../lib/state-io.js";
import { runInvariants } from "../lib/invariants.js";

export const finishSchema = {
  project_dir: z.string(),
  verdict: z.enum(["accepted", "rejected"]),
  project_short: z.string().optional().describe("Short project name for metrics row, e.g. 's3-panel'"),
  task_short: z.string().optional().describe("Short task title for metrics row"),
  force: z.boolean().optional().describe("Force finish even with stale-spawn violations. Records pipeline_violation."),
};

function shortFromTaskId(taskId: string): { date: string; short: string } {
  // task_id pattern: t-YYYY-MM-DD-slug
  const m = taskId.match(/^t-(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (!m) return { date: new Date().toISOString().slice(0, 10), short: taskId };
  return { date: m[1], short: m[2] };
}

export async function pipelineFinish(input: {
  project_dir: string;
  verdict: "accepted" | "rejected";
  project_short?: string;
  task_short?: string;
  force?: boolean;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const fjsonl = findingsFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) throw new Error(`pipeline-state.json not found at ${file}`);

    // Set verdict first so invariant INV_007 runs against the intended outcome.
    state.verdict = input.verdict;

    const violations = await runInvariants(state, fjsonl);
    // Stale-spawn alone is bypassable with force=true. Any other violation is hard-blocked.
    const blocking = input.force
      ? violations.filter((v) => v.code !== "stale-spawn")
      : violations;
    if (blocking.length > 0) {
      // Revert verdict to avoid leaving partial state.
      state.verdict = null;
      throw new Error(
        `pipeline_finish refused: ${blocking.length} invariant violation(s).\n` +
          blocking.map((v) => `  [${v.code}] ${v.message}`).join("\n"),
      );
    }
    if (input.force && violations.length > 0) {
      state.pipeline_violation = state.pipeline_violation
        ? `${state.pipeline_violation}; finish-force-stale-spawn`
        : "finish-force-stale-spawn";
    }

    // Build mechanical metrics row.
    const { date, short } = shortFromTaskId(state.task_id);
    const verdicts: any[] = state.reviewer_verdicts ?? [];
    const reviewersWithBlockers = Array.from(
      new Set(verdicts.filter((v) => (v.blocking_issues ?? 0) > 0).map((v) => v.agent)),
    );
    const categoriesSeen = Array.from(
      new Set(verdicts.flatMap((v) => v.categories_seen ?? [])),
    );
    const phases = state.phases ?? {};

    const row = {
      schema_version: "1.0",
      date,
      task_id: state.task_id,
      project: input.project_short ?? "",
      task_short: input.task_short ?? short,
      complexity: state.complexity,
      plan_iters: phases.planning?.iterations ?? 0,
      gate1_revisions: phases.planning?.gate1_revisions ?? 0,
      impl_iters: phases.implementation?.iterations ?? 0,
      blockers_found: state.blockers_found ?? 0,
      reviewers_with_blockers: reviewersWithBlockers,
      reviewer_verdicts: verdicts.map((v) => ({
        agent: v.agent,
        verdict: v.verdict,
        blocking_issues: v.blocking_issues ?? 0,
      })),
      reviewer_disagreements: phases.implementation?.logic_vs_challenger_disagreement ? 1 : 0,
      plan_drift: {
        verdict: phases.implementation?.plan_conformance,
        drift_files: phases.implementation?.drift_files_count ?? 0,
      },
      acceptance_first_pass: phases.validation?.acceptance_first_pass ?? false,
      grounding_mismatches: phases.planning?.grounding_mismatches ?? 0,
      tests_written: state.tests_written,
      agents_count: state.agents_count ?? 0,
      reviewer_misses_post_merge: 0,
      verdict: input.verdict,
      categories_seen: categoriesSeen,
    };

    await appendJsonl(pipelineJsonl, row);

    return {
      state,
      result: {
        verdict: input.verdict,
        metrics_row: row,
        metrics_file: pipelineJsonl,
      },
    };
  });
}
