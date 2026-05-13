/**
 * ClaudePipelineConfig — v2's config type, v2.5's Web UI edit target.
 *
 * Resolution order applied by builtin/agents/resolveAgentModel:
 *   effective_model = config.agent_overrides[name]?.model
 *                  ?? config.default_models_by_phase[plugin.phase]
 *                  ?? plugin.default_model
 *
 * Other fields:
 *  - gate_policy: how user-gates behave when no human is available.
 *  - notification_targets: where to post events (Slack, email, webhook).
 *  - plugin_enabled: feature-flag style toggles per plugin name.
 *
 * Config is loaded by loaders/project-config.ts (stub returns a default in v2).
 */

import type { Phase } from "../../lib/phase-state-machine.js";
import type { ModelName } from "./plugin.js";

export type GatePolicy = "interactive" | "auto-approve" | "escalate-on-blocker";

export type NotificationTarget = {
  kind: "slack" | "email" | "webhook";
  target: string;
  on_events: ("gate" | "blocker" | "complete" | "error")[];
};

export interface AgentOverride {
  provider?: string;
  model?: ModelName;
  max_tokens?: number;
  timeout_ms?: number;
}

export interface ClaudePipelineConfig {
  schema_version: "1.0";
  default_models_by_phase: Partial<Record<Phase, ModelName>>;
  agent_overrides: Record<string, AgentOverride>;
  gate_policy: GatePolicy;
  notification_targets: NotificationTarget[];
  plugin_enabled: Record<string, boolean>;
}

export const defaultConfig: ClaudePipelineConfig = {
  schema_version: "1.0",
  default_models_by_phase: {
    context: "sonnet",
    planning: "opus",
    test_first: "sonnet",
    implementation: "opus",
    validation: "haiku",
  },
  agent_overrides: {},
  gate_policy: "interactive",
  notification_targets: [],
  plugin_enabled: {},
};
