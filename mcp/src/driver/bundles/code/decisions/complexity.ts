import type { DecisionPlugin, DriverState } from "../../../types/plugin.js";

/**
 * Returns the complexity classification driving flow selection. v2 reads the
 * value the user supplied via `pipeline_init` (recorded in pipeline-state).
 * Future overrides can swap this plugin out without touching the FSM.
 */
export const complexityDecision: DecisionPlugin<"simple" | "medium" | "complex"> = {
  name: "complexity",
  decide(state: DriverState): "simple" | "medium" | "complex" {
    const cached = state.decisions["complexity"];
    if (cached === "simple" || cached === "medium" || cached === "complex") {
      return cached;
    }
    // First call: trust scratch — populated by step `classify` from
    // pipeline-state.json. Default `medium` if unknown (safer default).
    const fromState = (state.scratch?.complexity as string) ?? "medium";
    if (fromState !== "simple" && fromState !== "medium" && fromState !== "complex") {
      return "medium";
    }
    return fromState;
  },
};
