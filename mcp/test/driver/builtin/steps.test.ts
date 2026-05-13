// Exercises every built-in step's run() at least once. Each step result is
// checked for a sensible shape; the actual orchestration of a full flow is
// covered separately by integration.test.ts.

import { describe, it, expect } from "vitest";
import { BUILTIN_STEPS } from "../../../src/driver/builtin/steps/index.js";
import { createRegistry } from "../../../src/driver/core/registry.js";
import { loadBuiltinPlugins } from "../../../src/driver/loaders/builtins.js";
import { makeInitialDriverState } from "../../../src/driver/core/state.js";
import { tempProject } from "../../helpers/setup.js";
import type { StepContext, DriverState, StepPlugin } from "../../../src/driver/types/plugin.js";

async function runWith(state: DriverState, step: StepPlugin) {
  const reg = createRegistry();
  loadBuiltinPlugins(reg);
  const ctx: StepContext = {
    registry: reg,
    async beginSpawn(_a, _p) {
      return "ar-test-0000-0000-0000-000000000000";
    },
  };
  return step.run(state, ctx);
}

describe("built-in steps — every run() is exercised", () => {
  for (const step of BUILTIN_STEPS) {
    it(`step '${step.name}' produces a valid StepResult`, async () => {
      const proj = await tempProject();
      try {
        const state = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "medium" });
        // Set decisions so conditional steps still produce a valid shape.
        state.decisions["complexity"] = "complex";
        state.decisions["tests_mode"] = "tdd";
        state.scratch.complexity = "complex";
        state.scratch.tests_mode = "tdd";
        const result = await runWith(state, step);
        expect(["advance", "shuttle", "halt"]).toContain(result.type);
      } finally {
        await proj.cleanup();
      }
    });
  }
});
