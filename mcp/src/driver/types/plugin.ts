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
    { agent: string; phase: Phase; started_at: string }
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
   * shuttle response.
   */
  beginSpawn(agent: string, phase: Phase): Promise<string>;
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

export interface DecisionPlugin<T = unknown> extends PluginMeta {
  name: string;
  decide(state: DriverState): T | Promise<T>;
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
}

export interface SpawnProviderPlugin extends PluginMeta {
  name: string;
  spawn(req: AgentSpawnRequest): Promise<StepResult>;
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
