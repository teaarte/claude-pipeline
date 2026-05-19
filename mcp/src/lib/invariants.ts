import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { readJsonl } from "./state-io.js";
import { validate, validatePipelineState } from "./schemas.js";

export type Violation = {
  code: string;
  message: string;
  detail?: any;
};

const REQUIRED_PHASES = ["context", "planning", "implementation", "validation", "final"] as const;

export const DEFAULT_STALE_SPAWN_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function readStaleSpawnTimeout(): Promise<number> {
  // Read ~/.claude/settings.json once per invariant pass. Best-effort; fall
  // back to the default if anything goes wrong.
  try {
    const raw = await readFile(join(homedir(), ".claude", "settings.json"), "utf8");
    const cfg = JSON.parse(raw);
    const t = cfg?.pipeline?.stale_spawn_timeout_ms;
    if (typeof t === "number" && t > 0) return t;
  } catch {
    /* default */
  }
  return DEFAULT_STALE_SPAWN_TIMEOUT_MS;
}

export async function runInvariants(state: any, findingsFile: string): Promise<Violation[]> {
  const violations: Violation[] = [];

  // INV-pipeline-state-schema: state must validate against base schema AND
  // the bundle-specific extension (e.g. code bundle requires tests_mode +
  // stack). Old `1.0` state files without `bundle` default to code via the
  // extension's conditional `if` clause.
  const stateCheck = await validatePipelineState(state);
  if (!stateCheck.ok) {
    violations.push({
      code: "INV_SCHEMA_STATE",
      message: "pipeline-state.json failed schema validation",
      detail: stateCheck.errors,
    });
  }

  const complexity = state.complexity;
  const phases = state.phases ?? {};
  const agentsCount = state.agents_count ?? 0;

  // INV_001: medium/complex + any phase.completed → agents_count > 0
  if (complexity === "medium" || complexity === "complex") {
    const anyCompleted = Object.values(phases).some((p: any) => p?.status === "completed");
    if (anyCompleted && agentsCount === 0) {
      violations.push({
        code: "INV_001",
        message: `complexity=${complexity} with completed phases but agents_count=0 — no agents were spawned`,
      });
    }
  }

  // INV_002: phases[p].status==completed → phases[p].agents.length>0 OR p=="context"
  // INV_003: phases[p].status==skipped → skipped_reason != null
  for (const [name, p] of Object.entries<any>(phases)) {
    if (!p) continue;
    if (p.status === "completed") {
      const agents: string[] = p.agents ?? [];
      if (agents.length === 0 && name !== "context" && name !== "final") {
        violations.push({
          code: "INV_002",
          message: `phase '${name}' is completed but has no agents recorded`,
        });
      }
    }
    // INV_003: test_first must carry a skipped_reason when status=skipped.
    // Other phases tolerate missing reason (context: optional in schema;
    // final: doesn't carry the field). M6 collapsed the nested conditionals
    // that made the outer scope misleading.
    if (
      name === "test_first" &&
      p.status === "skipped" &&
      !p.skipped_reason
    ) {
      violations.push({
        code: "INV_003",
        message: `phase '${name}' is skipped without skipped_reason`,
      });
    }
  }

  // INV_004: reviewer_verdicts.length ≤ agents_count
  const verdicts: any[] = state.reviewer_verdicts ?? [];
  if (verdicts.length > agentsCount) {
    violations.push({
      code: "INV_004",
      message: `reviewer_verdicts (${verdicts.length}) exceeds agents_count (${agentsCount})`,
    });
  }

  // INV_005: gate1=approved → planning.status ∈ {completed, skipped}
  const gates = state.gates ?? {};
  if (gates.gate1 === "approved") {
    const planningStatus = phases.planning?.status;
    if (planningStatus !== "completed" && planningStatus !== "skipped") {
      violations.push({
        code: "INV_005",
        message: `gate1=approved but planning.status='${planningStatus}'`,
      });
    }
  }

  // INV_006: gate2=approved → implementation.completed && validation.completed
  if (gates.gate2 === "approved") {
    const implStatus = phases.implementation?.status;
    const valStatus = phases.validation?.status;
    if (implStatus !== "completed") {
      violations.push({
        code: "INV_006",
        message: `gate2=approved but implementation.status='${implStatus}'`,
      });
    }
    if (valStatus !== "completed") {
      violations.push({
        code: "INV_006",
        message: `gate2=approved but validation.status='${valStatus}'`,
      });
    }
  }

  // INV_007: verdict != null → all REQUIRED_PHASES ∈ {completed, skipped}
  if (state.verdict) {
    for (const name of REQUIRED_PHASES) {
      const s = phases[name]?.status;
      if (s !== "completed" && s !== "skipped") {
        violations.push({
          code: "INV_007",
          message: `verdict='${state.verdict}' but phase '${name}'.status='${s}'`,
        });
      }
    }
  }

  // INV_008: every line in findings.jsonl validates against finding.schema.json
  const findings = await readJsonl(findingsFile);
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const r = await validate("finding.schema.json", f);
    if (!r.ok) {
      violations.push({
        code: "INV_008",
        message: `findings.jsonl line ${i + 1} failed schema validation`,
        detail: r.errors,
      });
    }
  }

  // INV_012: open_spawns[] must be empty in any closed phase (completed
  // OR skipped). A skipped phase with open spawns is the same leak shape
  // (Logic L3) — historically only `completed` was checked.
  // Plus stale-spawn detection across in-progress phases.
  const staleTimeoutMs = await readStaleSpawnTimeout();
  const now = Date.now();
  for (const [name, p] of Object.entries<any>(phases)) {
    if (!p) continue;
    const open: any[] = Array.isArray(p.open_spawns) ? p.open_spawns : [];
    if ((p.status === "completed" || p.status === "skipped") && open.length > 0) {
      violations.push({
        code: "INV_012",
        message: `phase '${name}' is ${p.status} but has ${open.length} open spawn(s)`,
        detail: open.map((s) => ({ id: s.id, agent: s.agent })),
      });
    }
    for (const s of open) {
      const startedAt = Date.parse(s.started_at);
      if (Number.isFinite(startedAt) && now - startedAt > staleTimeoutMs) {
        violations.push({
          code: "stale-spawn",
          message: `spawn '${s.id}' (agent='${s.agent}', phase='${name}') has been open for ${Math.floor((now - startedAt) / 60000)} min, exceeding the stale-spawn threshold`,
          detail: { id: s.id, agent: s.agent, phase: name, started_at: s.started_at, age_ms: now - startedAt },
        });
      }
    }
  }

  // INV_009: test files modified by implementer must be empty unless human approved
  const modified: string[] = phases.implementation?.test_files_modified_by_implementer ?? [];
  if (modified.length > 0) {
    const gate2 = gates.gate2;
    const gate2fb: string = gates.gate2_feedback ?? "";
    const approved = gate2 === "approved" && /approve.*test/i.test(gate2fb);
    if (!approved) {
      violations.push({
        code: "INV_009",
        message: `${modified.length} test file(s) modified by implementer without human approval at gate2`,
        detail: modified,
      });
    }
  }

  // INV_013 (Q68 / D7): acceptance verdict=PASS ⇒ no open severity:blocking
  // findings emitted by impl-phase reviewers at the latest impl iteration.
  // Real-task observation 2026-05-19: style-reviewer at iter=2 emitted 3
  // prettier blockers, acceptance returned PASS because `pnpm test/lint`
  // ran against project scope where the same files were excluded. Without
  // this gate, the task would have shipped with blockers still open.
  const inv013 = checkAcceptancePassWithoutImplBlockers(state);
  if (inv013) violations.push(inv013);

  return violations;
}

