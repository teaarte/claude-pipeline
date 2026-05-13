import { z } from "zod";
import { stateFile, findingsFile, summaryFile } from "../lib/paths.js";
import {
  withStateLock,
  appendJsonl,
  writeText,
} from "../lib/state-io.js";
import { extractJsonHeader, makeFindingId } from "../lib/parse-json-header.js";
import { validate, isCategoryAllowed } from "../lib/schemas.js";
import { buildSummary } from "../lib/summary.js";
import { assertPrereqSatisfied, type Phase } from "../lib/phase-state-machine.js";
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

const VALID_PHASES = ["context", "planning", "test_first", "implementation", "validation", "final"] as const;

export const recordAgentRunSchema = {
  project_dir: z.string(),
  phase: z.enum(VALID_PHASES).describe("Which pipeline phase this agent belongs to"),
  agent_run_id: z
    .string()
    .regex(/^ar-[0-9a-f-]+$/)
    .describe("Run id returned by pipeline_begin_agent. Required — must match an entry in phase.open_spawns[]."),
  agent_output: z.string().describe("Full text output of the agent, including the fenced ```json header"),
};

export async function pipelineRecordAgentRun(input: {
  project_dir: string;
  phase: (typeof VALID_PHASES)[number];
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
  const agent = header.agent;
  if (!agent || typeof agent !== "string") {
    throw new Error("JSON header missing 'agent' field");
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
