import { readFile } from "node:fs/promises";
import type { DriverState, GatePlugin, UserAnswer, GateDecision } from "../../../types/plugin.js";
import { findingsFile } from "../../../../lib/paths.js";

function parseDecision(input: UserAnswer): GateDecision {
  // D8 (Q69): "auto-apply" is gate-1's path through the auto-derived
  // feedback — pipeline-state.gates records it as "rejected" so
  // INV_005/INV_006 still fire (the planner needs to re-run on the
  // suggested revision, same as a manual reject).
  const approved = input.decision === "accept";
  return {
    status: approved ? "approved" : "rejected",
    feedback: input.message ?? null,
  };
}

/**
 * Q71 / D10: render a short, scrollable task summary for gate prompts.
 * Real-task observation 2026-05-19: gate-0 and gate-1 message bodies
 * contained the full 10 KB task description verbatim, forcing the human
 * to scroll past their own input to reach the `Reply 1/accept...` prompt.
 *
 * Resolution order (first non-empty wins):
 *   1. state.task_short — populated by the classifier-agent (D1 future).
 *   2. First non-empty line of state.task truncated to 80 chars.
 *   3. "(empty task)" guard so the prompt is never blank.
 *
 * Gate-2 message stays constant (no task echo) so it's untouched.
 */
export function shortTask(state: DriverState): string {
  const short = state.decisions["task_short"];
  if (typeof short === "string" && short.trim().length > 0) {
    return short.trim();
  }
  const firstLine = state.task.split("\n").find((l) => l.trim().length > 0)?.trim();
  if (!firstLine) return "(empty task)";
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 77) + "...";
}

const GATE_0: GatePlugin = {
  name: "gate-0",
  message(state) {
    const complexity = state.decisions["complexity"] ?? "unknown";
    return [
      `Classified as ${String(complexity).toUpperCase()}.`,
      `Task: ${shortTask(state)}`,
      `Reply 1/accept or 2/reject <message>.`,
    ].join("\n");
  },
  validate_response: parseDecision,
};

/**
 * D8 (Q69): aggregate planning-phase reviewer findings into a pre-filled
 * "Suggested revision" block for gate-1. Real-task observation
 * 2026-05-19: user manually transcribed 7 bullets paraphrasing 5 findings
 * — every finding already carries `summary` + `suggested_fix` +
 * `severity`. Auto-deriving the block removes that friction.
 *
 * Sort order: severity desc (blocking → warn → info), then agent name,
 * then finding id (stable tiebreaker). Caps total findings shown so the
 * block fits a 500-char gate message budget per the D10 / Q71 truncation
 * philosophy.
 */
const SEVERITY_RANK: Record<string, number> = { blocking: 0, warn: 1, info: 2 };
const SUGGESTED_REVISION_CAP = 8;
const PLANNING_FINDING_AGENTS = new Set(["logic-reviewer", "plan-grounding-check"]);
const GATE_1_SUGGESTED_REVISION_KEY = "__gate_1_suggested_revision";

function compareFindings(a: any, b: any): number {
  const sa = SEVERITY_RANK[a.severity] ?? 3;
  const sb = SEVERITY_RANK[b.severity] ?? 3;
  if (sa !== sb) return sa - sb;
  const ag = String(a.agent ?? "").localeCompare(String(b.agent ?? ""));
  if (ag !== 0) return ag;
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

async function loadPlanningFindings(state: DriverState): Promise<any[]> {
  const file = findingsFile(state.project_dir);
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const all: any[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      all.push(JSON.parse(line));
    } catch {
      // ignore malformed line — best effort.
    }
  }
  return all;
}

export function pickLatestPlanningFindings(findings: any[]): any[] {
  const planning = findings.filter(
    (f) =>
      f &&
      typeof f.agent === "string" &&
      PLANNING_FINDING_AGENTS.has(f.agent) &&
      f.status !== "fixed" &&
      f.status !== "dismissed" &&
      f.status !== "accepted_by_human",
  );
  if (planning.length === 0) return [];
  const maxIter = planning.reduce((m, f) => {
    const it = typeof f.iteration === "number" ? f.iteration : 1;
    return it > m ? it : m;
  }, 0);
  return planning
    .filter((f) => (typeof f.iteration === "number" ? f.iteration : 1) === maxIter)
    .sort(compareFindings);
}

export function renderSuggestedRevision(findings: any[]): string {
  const top = findings.slice(0, SUGGESTED_REVISION_CAP);
  if (top.length === 0) return "";
  const lines: string[] = ["", "## Suggested revision (auto-derived from reviewer findings)"];
  for (const f of top) {
    const sev = (f.severity ?? "info").toUpperCase();
    const cat = f.category ?? "uncategorized";
    const summary = String(f.summary ?? "(no summary)").trim();
    const fix = typeof f.suggested_fix === "string" && f.suggested_fix.trim().length > 0
      ? ` Suggested fix: ${f.suggested_fix.trim()}`
      : "";
    lines.push(`- (${sev}, ${cat}) ${summary}.${fix}`);
  }
  if (findings.length > SUGGESTED_REVISION_CAP) {
    lines.push(`- ... (${findings.length - SUGGESTED_REVISION_CAP} more findings)`);
  }
  return lines.join("\n");
}

const GATE_1: GatePlugin = {
  name: "gate-1",
  async message(state) {
    const findings = await loadPlanningFindings(state);
    const latest = pickLatestPlanningFindings(findings);
    const revision = renderSuggestedRevision(latest);
    // D8: stash the revision block on driver-state.scratch so D9 (auto-replan
    // loop) can pick it up as synthetic reject feedback without re-deriving.
    if (revision.length > 0) {
      state.scratch[GATE_1_SUGGESTED_REVISION_KEY] = revision;
    }
    const lines = [
      `Plan ready for ${shortTask(state)}.`,
      `Review .claude/plan.md.`,
      revision.length > 0
        ? `Reply 1/a/auto-apply (use suggested revision below), 2/accept-anyway, 3/edit <text>, or 4/reject <msg>.`
        : `Reply 1/accept or 2/reject <message>.`,
    ];
    if (revision.length > 0) lines.push(revision);
    return lines.join("\n");
  },
  validate_response: parseDecision,
};

const GATE_2: GatePlugin = {
  name: "gate-2",
  message(_state) {
    return [
      `Implementation complete.`,
      `Reviewers and validators have run.`,
      `Reply 1/accept (verdict=accepted) or 2/reject <message> (verdict=rejected).`,
    ].join("\n");
  },
  validate_response: parseDecision,
};

export const BUILTIN_GATES: GatePlugin[] = [GATE_0, GATE_1, GATE_2];
