/**
 * The ONE place where built-in plugins are bound to the registry. No other
 * file in core/ touches the registry directly — extensibility hinges on
 * this being the single seam.
 */

import type { PluginRegistry } from "../types/plugin.js";
import { complexityDecision } from "../builtin/decisions/complexity.js";
import { testsModeDecision } from "../builtin/decisions/tests-mode.js";
import { refsToLoadDecision } from "../builtin/decisions/refs-to-load.js";
import { securityNeededDecision } from "../builtin/decisions/security-needed.js";
import { uiTouchedDecision } from "../builtin/decisions/ui-touched.js";
import { apiTouchedDecision } from "../builtin/decisions/api-touched.js";
import { BUILTIN_AGENTS } from "../builtin/agents/index.js";
import { BUILTIN_STEPS } from "../builtin/steps/index.js";
import { BUILTIN_GATES } from "../builtin/gates/index.js";
import { BUILTIN_HOOKS } from "../builtin/hooks/index.js";
import { BUILTIN_FLOWS } from "../builtin/flows/index.js";
import { shuttleSpawnProvider } from "../builtin/spawn/shuttle-provider.js";

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
