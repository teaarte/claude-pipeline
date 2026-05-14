/**
 * The seven plugin contracts every built-in and every future extension
 * implements. The driver core (`mcp/src/driver/core/*`) references these
 * types but NEVER references specific plugin names — that's the grep-gated
 * boundary that makes the framework extensible without core changes.
 */

import type { Phase } from "../../lib/phase-state-machine.js";
import type {
  DriverResponse,
  ContinueTaskInput,
  ClaudeCodeTaskSpec,
} from "./shuttle.js";

export const PLUGIN_API_VERSION = "1.0";

export interface PluginMeta {
  /**
   * Default "1.0". The loader warns on mismatch in v2; becomes a hard fail
   * in v3 once external plugins ship.
   */
  api_version?: string;

  /**
   * Domain this plugin targets. Default behavior: omitted = "code".
   *
   * All built-in plugins today are code-domain. Future bundles (photo,
   * video, research, vfx) will declare their own value here so a bundle-
   * aware loader can filter the plugin set per project. Until that loader
   * exists (Q40 in roadmap), this field is informational only — nothing
   * reads it for control flow.
   *
   * Adding the field now (forward-compatible, optional) lets a second
   * domain be introduced later without touching every existing plugin
   * definition.
   */
  domain?: string;
}

// ----- A driver-side state shape (separate from pipeline-state.json) ----

export interface DriverState {
  schema_version: "1.0";
  driver_state_id: string;
  project_dir: string;
  task: string;
  task_id: string | null;
  /** Flow currently being executed (e.g. "simple" / "medium" / "complex"). */
  flow_name: string;
  /** Index into `flow.steps` for the step to execute next. */
  step_index: number;
  started_at: string;
  /**
   * Spawns the driver has issued and is waiting on. Keyed by agent_run_id.
   * Populated by SpawnProviderPlugin; consumed when the shuttle returns the
   * agent_output (item 6 contract).
   */
  pending_spawns: Record<
    string,
    { agent: string; phase: Phase; started_at: string; model?: ModelName | null }
  >;
  /**
   * Set when the driver returned a "ask-user" shuttle and is waiting on the
   * human's answer. Cleared when the answer arrives.
   */
  pending_user_answer: { gate: string; message: string } | null;
  /**
   * Decisions resolved by `DecisionPlugin`s and cached so re-entry doesn't
   * re-evaluate. Free-form keyed by decision name.
   */
  decisions: Record<string, unknown>;
  /**
   * Set when the FSM terminates. Anything reading `complete=true` should
   * also see `verdict` populated.
   */
  complete: boolean;
  verdict: "accepted" | "rejected" | null;
  /** Free-form per-step scratch (e.g. agent results indexed by run_id). */
  scratch: Record<string, unknown>;
}

// ----- Step ---------------------------------------------------------------

export type StepResult =
  /** Step finished its work; advance to the next step. */
  | { type: "advance" }
  /** Step issued a shuttle response — return it; FSM pauses. */
  | { type: "shuttle"; response: DriverResponse }
  /** Step decided to terminate the FSM. */
  | { type: "halt"; response: DriverResponse };

export interface StepContext {
  registry: PluginRegistry;
  /**
   * Records an agent-spawn request the step has issued. The driver assigns
   * the agent_run_id and returns it. The step then bundles those ids into a
   * shuttle response. `model` (Q19) is the resolved effective model so the
   * open_spawn[] entry can record what was actually invoked — required for
   * cost analysis and v2.7 historical training data.
   */
  beginSpawn(agent: string, phase: Phase, model?: ModelName | null): Promise<string>;
}

export interface StepPlugin extends PluginMeta {
  name: string;
  phase: Phase;
  run(state: DriverState, ctx: StepContext): Promise<StepResult>;
}

// ----- Agent --------------------------------------------------------------

export type AgentOutputSchema = "reviewer" | "validator" | "nonreview";
export type ModelName = "haiku" | "sonnet" | "opus";

export interface AgentPlugin extends PluginMeta {
  name: string;
  /** Absolute or repo-relative path to the agents/*.md prompt template. */
  template_path: string;
  output_schema: AgentOutputSchema;
  default_model: ModelName;
  /**
   * Optional: return false to skip this agent for the current driver state.
   * Example: ui-consistency only applies when UI files were touched.
   */
  applies_to?(state: DriverState): boolean;
}

