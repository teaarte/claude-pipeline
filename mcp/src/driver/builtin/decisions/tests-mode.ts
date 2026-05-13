import type { DecisionPlugin, DriverState } from "../../types/plugin.js";

export const testsModeDecision: DecisionPlugin<"tdd" | "regression-only"> = {
  name: "tests_mode",
  decide(state: DriverState): "tdd" | "regression-only" {
    const cached = state.decisions["tests_mode"];
    if (cached === "tdd" || cached === "regression-only") return cached;
    const v = (state.scratch?.tests_mode as string) ?? "regression-only";
    return v === "tdd" ? "tdd" : "regression-only";
  },
};
