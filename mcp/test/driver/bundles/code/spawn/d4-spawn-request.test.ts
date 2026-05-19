/**
 * D4 / Q65 regression: shuttle response shape is runner-agnostic.
 *  - SpawnRequest carries runner_hint + extras (CC-specific subagent_type
 *    lives under extras).
 *  - Pipeline core's type definition no longer mentions "claude_code_task".
 *  - shuttleSpawnProvider returns runner_hint="claude-code-task" + extras.
 *    subagent_type="general-purpose".
 *  - Future Cursor / daemon SDK / Codex adapters return a different
 *    runner_hint with their own extras shape — pipeline core stays neutral.
 */

import { describe, it, expect } from "vitest";
import { shuttleSpawnProvider } from "../../../../../src/driver/bundles/code/spawn/shuttle-provider.js";
import { spawnAgent, spawnAgentsParallel } from "../../../../../src/driver/core/shuttle.js";
import type { AgentSpawnRequest } from "../../../../../src/driver/types/plugin.js";

function makeReq(overrides: Partial<AgentSpawnRequest> = {}): AgentSpawnRequest {
  return {
    agent: overrides.agent ?? "code-analyzer",
    agent_run_id: overrides.agent_run_id ?? "a-2026-05-19-d4tests",
    driver_state_id: overrides.driver_state_id ?? "d-2026-05-19-d4tests",
    phase: overrides.phase ?? "context",
    model: overrides.model ?? "sonnet",
    prompt: overrides.prompt ?? "D4 probe",
    template_path: overrides.template_path,
    team_knowledge: overrides.team_knowledge,
    task_id: overrides.task_id,
  };
}

describe("D4 / Q65 — SpawnRequest is runner-agnostic", () => {
  it("shuttleSpawnProvider emits runner_hint='claude-code-task' + subagent_type under extras", async () => {
    const r = await shuttleSpawnProvider.spawn(makeReq({ agent: "planner" }));
    expect(r.type).toBe("shuttle");
    if (r.type !== "shuttle" || r.response.status !== "spawn-agent") {
      throw new Error("expected spawn-agent shuttle");
    }
    const sr = r.response.spawn_request;
    expect(sr.runner_hint).toBe("claude-code-task");
    expect(sr.description.length).toBeGreaterThan(0);
    expect(sr.prompt.length).toBeGreaterThan(0);
    expect((sr.extras as any)?.subagent_type).toBe("general-purpose");
  });

  it("spawnAgent constructor returns the SpawnRequest verbatim under spawn_request key", () => {
    const r = spawnAgent("d-x", "a-x", "logic-reviewer", {
      runner_hint: "anthropic-sdk",
      description: "alt-runner probe",
      prompt: "x",
      model: "claude-sonnet-4-5-20251029",
      extras: { thinking: true },
    });
    if (r.status !== "spawn-agent") throw new Error("expected spawn-agent");
    expect(r.spawn_request.runner_hint).toBe("anthropic-sdk");
    expect(r.spawn_request.model).toBe("claude-sonnet-4-5-20251029");
    expect((r.spawn_request.extras as any)?.thinking).toBe(true);
  });

  it("spawnAgentsParallel constructor accepts a list of {agent_run_id, agent, spawn_request}", () => {
    const r = spawnAgentsParallel("d-y", [
      {
        agent_run_id: "a-1",
        agent: "logic-reviewer",
        spawn_request: {
          runner_hint: "claude-code-task",
          description: "L",
          prompt: "L",
          extras: { subagent_type: "general-purpose" },
        },
      },
      {
        agent_run_id: "a-2",
        agent: "style-reviewer",
        spawn_request: {
          runner_hint: "claude-code-task",
          description: "S",
          prompt: "S",
          extras: { subagent_type: "general-purpose" },
        },
      },
    ]);
    if (r.status !== "spawn-agents-parallel") {
      throw new Error("expected spawn-agents-parallel");
    }
    expect(r.spawns.length).toBe(2);
    expect(r.spawns[0].spawn_request.runner_hint).toBe("claude-code-task");
    expect(r.spawns[1].agent).toBe("style-reviewer");
  });
});
