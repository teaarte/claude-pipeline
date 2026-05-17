import type { GatePlugin } from "../../../types/plugin.js";

function parseDecision(answer: string): { ok: boolean; decision: "approved" | "rejected" | "changes_requested"; feedback?: string } {
  const trimmed = answer.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return { ok: false, decision: "rejected" };
  if (/^(yes|y|approve|approved|ok|lgtm|ship it)/.test(lower)) {
    return { ok: true, decision: "approved", feedback: trimmed };
  }
  if (/^(no|n|reject|rejected)/.test(lower)) {
    return { ok: true, decision: "rejected", feedback: trimmed };
  }
  if (/^(changes?|revise|update|fix)/.test(lower)) {
    return { ok: true, decision: "changes_requested", feedback: trimmed };
  }
  // Default to changes_requested for any free-form feedback.
  return { ok: true, decision: "changes_requested", feedback: trimmed };
}

const GATE_0: GatePlugin = {
  name: "gate-0",
  message(state) {
    const complexity = state.decisions["complexity"] ?? "unknown";
    return [
      `Classified as ${String(complexity).toUpperCase()}.`,
      `Task: ${state.task}`,
      `Does this classification look right? Approve, reject, or describe a change.`,
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
      `Approve, reject, or request changes.`,
    ].join("\n");
  },
  validate_response: parseDecision,
};

const GATE_2: GatePlugin = {
  name: "gate-2",
  message(state) {
    return [
      `Implementation complete.`,
      `Reviewers and validators have run.`,
      `Accept (verdict=accepted) or reject (verdict=rejected) with feedback.`,
    ].join("\n");
  },
  validate_response: parseDecision,
};

export const BUILTIN_GATES: GatePlugin[] = [GATE_0, GATE_1, GATE_2];
