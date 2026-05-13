/**
 * Shuttle SpawnProviderPlugin — the only spawn provider v2 ships. Returns a
 * `spawn-agent` DriverResponse pointing at Claude Code's `Task` tool; the
 * shuttle markdown (`commands/task.md`) routes the result back via
 * pipeline_continue_task.
 *
 * Future providers (e.g. direct Anthropic SDK) implement the same
 * `SpawnProviderPlugin` contract; swapping them in is a registry-level
 * change with no impact on core/.
 */

import type {
  AgentSpawnRequest,
  SpawnProviderPlugin,
  StepResult,
} from "../../types/plugin.js";
import { spawnAgent } from "../../core/shuttle.js";

export const shuttleSpawnProvider: SpawnProviderPlugin = {
  name: "shuttle",
  async spawn(req: AgentSpawnRequest): Promise<StepResult> {
    return {
      type: "shuttle",
      response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
        subagent_type: req.agent,
        description: `Spawn ${req.agent}`,
        prompt: req.prompt,
        model: req.model,
      }),
    };
  },
};
