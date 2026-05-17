/**
 * refs-to-load (Item 9 of v2.2.5): pure getter.
 *
 * The classifier-agent (spawned in the context phase) writes its picks to
 * `state.decisions.refs_to_load`. This decision plugin reads that field
 * and returns it as-is. No regex on task text. No fallback heuristics. If
 * the classifier didn't run or failed, the cached value is undefined and
 * we return an empty array — downstream agents proceed without refs.
 */

import type { DecisionPlugin, DriverState } from "../../../types/plugin.js";

export const refsToLoadDecision: DecisionPlugin<string[]> = {
  name: "refs_to_load",
  decide(state: DriverState): string[] {
    const cached = state.decisions["refs_to_load"];
    if (Array.isArray(cached)) {
      return cached.filter((c): c is string => typeof c === "string");
    }
    return [];
  },
};
