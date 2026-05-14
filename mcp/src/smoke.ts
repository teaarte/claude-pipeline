#!/usr/bin/env node
/**
 * End-to-end smoke test exercising the tool functions directly
 * (no MCP transport). Validates the full happy path + a violation path.
 */
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pipelineInit } from "./tools/init.js";
import { pipelineStateGet } from "./tools/state-get.js";
import { pipelineBeginAgent } from "./tools/begin-agent.js";
import { pipelineRecordAgentRun } from "./tools/record-agent-run.js";
import { pipelineRecordNonreviewAgent } from "./tools/record-nonreview-agent.js";
import { pipelineSetPhaseStatus } from "./tools/set-phase-status.js";
import { pipelineSetGate } from "./tools/set-gate.js";
import { pipelineValidate } from "./tools/validate.js";
import { pipelineFinish } from "./tools/finish.js";
import { pipelineLogAgentFeedback } from "./tools/log-agent-feedback.js";
import { pipelineGetPastMisses } from "./tools/get-past-misses.js";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const section = (msg: string) => console.log(`\n=== ${msg} ===`);

async function expectThrow(fn: () => Promise<any>, contains: string, label: string) {
  try {
    await fn();
    fail(`${label}: expected throw containing "${contains}"`);
  } catch (e: any) {
    if (String(e.message ?? e).includes(contains)) ok(`${label} (threw as expected)`);
    else fail(`${label}: threw "${e.message}", expected to contain "${contains}"`);
  }
}

async function spawnNonreview(project: string, phase: any, agent: any, extras: { output_file?: string } = {}) {
  const { agent_run_id } = await pipelineBeginAgent({ project_dir: project, phase, agent });
  return pipelineRecordNonreviewAgent({ project_dir: project, phase, agent, agent_run_id, ...extras });
}

async function spawnReviewer(project: string, phase: any, agent: string, agent_output: string) {
  const { agent_run_id } = await pipelineBeginAgent({ project_dir: project, phase, agent });
  return pipelineRecordAgentRun({ project_dir: project, phase, agent_run_id, agent_output });
}

