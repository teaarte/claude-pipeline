import { z } from "zod";
import { stateFile, findingsFile, summaryFile } from "../lib/paths.js";
import {
  withStateLock,
  appendJsonl,
  writeText,
} from "../lib/state-io.js";
import { extractJsonHeader } from "../lib/parse-json-header.js";
import { makeFindingId, AGENT_RUN_ID_PATTERN } from "../lib/ids.js";
import { validate, isCategoryAllowed } from "../lib/schemas.js";
import { audit } from "../lib/audit.js";
import { buildSummary } from "../lib/summary.js";
import { CODE_PHASES, assertPrereqSatisfied, type Phase } from "../lib/phase-state-machine.js";
import { coerceIntegerOpt } from "../lib/coerce.js";
import { consumeOpenSpawn } from "./begin-agent.js";

const REVIEWER_AGENTS = new Set([
  "logic-reviewer",
  "challenger-reviewer",
  "style-reviewer",
  "security",
  "performance",
]);

const VALIDATOR_AGENTS = new Set([
  "acceptance",
  "plan-conformance",
  "plan-grounding-check",
  "context-doc-verifier",
  "ui-consistency",
  "api-contract",
  "playwright",
  "test",
]);

export const recordAgentRunSchema = {
  project_dir: z.string(),
  phase: z.enum(CODE_PHASES).describe("Which pipeline phase this agent belongs to"),
  agent_run_id: z
    .string()
    .regex(AGENT_RUN_ID_PATTERN)
    .describe("Run id returned by pipeline_begin_agent. Required — must match an entry in phase.open_spawns[]."),
  agent_output: z.string().describe("Full text output of the agent, including the fenced ```json header"),
};