/**
 * Q68 / D7: returns an INV_013 violation when acceptance.verdict=PASS (or
 * PASS_WITH_WARNINGS) coexists with non-zero blocking_issues from any
 * impl-phase reviewer at the latest impl iteration. Returns null when the
 * data is consistent or when acceptance hasn't run yet. Pure function over
 * `state.reviewer_verdicts[]` — no IO. Shared between pipeline_finish's
 * runInvariants pass and pipeline_record_agent_run post-record check so
 * the violation is caught at both boundaries.
 */
export function checkAcceptancePassWithoutImplBlockers(state: any): Violation | null {
  const verdicts: any[] = Array.isArray(state?.reviewer_verdicts)
    ? state.reviewer_verdicts
    : [];
  const acceptance = verdicts.find(
    (v) => v?.agent === "acceptance" && v?.phase === "validation",
  );
  if (!acceptance) return null;
  if (acceptance.verdict !== "PASS" && acceptance.verdict !== "PASS_WITH_WARNINGS") {
    return null;
  }
  const implEntries = verdicts.filter(
    (v) => v?.phase === "implementation" && v?.agent !== "acceptance",
  );
  if (implEntries.length === 0) return null;
  const latestImplIter = implEntries.reduce((max, v) => {
    const it = typeof v?.iteration === "number" ? v.iteration : 1;
    return it > max ? it : max;
  }, 0);
  const latestEntries = implEntries.filter((v) => {
    const it = typeof v?.iteration === "number" ? v.iteration : 1;
    return it === latestImplIter;
  });
  const offenders = latestEntries.filter(
    (v) => typeof v?.blocking_issues === "number" && v.blocking_issues > 0,
  );
  if (offenders.length === 0) return null;
  const sum = offenders.reduce((a, v) => a + (v.blocking_issues as number), 0);
  return {
    code: "INV_013",
    message: `acceptance.verdict='${acceptance.verdict}' but ${sum} open blocking finding(s) from impl-phase reviewers at iteration=${latestImplIter}`,
    detail: offenders.map((v) => ({
      agent: v.agent,
      iteration: v.iteration,
      blocking_issues: v.blocking_issues,
      categories_seen: v.categories_seen,
    })),
  };
}
