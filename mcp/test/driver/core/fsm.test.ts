import { describe, it, expect } from "vitest";
import { runFSM } from "../../../src/driver/core/fsm.js";
import { createRegistry } from "../../../src/driver/core/registry.js";
import { makeInitialDriverState } from "../../../src/driver/core/state.js";
import { tempProject } from "../../helpers/setup.js";
import type { StepPlugin, FlowPlugin, DriverState } from "../../../src/driver/types/plugin.js";
import { complete } from "../../../src/driver/core/shuttle.js";

describe("driver/core/fsm", () => {
  it("advances through a flow until halt", async () => {
    const proj = await tempProject();
    try {
      const reg = createRegistry();
      const flow: FlowPlugin = { name: "test", complexity: "simple", phases: ["context", "final"], steps: ["one", "two", "stop"] };
      const one: StepPlugin = {
        name: "one",
        phase: "context",
        async run() {
          return { type: "advance" };
        },
      };
      const two: StepPlugin = {
        name: "two",
        phase: "context",
        async run(state: DriverState) {
          state.scratch.visited_two = true;
          return { type: "advance" };
        },
      };
      const stop: StepPlugin = {
        name: "stop",
        phase: "final",
        async run(state: DriverState) {
          state.complete = true;
          state.verdict = "accepted";
          return { type: "halt", response: complete(null, "accepted", "done") };
        },
      };
      reg.flows.set("test", flow);
      reg.steps.set("one", one);
      reg.steps.set("two", two);
      reg.steps.set("stop", stop);

      const init = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "test" });
      const { state, response } = await runFSM(init, reg);
      expect(state.complete).toBe(true);
      expect(state.scratch.visited_two).toBe(true);
      expect(response.status).toBe("complete");
    } finally {
      await proj.cleanup();
    }
  });

  it("returns shuttle response and pauses", async () => {
    const proj = await tempProject();
    try {
      const reg = createRegistry();
      const flow: FlowPlugin = { name: "test", complexity: "simple", phases: ["context", "final"], steps: ["pause"] };
      const pause: StepPlugin = {
        name: "pause",
        phase: "context",
        async run(state) {
          return {
            type: "shuttle",
            response: { status: "ask-user", driver_state_id: state.driver_state_id, gate: "g", message: "?" },
          };
        },
      };
      reg.flows.set("test", flow);
      reg.steps.set("pause", pause);
      const init = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "test" });
      const { state, response } = await runFSM(init, reg);
      expect(state.complete).toBe(false);
      expect(response.status).toBe("ask-user");
    } finally {
      await proj.cleanup();
    }
  });

  it("emits error when a step throws", async () => {
    const proj = await tempProject();
    try {
      const reg = createRegistry();
      const flow: FlowPlugin = { name: "test", complexity: "simple", phases: ["context", "final"], steps: ["bad"] };
      const bad: StepPlugin = {
        name: "bad",
        phase: "context",
        async run() {
          throw new Error("kaboom");
        },
      };
      reg.flows.set("test", flow);
      reg.steps.set("bad", bad);
      const init = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "test" });
      const { response } = await runFSM(init, reg);
      if (response.status === "error") {
        expect(response.code).toBe("STEP_THREW");
        expect(response.message).toMatch(/kaboom/);
      } else {
        throw new Error(`expected error response, got ${response.status}`);
      }
    } finally {
      await proj.cleanup();
    }
  });

  it("emits FLOW_OVERFLOW when step_index walks past the end", async () => {
    const proj = await tempProject();
    try {
      const reg = createRegistry();
      const flow: FlowPlugin = { name: "test", complexity: "simple", phases: ["context", "final"], steps: ["one"] };
      const one: StepPlugin = {
        name: "one",
        phase: "context",
        async run() {
          return { type: "advance" };
        },
      };
      reg.flows.set("test", flow);
      reg.steps.set("one", one);
      const init = makeInitialDriverState({ project_dir: proj.dir, task: "x", flow_name: "test" });
      const { response } = await runFSM(init, reg);
      if (response.status === "error") {
        expect(response.code).toBe("FLOW_OVERFLOW");
      } else {
        throw new Error(`expected error, got ${response.status}`);
      }
    } finally {
      await proj.cleanup();
    }
  });
});