export async function pipelineRecordAgentRun(input: {
  project_dir: string;
  phase: Phase;
  agent_run_id: string;
  agent_output: string;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const fjsonl = findingsFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  // 1. extract + parse JSON header (3-stage soft parse — item 6)
  const parsed = extractJsonHeader(input.agent_output);
  if (!parsed.ok) {
    throw new Error(`Failed to parse JSON header: ${parsed.reason}`);
  }
  const header = parsed.value;
  const repaired = parsed.repaired;
  if (repaired) {
    // Q11: surface lenient-parse repairs as their own audit class so the
    // post-hoc analyser can separate "agent emitted a malformed fence but
    // the body was salvageable" (retry-recovered) from genuine failures.
    await audit({
      tool: "pipeline_record_agent_run",
      args: { phase: input.phase, agent_run_id: input.agent_run_id },
      projectDir: input.project_dir,
      verdict: "ok",
      error_class: "retry-recovered",
    }).catch(() => undefined);
  }
  const agent = header.agent;
  if (!agent || typeof agent !== "string") {
    throw new Error("JSON header missing 'agent' field");
  }
  // Item 7: coerce stringified integers in the header. Approximations throw.
  if (header.iteration !== undefined) {
    header.iteration = coerceIntegerOpt(header.iteration, "header.iteration");
  }
  if (header.past_misses_applied !== undefined) {
    header.past_misses_applied = coerceIntegerOpt(header.past_misses_applied, "header.past_misses_applied");
  }
  for (const f of (Array.isArray(header.findings) ? header.findings : []) as any[]) {
    if (f && f.iteration !== undefined) {
      f.iteration = coerceIntegerOpt(f.iteration, "finding.iteration");
    }
  }

  // 2. validate against reviewer or validator schema
  let schemaId: string;
  if (REVIEWER_AGENTS.has(agent)) {
    schemaId = "reviewer-output.schema.json";
  } else if (VALIDATOR_AGENTS.has(agent)) {
    schemaId = "validator-output.schema.json";
  } else {
    throw new Error(
      `Unknown agent class for '${agent}'. Must be reviewer or validator. For Planner/Implementer/etc. use pipeline_record_nonreview_agent.`,
    );
  }
  const schemaCheck = await validate(schemaId, header);
  if (!schemaCheck.ok) {
    throw new Error(
      `Agent header failed ${schemaId} validation:\n${schemaCheck.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`,
    );
  }

  // 3. per-finding validation + append to findings.jsonl
  const findings: any[] = Array.isArray(header.findings) ? header.findings : [];
  const writtenFindings: any[] = [];
  for (const raw of findings) {
    const f = { ...raw };
    if (!f.id) f.id = makeFindingId();
    if (!f.schema_version) f.schema_version = "1.0";
    if (!f.agent) f.agent = agent;
    if (!f.task_id && header.task_id) f.task_id = header.task_id;
    if (f.iteration == null && header.iteration != null) f.iteration = header.iteration;

    const fcheck = await validate("finding.schema.json", f);
    if (!fcheck.ok) {
      throw new Error(
        `Finding failed schema validation:\n${fcheck.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}\nFinding: ${JSON.stringify(f)}`,
      );
    }
    if (!(await isCategoryAllowed(agent, f.category))) {
      throw new Error(
        `Finding category '${f.category}' is not in vocab for agent '${agent}'. Use 'other' + proposed_new_category if no entry fits.`,
      );
    }
    writtenFindings.push(f);
  }

  // 4. lock state, mutate, persist
  return withStateLock(file, async (state) => {
    if (!state) {
      throw new Error(
        `pipeline-state.json not found at ${file}. Call pipeline_init first.`,
      );
    }

    // v2.2.6 (C6 / Item 6): canonical task_id defensive rewrite.
    // Reviewer / validator agents must emit findings under the canonical
    // task_id from spawn-context's "Canonical identifiers" section. When
    // an agent picks a semantic id from the task description prose
    // instead (e.g. `phase-0.7-step-1` vs canonical
    // `t-2026-05-18-implementphase07step`), every analytics query keyed
    // on the canonical id misses the finding. Rewrite + audit so the
    // record lands at the right key; the audit lets us measure the
    // mismatch rate over time (risk register: >10% should surface a
    // metric for investigation).
    const canonicalTaskId =
      typeof state.task_id === "string" && state.task_id.length > 0
        ? (state.task_id as string)
        : null;
    if (canonicalTaskId) {
      const rewrites: Array<{ where: string; from: unknown }> = [];
      if (header.task_id && header.task_id !== canonicalTaskId) {
        rewrites.push({ where: "header", from: header.task_id });
        header.task_id = canonicalTaskId;
      }
      for (const f of writtenFindings) {
        if (f.task_id && f.task_id !== canonicalTaskId) {
          rewrites.push({ where: `finding:${f.id}`, from: f.task_id });
          f.task_id = canonicalTaskId;
        }
      }
      if (rewrites.length > 0) {
        await audit({
          tool: "pipeline_record_agent_run",
          args: {
            phase: input.phase,
            agent,
            agent_run_id: input.agent_run_id,
            canonical_task_id: canonicalTaskId,
            rewrites,
          },
          projectDir: input.project_dir,
          verdict: "ok",
          error_class: "task_id-rewrite",
        }).catch(() => undefined);
      }
    }

    // ensure phase exists
    if (!state.phases?.[input.phase]) {
      throw new Error(`Unknown phase '${input.phase}' in pipeline-state.json`);
    }
    const phase = state.phases[input.phase];
    // INV_011: refuse to record an agent into a phase whose prereq isn't
    // completed/skipped. Catches out-of-order recording (e.g. spawning the
    // Implementer before planning is done).
    if (phase.status === "pending") {
      assertPrereqSatisfied(state, input.phase as Phase, "in_progress");
    }
    // INV_012: agent_run_id MUST match an open_spawn begun for this agent.
    consumeOpenSpawn(phase, input.agent_run_id, agent);

    phase.agents = Array.isArray(phase.agents) ? phase.agents : [];
    phase.agents.push(agent);
    if (phase.status === "pending") phase.status = "in_progress";

    // reviewer_verdicts: append entry
    state.reviewer_verdicts = Array.isArray(state.reviewer_verdicts) ? state.reviewer_verdicts : [];
    const blocking = writtenFindings.filter((f) => f.severity === "blocking").length;
    const nonBlocking = writtenFindings.filter((f) => f.severity !== "blocking").length;
    state.reviewer_verdicts.push({
      agent,
      phase: input.phase,
      iteration: header.iteration ?? 1,
      verdict: header.verdict,
      blocking_issues: blocking,
      non_blocking: nonBlocking,
      past_misses_applied: header.past_misses_applied ?? 0,
      past_miss_matches: Array.isArray(header.past_miss_matches) ? header.past_miss_matches.length : 0,
      categories_seen: writtenFindings.map((f) => f.category).filter((v, i, a) => a.indexOf(v) === i),
    });

    state.agents_count = (state.agents_count ?? 0) + 1;
    state.blockers_found = (state.blockers_found ?? 0) + blocking;

    // v2.2.6 C7 / Q63: auto-close `validation` when the acceptance reviewer
    // returns a clean PASS and no other spawns are still in flight. Without
    // this, every successful run had `validation` stuck in `in_progress`
    // → /done tripped INV_007 → user force-set `final` → metric row carried
    // `pipeline_violation: "phase-force-final"` permanently. The Q54
    // genuine-recovery force path stays intact (it goes through
    // pipeline_set_phase_status with force=true, not this auto-close).
    //
    // Strict guard: only the exact string "PASS" triggers auto-close. A
    // malformed verdict that string-equals "pass" or "PASSED" does NOT
    // close validation — risk-register guard against masked failures.
    if (
      input.phase === "validation" &&
      agent === "acceptance" &&
      header.verdict === "PASS" &&
      phase.status === "in_progress" &&
      (!Array.isArray(phase.open_spawns) || phase.open_spawns.length === 0)
    ) {
      phase.status = "completed";
      await audit({
        tool: "pipeline_record_agent_run",
        args: { phase: "validation", agent, agent_run_id: input.agent_run_id },
        projectDir: input.project_dir,
        verdict: "ok",
        error_class: "auto-close-validation",
      }).catch(() => undefined);
    }

    // append findings AFTER state mutation prepared but BEFORE write — we want jsonl write to be best-effort
    // (state lock ensures sequential access; if findings append fails we still propagate by throwing)
    for (const f of writtenFindings) {
      await appendJsonl(fjsonl, f);
    }

    await writeText(summary, await buildSummary(state));

    return {
      state,
      result: {
        agent,
        verdict: header.verdict,
        findings_written: writtenFindings.length,
        blocking,
        non_blocking: nonBlocking,
        summary_line: header.summary_line ?? "",
        ...(repaired ? { _repaired: true } : {}),
      },
    };
  });
}
