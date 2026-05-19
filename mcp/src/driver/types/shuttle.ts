/**
 * Shuttle protocol — the structured message format between the driver and
 * its harness (Claude Code, future daemon HTTP API, Cursor MCP integration,
 * etc.). The driver emits one DriverResponse per pause point; the harness
 * hands the result back via ContinueTaskInput.
 *
 * D4 / Q65: the spawn shape is runner-agnostic. `SpawnRequest.runner_hint`
 * tells the harness HOW to invoke (which native primitive maps to this
 * spawn); CC-specific fields like `subagent_type` live under `extras`. A
 * non-CC harness (Cursor adapter, daemon SDK, future Codex/Gemini CLI
 * adapter) translates the same SpawnRequest to its own native shape via a
 * different runner_hint branch in the skill markdown / adapter.
 */

export type SpawnRequest = {
  /**
   * Identifies the harness primitive that should execute this spawn. The
   * pipeline core never branches on this — the consuming harness (skill
   * markdown, daemon adapter, Cursor MCP integration) reads it to pick the
   * right translation. v2.x ships "claude-code-task"; v2.3.4's
   * AnthropicSdkSpawnProvider will return "anthropic-sdk"; future Cursor /
   * Codex adapters declare their own.
   */
  runner_hint: "claude-code-task" | "anthropic-sdk" | "openai-sdk" | "ollama" | string;
  description: string;
  prompt: string;
  /**
   * Provider-specific model identifier. Tier abstraction (haiku/sonnet/opus
   * vs. provider-native ids) is the v2.5 routing layer's concern; pipeline
   * core stays neutral.
   */
  model?: string;
  /**
   * Runner-specific extras pass through opaquely. CC-specific
   * `subagent_type` (the Task-tool field) lives here when
   * runner_hint === "claude-code-task". Other adapters define their own
   * extras shape.
   */
  extras?: Record<string, unknown>;
};

export type DriverResponse =
  | {
      status: "spawn-agent";
      driver_state_id: string;
      agent_run_id: string;
      agent: string;
      spawn_request: SpawnRequest;
    }
  | {
      status: "spawn-agents-parallel";
      driver_state_id: string;
      spawns: { agent_run_id: string; agent: string; spawn_request: SpawnRequest }[];
    }
  | {
      status: "ask-user";
      driver_state_id: string;
      gate: string;
      message: string;
    }
  | {
      status: "complete";
      task_id: string | null;
      verdict: "accepted" | "rejected";
      summary: string;
    }
  | {
      status: "error";
      driver_state_id: string;
      code: string;
      message: string;
      recovery_options: { choice: string; label: string }[];
    };

export type ContinueTaskInput =
  | { driver_state_id: string; type: "agent-result"; agent_run_id: string; agent_output: string }
  | { driver_state_id: string; type: "agents-results"; results: { agent_run_id: string; agent_output: string }[] }
  | {
      driver_state_id: string;
      type: "user-answer";
      decision: "accept" | "reject";
      /**
       * Q74 (D13): meaningful only at gate-2 when decision === "reject".
       * "revise" (default for `2`/reject keyword) → walk FSM back to the
       * implementation phase entry and re-run reviewers. "abandon" → finalize
       * with verdict="rejected". Ignored at gate-0/gate-1 (those reject paths
       * stay simple). Skill parser keeps `2`/`reject` → reject_intent="revise"
       * for backward consistency.
       */
      reject_intent?: "revise" | "abandon";
      message?: string;
    }
  | { driver_state_id: string; type: "recovery"; choice: "abandon" | "force-close" | "retry" };