// ----- Flow ---------------------------------------------------------------

export interface FlowPlugin extends PluginMeta {
  name: string;
  complexity: string; // "simple" | "medium" | "complex" | custom
  steps: string[]; // ordered StepPlugin names
}

// ----- Gate ---------------------------------------------------------------

export interface GatePlugin extends PluginMeta {
  name: string;
  message(state: DriverState): string;
  validate_response(answer: string): {
    ok: boolean;
    decision: "approved" | "rejected" | "changes_requested";
    feedback?: string;
  };
}

// ----- Decision -----------------------------------------------------------

/**
 * Q41: optional context threaded into DecisionPlugin.decide() so an LLM-driven
 * decision can reach the SpawnProvider (for `query()` classification calls)
 * and see the list of agents the current flow plans to fan out to.
 *
 * Existing decisions ignore `ctx` (parameter is optional) — only refs-to-load
 * uses it today. Future decisions that want LLM judgement can opt in.
 */
export interface DecisionContext {
  /** Agent plugin names the active flow plans to invoke. */
  active_agents?: string[];
  /** Registered spawn provider, if any — for `query()` classification. */
  spawn_provider?: SpawnProviderPlugin | null;
}

export interface DecisionPlugin<T = unknown> extends PluginMeta {
  name: string;
  decide(state: DriverState, ctx?: DecisionContext): T | Promise<T>;
}

// ----- Hook ---------------------------------------------------------------

export type HookEvent = "before-step" | "after-step" | "before-agent-spawn" | "after-agent-result";

export interface HookContext {
  registry: PluginRegistry;
  step?: string;
  agent?: string;
  result?: StepResult;
  agent_output?: string;
}

export interface HookPlugin extends PluginMeta {
  name: string;
  event: HookEvent;
  /**
   * Optional filter: if provided, the hook only fires when the step name
   * matches (string equality or RegExp.test).
   */
  step_filter?: string | RegExp;
  run(state: DriverState, ctx: HookContext): Promise<void>;
}

// ----- Spawn provider -----------------------------------------------------

export interface AgentSpawnRequest {
  agent_run_id: string;
  agent: string;
  phase: Phase;
  model: ModelName;
  prompt: string;
  /**
   * Driver-state id, so the spawn provider can build a shuttle response
   * that round-trips back into pipeline_continue_task.
   */
  driver_state_id: string;
  /**
   * The AgentPlugin's `template_path`. Spawn providers SHOULD read this and
   * embed its content into whatever they pass to the underlying harness so
   * the spawned agent sees its full role prompt. Optional because synthetic
   * providers (smoke-orchestrator mock, future stub providers) can spawn
   * without a template on disk.
   */
  template_path?: string;
}

/**
 * Q41: lightweight one-shot classification request issued by DecisionPlugins
 * (today: refs-to-load) to ask the LLM a single yes/no or short-list
 * question without going through the full spawn shuttle. Output is the raw
 * agent response string; the caller parses it.
 *
 * Optional on the SpawnProviderPlugin contract — shuttle-based providers
 * that can't make synchronous out-of-band LLM calls leave it undefined;
 * decisions then fall back to their regex-only behaviour.
 */
export interface SpawnProviderQueryRequest {
  prompt: string;
  model?: ModelName;
  max_tokens?: number;
  output_format?: "json-array" | "string";
}

export interface SpawnProviderPlugin extends PluginMeta {
  name: string;
  spawn(req: AgentSpawnRequest): Promise<StepResult>;
  query?(req: SpawnProviderQueryRequest): Promise<string>;
}

// ----- Registry ------------------------------------------------------------

export interface PluginRegistry {
  steps: Map<string, StepPlugin>;
  agents: Map<string, AgentPlugin>;
  flows: Map<string, FlowPlugin>;
  gates: Map<string, GatePlugin>;
  decisions: Map<string, DecisionPlugin<any>>;
  hooks: HookPlugin[];
  spawn_provider: SpawnProviderPlugin | null;
}

// Re-export shuttle types for convenient single-import.
export type { DriverResponse, ContinueTaskInput, ClaudeCodeTaskSpec };
