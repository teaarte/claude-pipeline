/**
 * The ONE place where built-in plugins are bound to the registry. No other
 * file in core/ touches the registry directly — extensibility hinges on
 * this being the single seam.
 *
 * Bundle-awareness (future direction, Q40):
 *
 * Every plugin currently registered here targets the CODE domain. The
 * `PluginMeta.domain` field (optional, defaults to "code") exists on the
 * type but isn't read for control flow yet.
 *
 * When a second domain becomes a concrete need (photo / video / research /
 * vfx — see specs/product-vision.md "Domain Boundary" section), this
 * loader should grow:
 *   1. Accept a `bundle: string` parameter (default "code")
 *   2. Filter plugins by `plugin.meta.domain === bundle`
 *   3. Project's bundle choice comes from `<project>/.claude/pipeline.config.json`
 *   4. The `builtin/` directory reorganizes into `builtin/<domain>/` subdirs
 *
 * Until then this stays flat. Premature generalization would lock in an
 * abstraction we haven't validated against a real second domain. See Q40
 * in specs/v3-productization-roadmap.md for the trigger condition.
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
