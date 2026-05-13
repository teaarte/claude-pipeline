import type { DecisionPlugin, DriverState } from "../../types/plugin.js";

export const uiTouchedDecision: DecisionPlugin<boolean> = {
  name: "ui_touched",
  decide(state: DriverState): boolean {
    const cached = state.decisions["ui_touched"];
    if (typeof cached === "boolean") return cached;
    const diff = (state.scratch?.diff_text as string | undefined) ?? "";
    return /\.(tsx|jsx|vue|svelte|css|scss|html)\b/.test(diff);
  },
};
