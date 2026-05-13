import { describe, it, expect } from "vitest";
import { createRegistry } from "../../../src/driver/core/registry.js";
import { runHooks } from "../../../src/driver/core/invoke-hooks.js";
import { makeInitialDriverState } from "../../../src/driver/core/state.js";
import { tempProject } from "../../helpers/setup.js";
import type { HookPlugin } from "../../../src/driver/types/plugin.js";

describe("driver/core/invoke-hooks", () => {
  it("fires hooks whose event matches", async () => {
    const proj = await tempProject();
    try {
      const r = createRegistry();
      const fired: string[] = [];
      const h1: HookPlugin = {
        name: "h1",
        event: "before-step",
        async run() {
          fired.push("h1");
        },
      };
      const h2: HookPlugin = {
        name: "h2",
        event: "after-step",
        async run() {
          fired.push("h2");
        },
      };
      r.hooks.push(h1, h2);
      const state = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "f" });
      await runHooks(r, "before-step", state, { step: "anything" });
      expect(fired).toEqual(["h1"]);
      await runHooks(r, "after-step", state, { step: "anything" });
      expect(fired).toEqual(["h1", "h2"]);
    } finally {
      await proj.cleanup();
    }
  });

  it("applies step_filter (string and regex)", async () => {
    const proj = await tempProject();
    try {
      const r = createRegistry();
      const fired: string[] = [];
      r.hooks.push({
        name: "literal",
        event: "before-step",
        step_filter: "plan",
        async run() {
          fired.push("literal");
        },
      });
      r.hooks.push({
        name: "regex",
        event: "before-step",
        step_filter: /^(plan|review)$/,
        async run() {
          fired.push("regex");
        },
      });
      const state = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "f" });
      await runHooks(r, "before-step", state, { step: "plan" });
      expect(fired).toEqual(["literal", "regex"]);
      fired.length = 0;
      await runHooks(r, "before-step", state, { step: "implement" });
      expect(fired).toEqual([]);
    } finally {
      await proj.cleanup();
    }
  });

  it("swallows hook errors and continues the pipeline", async () => {
    const proj = await tempProject();
    try {
      const r = createRegistry();
      const fired: string[] = [];
      r.hooks.push({
        name: "broken",
        event: "before-step",
        async run() {
          throw new Error("hook fail");
        },
      });
      r.hooks.push({
        name: "ok",
        event: "before-step",
        async run() {
          fired.push("ok");
        },
      });
      const state = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "f" });
      await runHooks(r, "before-step", state, { step: "plan" });
      expect(fired).toEqual(["ok"]);
    } finally {
      await proj.cleanup();
    }
  });
});
