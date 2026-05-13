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
  | { driver_state_id: string; type: "user-answer"; answer: string }
  | { driver_state_id: string; type: "recovery"; choice: "abandon" | "force-close" | "retry" };
