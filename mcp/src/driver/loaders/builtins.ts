/**
 * Backward-compat wrapper. The bundle-aware loader (`loaders/bundles.ts`)
 * is the canonical seam; this file exists so existing call sites can
 * continue to use `loadBuiltinPlugins(registry)` synchronously.
 *
 * Q40 closed in v2.2.5: bundles are first-class; this thin wrapper exists
 * only to avoid a sweeping rename across the driver/tools call sites.
 *
 * Synchronous wrapper around the async `loadBundle("code", registry)`.
 * Implemented by eagerly importing the code-bundle assets at module load
 * time — same behavior as before. New code should prefer the async
 * `loadBundle(name, registry)` API directly.
 */

import type { PluginRegistry } from "../types/plugin.js";
import { complexityDecision } from "../bundles/code/decisions/complexity.js";
import { testsModeDecision } from "../bundles/code/decisions/tests-mode.js";
import { refsToLoadDecision } from "../bundles/code/decisions/refs-to-load.js";
import { securityNeededDecision } from "../bundles/code/decisions/security-needed.js";
import { uiTouchedDecision } from "../bundles/code/decisions/ui-touched.js";
import { apiTouchedDecision } from "../bundles/code/decisions/api-touched.js";
import { BUILTIN_AGENTS } from "../bundles/code/agents/index.js";
import { BUILTIN_STEPS } from "../bundles/code/steps/index.js";
import { BUILTIN_GATES } from "../bundles/code/gates/index.js";
import { BUILTIN_HOOKS } from "../bundles/code/hooks/index.js";
import { BUILTIN_FLOWS } from "../bundles/code/flows/index.js";
import { shuttleSpawnProvider } from "../bundles/code/spawn/shuttle-provider.js";

export function loadBuiltinPlugins(registry: PluginRegistry): void {
  for (const a of BUILTIN_AGENTS) registry.agents.set(a.name, a);
  for (const s of BUILTIN_STEPS) registry.steps.set(s.name, s);
  for (const g of BUILTIN_GATES) registry.gates.set(g.name, g);
  for (const f of BUILTIN_FLOWS) registry.flows.set(f.name, f);
  for (const h of BUILTIN_HOOKS) registry.hooks.push(h);
  registry.decisions.set("complexity", complexityDecision);
  registry.decisions.set("tests_mode", testsModeDecision);
  registry.decisions.set("refs_to_load", refsToLoadDecision);
  registry.decisions.set("security_needed", securityNeededDecision);
  registry.decisions.set("ui_touched", uiTouchedDecision);
  registry.decisions.set("api_touched", apiTouchedDecision);
  registry.spawn_provider = shuttleSpawnProvider;
}
