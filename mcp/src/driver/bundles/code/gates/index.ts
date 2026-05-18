import type { GatePlugin, UserAnswer, GateDecision } from "../../../types/plugin.js";

function parseDecision(input: UserAnswer): GateDecision {
  return {
    status: input.decision === "accept" ? "approved" : "rejected",
    feedback: input.message ?? null,
  };
}

const GATE_0: GatePlugin = {
  name: "gate-0",
  message(state) {
    const complexity = state.decisions["complexity"] ?? "unknown";
    return [
      `Classified as ${String(complexity).toUpperCase()}.`,
      `Task: ${state.task}`,
      `Reply 1/accept or 2/reject <message>.`,
    ].join("\n");
  },
  validate_response: parseDecision,
};

const GATE_1: GatePlugin = {
  name: "gate-1",
  message(state) {
    return [
      `Plan ready for ${state.task}.`,
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
