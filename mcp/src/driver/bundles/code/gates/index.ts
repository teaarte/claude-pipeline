import type { DriverState, GatePlugin, UserAnswer, GateDecision } from "../../../types/plugin.js";

function parseDecision(input: UserAnswer): GateDecision {
  return {
    status: input.decision === "accept" ? "approved" : "rejected",
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

const GATE_1: GatePlugin = {
  name: "gate-1",
  message(state) {
    return [
      `Plan ready for ${shortTask(state)}.`,
      `Review .claude/plan.md.`,
      `Reply 1/accept or 2/reject <message>.`,
    ].join("\n");
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
