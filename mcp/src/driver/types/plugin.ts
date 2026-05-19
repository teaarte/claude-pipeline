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
  SpawnRequest,
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
  /**
   * D2 (Q-change-kind-selectivity): change_kind values for which this agent
   * is relevant. When omitted → relevant for ALL change_kinds (conservative
   * default; matches today's "spawn everything" behavior). When set, the
   * REVIEW step skips this agent if state.decisions.change_kind is set AND
   * is NOT in the array. When change_kind is null/undefined (classifier
   * didn't run or didn't classify), all relevant_for_change_kinds-gated
   * agents still spawn — selectivity is opt-in optimization, never a
   * silent skip.
   *
   * Domain: same enum as classifier-output.schema.json change_kind:
   * "type-only" | "logic" | "ui" | "perf-sensitive" | "security-sensitive"
   * | "config-only" | "docs-only".
   *
   * Skipped reviewers emit an audit row `reviewer-skipped` (error_class:
   * "reviewer-skipped-change-kind") for visibility.
   */
  relevant_for_change_kinds?: string[];
  /**
   * Optional whitelist of external MCP tool names this agent is allowed to
   * call. Each tool must be a member of some active MCPClientPlugin's
   * `expose_tools`. v2.3 wires this through the agent prompt; v2.2.5 just
   * carries the slot.
   */
  mcp_tools?: string[];
}

// ----- Flow ---------------------------------------------------------------

export interface FlowPlugin extends PluginMeta {
  name: string;
  complexity: string; // "simple" | "medium" | "complex" | custom
  /**
   * Ordered phase names this flow declares. Code-bundle flows use the
   * canonical CODE_PHASES; future bundles can declare custom orderings.
   * The driver core treats this opaquely — it is the authoritative
   * ordering for the active flow (FSM-runtime, pipeline_validate).
   */
  phases: string[];
  steps: string[]; // ordered StepPlugin names
}

// ----- Gate ---------------------------------------------------------------

/**
 * Structured user answer to a gate's ask-user prompt (Item 8 of v2.2.5).
 * Replaces the previous free-text `answer: string` shape — gate decisions
 * are binary (accept | reject) with an optional human-readable message
 * carried through to feedback. No multilingual keyword classification at
 * gates; the harness emits this shape directly.
 */
export interface UserAnswer {
  /**
   * D8 (Q69): "auto-apply" is gate-1 specific. The harness emits it when
   * the user types `1` / `a` / `auto-apply` at gate-1, telling the
   * pipeline to treat the auto-derived "Suggested revision" block as a
   * gate-1 reject message (replan with that feedback). Gate-0 / gate-2
   * never emit "auto-apply" — gate-2 stays accept/reject with
   * reject_intent disambiguation (Q74).
   */
  decision: "accept" | "reject" | "auto-apply";
  /**
   * Q74 (D13): gate-2 reject disambiguation. "revise" routes back to impl
   * entry + re-runs reviewers; "abandon" finalizes with verdict="rejected".
   * Default at gate-2 reject is "revise". Gate-0 + gate-1 ignore this field.
   */
  reject_intent?: "revise" | "abandon";
  message?: string;
}

export interface GateDecision {
  status: "approved" | "rejected";
  feedback: string | null;
}

export interface GatePlugin extends PluginMeta {
  name: string;
  /**
   * D8 (Q69): gate messages may be async — gate-1 reads findings.jsonl to
   * build the auto-derived "Suggested revision" block. Pure-text gates
   * (gate-0, gate-2) keep returning a synchronous string.
   */
  message(state: DriverState): string | Promise<string>;
  validate_response(input: UserAnswer): GateDecision;
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
   * Canonical task_id (v2.2.6 Item 6 / C6). Spawn providers SHOULD inject
   * this as part of a "Canonical identifiers" section in the agent prompt
   * so agents copy the canonical id into their output JSON instead of
   * extracting a semantic id from the task description prose. The defensive
   * runtime check in record_agent_run rewrites mismatches to canonical and
   * audits as `task_id-rewrite`, but a correct prompt is preferred over
   * silent rewriting.
   */
  task_id?: string;
  /**
   * The AgentPlugin's `template_path`. Spawn providers SHOULD read this and
   * embed its content into whatever they pass to the underlying harness so
   * the spawned agent sees its full role prompt. Optional because synthetic
   * providers (smoke-orchestrator mock, future stub providers) can spawn
   * without a template on disk.
   */
  template_path?: string;
  /**
   * Pre-resolved team-knowledge content (Item 7 of v2.2.5). Concatenated
   * markdown from the project's `team_knowledge_refs[]` plus the bundle's
   * baseline knowledge dir. Empty string when no refs configured. Spawn
   * providers SHOULD inject this as its own section in the agent prompt.
   */
  team_knowledge?: string;
}

/**
 * Q41: lightweight one-shot classification request issued by DecisionPlugins
 * (today: refs-to-load) to ask the LLM a single yes/no or short-list
 * question without going through the full spawn shuttle. Output is the raw
 * agent response string; the caller parses it.
 *
 * Optional on the SpawnProviderPlugin contract — shuttle-based providers
 * that can't make synchronous out-of-band LLM calls leave it undefined;
 * decisions then return empty/default values (item 9 removed the regex
 * fallback). The classifier-agent populates `state.decisions` upstream;
 * decision plugins are pure getters until the v2.3 daemon ships a real
 * query path.
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

// ----- MCPClientPlugin (Item 6) -------------------------------------------

/**
 * Declaration of an external MCP server the pipeline should spawn and
 * connect to as an MCP CLIENT. The pipeline itself is an MCP server; this
 * contract lets a project plug in additional MCP servers (memory, search,
 * github, etc.) and route their tools through to agents.
 *
 * Declared in `<project>/.claude/pipeline.config.json` under `mcp_clients[]`.
 * Item 6 of v2.2.5 ships the contract + spawn-lifecycle manager + a mocked
 * test demonstrating spawn → handshake → tool exposure. Live integration
 * (claude-mem, etc.) is config-level addition after merge — no further code
 * change required.
 */
export interface MCPClientPlugin extends PluginMeta {
  /** Stable identifier; surfaces in audit + tool-routing. */
  name: string;
  /** argv to spawn (`["npx", "claude-mem", "mcp-server"]`, etc.). */
  server_command: string[];
  /** Optional env overrides for the spawned process. */
  env?: Record<string, string>;
  /**
   * Which of the external server's tools to make available to agents.
   * Tools advertised by the server but not in this list stay hidden.
   */
  expose_tools: string[];
  /**
   * Lifecycle scope:
   *  - "task": spawn at task start, kill at pipeline_finish
   *  - "team": keep alive across tasks (requires daemon mode; v2.3+)
   *  - "global": keep alive across all projects (daemon-managed; v2.3+)
   */
  scope: "task" | "team" | "global";
  /**
   * Optional handshake health check. If the named tool isn't advertised
   * within `timeout_ms`, the manager records the failure in audit and
   * SKIPS this client — pipeline continues without it (graceful degrade).
   */
  health_check?: { tool: string; timeout_ms: number };
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
export type { DriverResponse, ContinueTaskInput, SpawnRequest };
