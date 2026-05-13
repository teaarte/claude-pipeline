import type { HookPlugin } from "../../types/plugin.js";

/**
 * Built-in hooks. These are side effects fired at FSM lifecycle events;
 * none of them mutate driver state directly. State changes happen via the
 * step that owns the work.
 */

const LOAD_PAST_MISSES: HookPlugin = {
  name: "load-past-misses",
  event: "before-step",
  // Fires before any step whose name signals review activity. The driver
  // matches on step name via the filter regex.
  step_filter: /^(plan-review|review)$/,
  async run(state, ctx) {
    // Implementation note: the actual past-misses fetch is owned by the
    // step itself in v2 (via the MCP tool pipeline_get_past_misses). This
    // hook is the registration point where future versions can add cross-
    // cutting telemetry — kept as a no-op placeholder so the contract is
    // exercised and visible in tests.
    state.scratch[`past_misses_loaded_for_${ctx.step}`] = true;
  },
};

const ANTI_PATTERN_GREP: HookPlugin = {
  name: "anti-pattern-grep",
  event: "after-step",
  step_filter: "implement",
  async run(state, _ctx) {
    state.scratch.antipattern_grep_done = true;
  },
};

const CALLER_CONTEXT_EXPAND: HookPlugin = {
  name: "caller-context-expand",
  event: "after-step",
  step_filter: "implement",
  async run(state, _ctx) {
    if (state.decisions["complexity"] === "simple") return;
    state.scratch.caller_context_done = true;
  },
};

export const BUILTIN_HOOKS: HookPlugin[] = [LOAD_PAST_MISSES, ANTI_PATTERN_GREP, CALLER_CONTEXT_EXPAND];