async function main() {
  const project = await mkdtemp(join(tmpdir(), "pipeline-mcp-smoke-"));
  console.log(`Smoke project_dir = ${project}`);

  try {
    section("init");
    const init = await pipelineInit({
      project_dir: project,
      task: "Smoke test task",
      task_id: "t-2026-05-13-smoke",
      complexity: "medium",
      tests_mode: "regression-only",
      stack: {
        language: "TypeScript",
        package_manager: "pnpm",
        test_command: "pnpm test",
        lint_command: "pnpm lint",
        build_command: "pnpm build",
        project_type: "frontend-app",
      },
    });
    ok(`task_id=${init.task_id}, state_file=${init.state_file}`);

    section("state_get");
    const got = await pipelineStateGet({ project_dir: project });
    if (!got.exists || got.state.task_id !== "t-2026-05-13-smoke") fail("state_get");
    else ok("state_get returns initialized state");

    section("INV_011: refuses begin_agent when prereq not satisfied");
    await expectThrow(
      () =>
        pipelineBeginAgent({
          project_dir: project,
          phase: "implementation",
          agent: "implementer",
        }),
      "INV_011",
      "begin_agent implementer before test_first done",
    );

    section("complete context (no-agent exemption)");
    await pipelineSetPhaseStatus({ project_dir: project, phase: "context", status: "completed" });
    ok("context completed");

    section("INV_002: refuses to complete phase with no agents");
    await expectThrow(
      () => pipelineSetPhaseStatus({ project_dir: project, phase: "planning", status: "completed" }),
      "INV_002",
      "set_phase_status planning=completed (no agents)",
    );

    section("begin + record planner");
    await spawnNonreview(project, "planning", "planner", { output_file: ".claude/plan.md" });
    ok("recorded planner");

    section("INV_012: cannot complete planning with an open spawn");
    // Begin a second planner without recording, then attempt to complete planning.
    const { agent_run_id: hangingPlanner } = await pipelineBeginAgent({
      project_dir: project,
      phase: "planning",
      agent: "planner",
    });
    await expectThrow(
      () => pipelineSetPhaseStatus({ project_dir: project, phase: "planning", status: "completed" }),
      "INV_012",
      "set_phase_status planning=completed with 1 open_spawn",
    );
    // Resolve by recording.
    await pipelineRecordNonreviewAgent({
      project_dir: project,
      phase: "planning",
      agent: "planner",
      agent_run_id: hangingPlanner,
    });
    ok(`resolved leaked spawn ${hangingPlanner}`);

    section("walk through phases in legal order");
    await pipelineSetPhaseStatus({ project_dir: project, phase: "planning", status: "completed" });
    await pipelineSetPhaseStatus({
      project_dir: project,
      phase: "test_first",
      status: "skipped",
      skipped_reason: "regression-only",
    });
    await spawnNonreview(project, "implementation", "implementer");
    ok("recorded implementer (implementation in_progress)");

    section("record reviewer agent");
    const reviewerOutput = `\`\`\`json
{
  "schema_version": "1.0",
  "agent": "logic-reviewer",
  "task_id": "t-2026-05-13-smoke",
  "iteration": 1,
  "verdict": "REQUEST_CHANGES",
  "summary_line": "one blocking race condition in retry handler",
  "findings": [
    {
      "schema_version": "1.0",
      "id": "f-2026-05-13-abc123",
      "agent": "logic-reviewer",
      "task_id": "t-2026-05-13-smoke",
      "iteration": 1,
      "file": "src/foo.ts",
      "line_start": 42,
      "line_end": 50,
      "severity": "blocking",
      "category": "race-condition",
      "summary": "concurrent retry can double-invoke handler",
      "evidence_excerpt": "await retry(handler)",
      "suggested_fix": "wrap in mutex",
      "status": "open"
    }
  ],
  "past_misses_applied": 0,
  "past_miss_matches": [],
  "ref_rules_consulted": []
}
\`\`\`

# Logic Review — Iteration 1
`;
    const rec = await spawnReviewer(project, "implementation", "logic-reviewer", reviewerOutput);
    if (rec.findings_written !== 1) fail(`expected 1 finding, got ${rec.findings_written}`);
    else ok(`recorded logic-reviewer with 1 blocking finding`);

    section("findings.jsonl populated");
    const findingsRaw = await readFile(join(project, ".claude", "findings.jsonl"), "utf8");
    if (findingsRaw.includes("race-condition") && findingsRaw.split("\n").filter(Boolean).length === 1) {
      ok("findings.jsonl has 1 valid line");
    } else {
      fail("findings.jsonl content unexpected");
    }

    section("INV_012: record with mismatched agent_run_id is rejected");
    await expectThrow(
      () =>
        pipelineRecordAgentRun({
          project_dir: project,
          phase: "implementation",
          agent_run_id: "ar-00000000-0000-0000-0000-000000000000",
          agent_output: reviewerOutput,
        }),
      "INV_012",
      "record_agent_run with unknown agent_run_id",
    );

    section("complete implementation");
    await pipelineSetPhaseStatus({
      project_dir: project,
      phase: "implementation",
      status: "completed",
    });
    ok("implementation completed");

    section("INV_010: refuses to re-open completed phase");
    await expectThrow(
      () => pipelineSetPhaseStatus({ project_dir: project, phase: "implementation", status: "in_progress" }),
      "INV_010",
      "set_phase_status implementation: completed → in_progress",
    );

    section("record acceptance validator");
    const acceptanceOutput = `\`\`\`json
{
  "schema_version": "1.0",
  "agent": "acceptance",
  "task_id": "t-2026-05-13-smoke",
  "iteration": 1,
  "verdict": "PASS",
  "summary_line": "all AC pass, lint+typecheck green",
  "findings": [],
  "details": { "lint": "pass", "typecheck": "pass" }
}
\`\`\`

# Acceptance Report
`;
    await spawnReviewer(project, "validation", "acceptance", acceptanceOutput);
    ok("recorded acceptance");

    await pipelineSetPhaseStatus({
      project_dir: project,
      phase: "validation",
      status: "completed",
    });
    await pipelineSetPhaseStatus({
      project_dir: project,
      phase: "final",
      status: "completed",
    });

    section("gates");
    await pipelineSetGate({ project_dir: project, gate: "gate0", status: "approved" });
    await pipelineSetGate({ project_dir: project, gate: "gate1", status: "approved", feedback: null });
    await pipelineSetGate({ project_dir: project, gate: "gate2", status: "approved", feedback: "looks good" });
    ok("gates 0/1/2 approved");

    section("validate (should pass)");
    const v = await pipelineValidate({ project_dir: project });
    if (!v.ok) fail(`validate failed:\n${v.violations.map((x: any) => `[${x.code}] ${x.message}`).join("\n")}`);
    else ok("all invariants pass");

    section("finish");
    const fin = await pipelineFinish({
      project_dir: project,
      verdict: "accepted",
      project_short: "smoke-test",
      task_short: "smoke-test",
    });
    if (fin.metrics_row.task_id === "t-2026-05-13-smoke" && fin.metrics_row.agents_count >= 3) {
      ok(`finish wrote metrics row (agents_count=${fin.metrics_row.agents_count})`);
    } else {
      fail("finish metrics row malformed");
    }

    section("agent_feedback log + get");
    const fb = await pipelineLogAgentFeedback({
      agent: "logic-reviewer",
      category: "race-condition",
      pattern_to_look_for: "await retry without mutex",
      severity: "high",
      found_by: "human-review",
      human_confirmed: true,
      missed_issue_summary: "smoke",
    });
    if (!fb.written) fail("agent_feedback write");
    else ok("agent_feedback written");

    const past = await pipelineGetPastMisses({ agent: "logic-reviewer", top_n: 5 });
    if (past.count >= 1) ok(`get_past_misses returned ${past.count} entries`);
    else fail("get_past_misses returned 0");

    section("DONE");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Smoke failed:", err);
  process.exit(1);
});
