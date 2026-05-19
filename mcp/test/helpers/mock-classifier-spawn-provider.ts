/**
 * D1 / Q-classifier-auto-spawn test helper. The classifier-agent now
 * auto-spawns in the context phase (CLASSIFY_AGENT step). Tests that drive
 * the FSM without a real LLM need a mock spawn provider that intercepts the
 * classifier spawn and delivers a stub JSON output back through
 * pipeline_continue_task. Non-classifier spawns delegate to the default
 * inner provider so the rest of the flow proceeds normally.
 *
 * Two usage patterns:
 *
 * 1. **Pre-populate decisions** (no spawn intercepted) — set
 *    `state.decisions.task_short` (and any other slots the test cares about)
 *    before runFSM. CLASSIFY_AGENT skips the spawn-and-parse work when
 *    task_short is already set; tests that don't care about the
 *    classifier-spawn shape can stay at this level.
 *
 * 2. **Intercept classifier spawn** — wrap a spawn provider with
 *    `mockClassifierSpawnProvider(stub)` so the classifier emits the stub
 *    JSON on its turn through the FSM. The helper returns the wrapped
 *    provider; register it on `registry.spawn_provider`.
 *
 * The stub defaults to the schema's all-defaults shape (matches
 * agents/classifier.md's documented failure-mode output). Pass a partial
 * override to populate specific decision slots.
 */

import type {
  AgentSpawnRequest,
  SpawnProviderPlugin,
  StepResult,
} from "../../src/driver/types/plugin.js";
import { spawnAgent } from "../../src/driver/core/shuttle.js";

export type ClassifierStub = {
  schema_version?: "1.0" | "1.1";
  agent?: "classifier";
  task_id?: string | null;
  task_short?: string | null;
  refs_to_load?: string[];
  security_needed?: boolean;
  antipattern_rules_applicable?: string[];
  stack?: Record<string, unknown> | null;
  change_kind?:
    | "type-only"
    | "logic"
    | "ui"
    | "perf-sensitive"
    | "security-sensitive"
    | "config-only"
    | "docs-only"
    | null;
};

export function classifierStubOutput(stub: ClassifierStub = {}): string {
  const body = {
    schema_version: "1.1",
    agent: "classifier",
    task_id: null,
    task_short: null,
    refs_to_load: [],
    security_needed: false,
    antipattern_rules_applicable: [],
    stack: null,
    change_kind: null,
    ...stub,
  };
  return "```json\n" + JSON.stringify(body) + "\n```\n";
}

/**
 * Wrap an existing SpawnProvider so classifier spawns return the stub JSON
 * output; non-classifier spawns delegate to the inner provider. When no
 * inner provider is supplied, non-classifier spawns return a vacuous
 * spawn-agent shuttle (sufficient for tests that don't drive past the
 * classifier).
 */
export function mockClassifierSpawnProvider(
  stub: ClassifierStub = {},
  inner?: SpawnProviderPlugin,
): SpawnProviderPlugin {
  const stubBody = classifierStubOutput(stub);
  return {
    name: "mock-classifier",
    async spawn(req: AgentSpawnRequest): Promise<StepResult> {
      if (req.agent === "classifier") {
        return {
          type: "shuttle",
          response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
            runner_hint: "claude-code-task",
            description: `mock-classifier ${req.agent}`,
            prompt: stubBody,
            model: req.model,
            extras: { subagent_type: "general-purpose" },
          }),
        };
      }
      if (inner) return inner.spawn(req);
      return {
        type: "shuttle",
        response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
          runner_hint: "claude-code-task",
          description: `mock-stub ${req.agent}`,
          prompt: `mock ${req.agent}`,
          model: req.model,
          extras: { subagent_type: "general-purpose" },
        }),
      };
    },
  };
}
