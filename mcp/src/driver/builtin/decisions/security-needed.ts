import type { DecisionPlugin, DriverState } from "../../types/plugin.js";

export const securityNeededDecision: DecisionPlugin<boolean> = {
  name: "security_needed",
  decide(state: DriverState): boolean {
    const cached = state.decisions["security_needed"];
    if (typeof cached === "boolean") return cached;
    const task = state.task.toLowerCase();
    const diff = (state.scratch?.diff_text as string | undefined) ?? "";
    return (
      /auth|login|permission|secret|password|jwt|csrf|oauth|session/.test(task) ||
      /auth|jwt|cookie|csrf/.test(diff)
    );
  },
};
