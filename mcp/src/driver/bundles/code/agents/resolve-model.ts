/**
 * Resolve the effective model for an AgentPlugin given a runtime config.
 * Resolution cascade (item 8 user-nudge):
 *
 *   effective_model = config.agent_overrides[name]?.model
 *                  ?? config.default_models_by_phase[plugin.phase]
 *                  ?? plugin.default_model
 *
 * No call site in `spawn/` or `steps/` should hardcode `plugin.default_model`;
 * always route through this helper so the v2.5 Web UI can edit
 * `agent_overrides` and `default_models_by_phase` to take effect immediately.
 */

import type { AgentPlugin, ModelName, StepPlugin } from "../../../types/plugin.js";
import type { ClaudePipelineConfig } from "../../../types/config.js";

export function resolveAgentModel(
  plugin: AgentPlugin,
  phase: StepPlugin["phase"],
  config: ClaudePipelineConfig,
): ModelName {
  const override = config.agent_overrides[plugin.name]?.model;
  if (override) return override;
  const byPhase = config.default_models_by_phase[phase];
  if (byPhase) return byPhase;
  return plugin.default_model;
}
