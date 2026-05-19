/**
 * Shuttle protocol — the structured message format between the driver and
 * Claude Code (or any other harness). The driver emits one DriverResponse
 * per pause point; the shuttle hands the result back via ContinueTaskInput.
 */

export type ClaudeCodeTaskSpec = {
  subagent_type: string;
  description: string;
  prompt: string;
  model?: "haiku" | "sonnet" | "opus";
};

export type DriverResponse =
  | {
      status: "spawn-agent";
      driver_state_id: string;
      agent_run_id: string;
      agent: string;
      claude_code_task: ClaudeCodeTaskSpec;
    }
  | {
      status: "spawn-agents-parallel";
      driver_state_id: string;
      spawns: { agent_run_id: string; agent: string; claude_code_task: ClaudeCodeTaskSpec }[];
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
