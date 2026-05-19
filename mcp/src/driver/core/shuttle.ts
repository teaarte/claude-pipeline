/**
 * Shuttle response constructors. Pure functions, no IO.
 */

import type {
  DriverResponse,
  SpawnRequest,
} from "../types/shuttle.js";

export function spawnAgent(
  driver_state_id: string,
  agent_run_id: string,
  agent: string,
  spawn_request: SpawnRequest,
): DriverResponse {
  return {
    status: "spawn-agent",
    driver_state_id,
    agent_run_id,
    agent,
    spawn_request,
  };
}

/**
 * Constructor for the parallel-spawn shuttle response. The impl REVIEW
 * step (Q9) and the planning REVIEW step (Q67 / D6) both use it; D4
 * carries SpawnRequest (runner-agnostic) inside each entry.
 */
export function spawnAgentsParallel(
  driver_state_id: string,
  spawns: { agent_run_id: string; agent: string; spawn_request: SpawnRequest }[],
): DriverResponse {
  return {
    status: "spawn-agents-parallel",
    driver_state_id,
    spawns,
  };
}

export function askUser(driver_state_id: string, gate: string, message: string): DriverResponse {
  return { status: "ask-user", driver_state_id, gate, message };
}

export function complete(
  task_id: string | null,
  verdict: "accepted" | "rejected",
  summary: string,
): DriverResponse {
  return { status: "complete", task_id, verdict, summary };
}

export function error(
  driver_state_id: string,
  code: string,
  message: string,
  recovery_options: { choice: string; label: string }[] = [
    { choice: "retry", label: "Retry the failed step" },
    { choice: "force-close", label: "Force-close the task (records pipeline_violation)" },
    { choice: "abandon", label: "Abandon the task (no metrics row)" },
  ],
): DriverResponse {
  return { status: "error", driver_state_id, code, message, recovery_options };
}
