import type { DecisionPlugin, DriverState } from "../../types/plugin.js";

export const apiTouchedDecision: DecisionPlugin<boolean> = {
  name: "api_touched",
  decide(state: DriverState): boolean {
    const cached = state.decisions["api_touched"];
    if (typeof cached === "boolean") return cached;
    const diff = (state.scratch?.diff_text as string | undefined) ?? "";
    return /(app|pages)\/api\//.test(diff) || /\b(route\.ts|server\.ts)\b/.test(diff) || /openapi|swagger/.test(diff);
  },
};
