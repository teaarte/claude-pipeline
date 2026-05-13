/**
 * Hook invocation. Fires every HookPlugin matching (event, step name) — in
 * registration order. Hooks are best-effort: a thrown hook is logged to
 * stderr and the FSM continues. Hooks must not modify driver state
 * directly; they side-effect to disk (e.g. write past-misses markdown).
 */

import type {
  DriverState,
  HookEvent,
  HookContext,
  PluginRegistry,
} from "../types/plugin.js";

export async function runHooks(
  registry: PluginRegistry,
  event: HookEvent,
  state: DriverState,
  ctx: Omit<HookContext, "registry">,
): Promise<void> {
  for (const hook of registry.hooks) {
    if (hook.event !== event) continue;
    if (hook.step_filter !== undefined && ctx.step !== undefined) {
      if (typeof hook.step_filter === "string") {
        if (hook.step_filter !== ctx.step) continue;
      } else if (hook.step_filter instanceof RegExp) {
        if (!hook.step_filter.test(ctx.step)) continue;
      }
    }
    try {
      await hook.run(state, { registry, ...ctx });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error(`[hook ${hook.name}] failed during ${event}: ${msg}`);
    }
  }
}
