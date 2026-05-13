import type { DecisionPlugin, DriverState } from "../../types/plugin.js";

/**
 * Compute the senior-pattern references to load for this task. v2 emits a
 * conservative fixed list; the full trigger matrix from `commands/task.md`
 * rule #30 is encoded here in a future iteration. The function is pure +
 * idempotent so the FSM can cache it.
 */
export const refsToLoadDecision: DecisionPlugin<string[]> = {
  name: "refs_to_load",
  decide(state: DriverState): string[] {
    const cached = state.decisions["refs_to_load"];
    if (Array.isArray(cached) && cached.every((c) => typeof c === "string")) {
      return cached as string[];
    }
    const refs: string[] = [];
    const task = state.task.toLowerCase();
    const complexity = (state.decisions["complexity"] as string) ?? (state.scratch?.complexity as string) ?? "medium";

    // Tier 1 — applies most broadly.
    if (complexity === "complex" || /architecture|service|design|refactor|migrate|split/.test(task)) {
      refs.push("agents/references/arch-patterns.md");
    }
    if (/cache|cdn|invalidat|stale|ttl/.test(task)) refs.push("agents/references/caching.md");
    if (/query|index|migration|schema|sql/.test(task)) refs.push("agents/references/db-postgres.md");
    if (/cache|queue|rate.?limit|session.?store|lock|redis/.test(task)) refs.push("agents/references/redis.md");

    // Tier 2.
    if (/api|endpoint|rest|graphql|contract/.test(task)) refs.push("agents/references/api-design.md");
    if (/race|concurrent|parallel|lock|queue|retry|atomicity/.test(task)) refs.push("agents/references/concurrency.md");
    if (/log|metric|trace|telemetry|alert|slo/.test(task)) refs.push("agents/references/observability.md");

    // Tier 3 — heavy hitters.
    if (/auth|login|permission|secret|password|jwt|csrf|oauth/.test(task)) {
      refs.push("agents/references/security-backend.md");
    }
    if (/perf|optimize|latency|throughput|slow|bottleneck/.test(task)) {
      refs.push("agents/references/optimization-strategy.md");
    }

    // Anti-bloat cap (rule #30): max 5 per task.
    return refs.slice(0, 5);
  },
};
