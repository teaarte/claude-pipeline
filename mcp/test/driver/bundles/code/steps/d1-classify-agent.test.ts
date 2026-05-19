/**
 * D1 / Q-classifier-auto-spawn regression: CLASSIFY_AGENT step auto-spawns
 * the classifier-agent in the context phase; the after-agent-result
 * `extract-classifier-output` hook parses the JSON output and populates
 * state.decisions {refs_to_load, security_needed,
 * antipattern_rules_applicable, task_short, stack, change_kind}. Failure
 * modes (unparseable JSON, schema-invalid output, missing fields) keep
 * existing defaults intact and audit `llm-classification-needed` so the
 * FSM never blocks on a classifier hiccup.
 */

import { describe, it, expect } from "vitest";
import { BUILTIN_STEPS } from "../../../../../src/driver/bundles/code/steps/index.js";
import { createRegistry } from "../../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../../src/driver/loaders/bundles.js";
import { makeInitialDriverState } from "../../../../../src/driver/core/state.js";
import { runHooks } from "../../../../../src/driver/core/invoke-hooks.js";
import { tempProject } from "../../../../helpers/setup.js";
import {
  classifierStubOutput,
  mockClassifierSpawnProvider,
} from "../../../../helpers/mock-classifier-spawn-provider.js";
import type {
  DriverState,
  StepContext,
  StepPlugin,
} from "../../../../../src/driver/types/plugin.js";

function getStep(name: string): StepPlugin {
  const step = BUILTIN_STEPS.find((s) => s.name === name);
  if (!step) throw new Error(`step '${name}' not registered`);
  return step;
}

async function makeCtx(state?: DriverState): Promise<StepContext> {
  const reg = createRegistry();
  await loadBundle("code", reg);
  reg.spawn_provider = mockClassifierSpawnProvider();
  let counter = 0;
  return {
    registry: reg,
    async beginSpawn(agent, phase) {
      counter++;
      const id = `ar-d1-${String(counter).padStart(12, "0")}`;
      if (state) {
        state.pending_spawns[id] = {
          agent,
          phase,
          started_at: new Date().toISOString(),
        };
      }
      return id;
    },
  };
}

function baseState(projectDir: string): DriverState {
  const s = makeInitialDriverState({
    project_dir: projectDir,
    task: "implement hybrid execution",
    flow_name: "medium",
  });
  s.decisions["complexity"] = "medium";
  s.decisions["tests_mode"] = "regression-only";
  return s;
}

describe("D1 — CLASSIFY_AGENT auto-spawn step", () => {
  it("emits a spawn-agent shuttle naming the classifier on first run", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const ctx = await makeCtx(state);
      const result = await getStep("classify-agent").run(state, ctx);
      expect(result.type).toBe("shuttle");
      if (result.type === "shuttle" && result.response.status === "spawn-agent") {
        expect(result.response.agent).toBe("classifier");
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("short-circuits when state.decisions.task_short is already populated", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      state.decisions["task_short"] = "doc-drift-fix";
      const ctx = await makeCtx(state);
      const result = await getStep("classify-agent").run(state, ctx);
      expect(result.type).toBe("advance");
      expect(state.scratch["__spawn_issued_classify-agent"]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });
});

describe("D1 — extract-classifier-output after-agent-result hook", () => {
  it("populates decisions from a valid classifier output", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const ctx = await makeCtx(state);
      const output = classifierStubOutput({
        task_short: "hybrid-exec",
        refs_to_load: ["agents/references/orchestrator-patterns.md"],
        security_needed: true,
        antipattern_rules_applicable: ["no-eval-strings"],
        change_kind: "logic",
      });
      await runHooks(ctx.registry, "after-agent-result", state, {
        agent: "classifier",
        agent_output: output,
      });
      expect(state.decisions["task_short"]).toBe("hybrid-exec");
      expect(state.decisions["refs_to_load"]).toEqual([
        "agents/references/orchestrator-patterns.md",
      ]);
      expect(state.decisions["security_needed"]).toBe(true);
      expect(state.decisions["antipattern_rules_applicable"]).toEqual([
        "no-eval-strings",
      ]);
      expect(state.decisions["change_kind"]).toBe("logic");
    } finally {
      await proj.cleanup();
    }
  });

  it("keeps defaults intact when classifier output is unparseable", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const ctx = await makeCtx(state);
      await runHooks(ctx.registry, "after-agent-result", state, {
        agent: "classifier",
        agent_output: "narrative only — no JSON",
      });
      expect(state.decisions["task_short"]).toBeUndefined();
      expect(state.decisions["refs_to_load"]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });

  it("keeps defaults intact when classifier output fails schema validation", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const ctx = await makeCtx(state);
      const badOutput =
        "```json\n" +
        JSON.stringify({ schema_version: "1.0", agent: "not-classifier" }) +
        "\n```\n";
      await runHooks(ctx.registry, "after-agent-result", state, {
        agent: "classifier",
        agent_output: badOutput,
      });
      expect(state.decisions["task_short"]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });

  it("ignores non-classifier agent results", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const ctx = await makeCtx(state);
      // Even if an implementer's output looks like a classifier JSON, the
      // hook filters by ctx.agent and skips.
      await runHooks(ctx.registry, "after-agent-result", state, {
        agent: "implementer",
        agent_output: classifierStubOutput({ task_short: "should-be-ignored" }),
      });
      expect(state.decisions["task_short"]).toBeUndefined();
    } finally {
      await proj.cleanup();
    }
  });

  it("accepts null change_kind explicitly (matches classifier failure-mode output)", async () => {
    const proj = await tempProject();
    try {
      const state = baseState(proj.dir);
      const ctx = await makeCtx(state);
      await runHooks(ctx.registry, "after-agent-result", state, {
        agent: "classifier",
        agent_output: classifierStubOutput({
          task_short: "indeterminate-task",
          change_kind: null,
        }),
      });
      expect(state.decisions["task_short"]).toBe("indeterminate-task");
      expect(state.decisions["change_kind"]).toBeNull();
    } finally {
      await proj.cleanup();
    }
  });
});
