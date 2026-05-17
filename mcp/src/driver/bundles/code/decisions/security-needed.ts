/**
 * security-needed (Item 9 of v2.2.5): pure getter.
 *
 * The classifier-agent (spawned in the context phase) writes its judgment
 * to `state.decisions.security_needed`. This decision plugin reads that
 * field. No regex on task text or diff. Default `false` when the
 * classifier didn't run or returned malformed output.
 */

import type { DecisionPlugin, DriverState } from "../../../types/plugin.js";

export const securityNeededDecision: DecisionPlugin<boolean> = {
  name: "security_needed",
  decide(state: DriverState): boolean {
    const cached = state.decisions["security_needed"];
    return typeof cached === "boolean" ? cached : false;
  },
};
