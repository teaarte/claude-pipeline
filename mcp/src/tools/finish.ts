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

    // Q22: compute iter counts from reviewer_verdicts when phase is known
    // (Q20 enables this — pre-Q20 verdicts without `phase` fall back to the
    // older phases.<x>.iterations counter). impl_iters = max iteration of a
    // reviewer in implementation; plan_iters = same for planning.
    const maxIterInPhase = (phase: string): number => {
      let max = 0;
      for (const v of verdicts) {
        if (v.phase === phase && typeof v.iteration === "number" && v.iteration > max) {
          max = v.iteration;
        }
      }
      return max;
    };
    const implIters = maxIterInPhase("implementation") || phases.implementation?.iterations || 0;
    const planIters = maxIterInPhase("planning") || phases.planning?.iterations || 0;
    // acceptance_first_pass = iteration-1 acceptance verdict has verdict=PASS.
    // Q32: the legacy phases.validation.acceptance_first_pass field was
    // deprecated in v2.2-clear-bundle; reviewer_verdicts[] is the only source
    // of truth. Absent iter-1 acceptance verdict ⇒ false (the task never
    // passed acceptance on the first try).
    const acceptanceFirst = verdicts.find(
      (v) => v.agent === "acceptance" && (v.phase === undefined || v.phase === "validation") && v.iteration === 1,
    );
    const acceptanceFirstPass = acceptanceFirst ? acceptanceFirst.verdict === "PASS" : false;

    const row = {
      schema_version: "1.0",
      date,
      task_id: state.task_id,
      project: input.project_short ?? "",
      task_short: input.task_short ?? short,
      complexity: state.complexity,
      tests_mode: state.tests_mode ?? null,
      stack: state.stack ?? null,
      plan_iters: planIters,
      gate1_revisions: phases.planning?.gate1_revisions ?? 0,
      impl_iters: implIters,
      blockers_found: state.blockers_found ?? 0,
      reviewers_with_blockers: reviewersWithBlockers,
      reviewer_verdicts: verdicts.map((v) => ({
        agent: v.agent,
        phase: v.phase,
        verdict: v.verdict,
        blocking_issues: v.blocking_issues ?? 0,
      })),
      reviewer_disagreements: phases.implementation?.logic_vs_challenger_disagreement ? 1 : 0,
      plan_drift: {
        verdict: phases.implementation?.plan_conformance,
        drift_files: phases.implementation?.drift_files_count ?? 0,
      },
      acceptance_first_pass: acceptanceFirstPass,
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
