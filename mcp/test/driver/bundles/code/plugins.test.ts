import { describe, it, expect } from "vitest";
import { createRegistry } from "../../../../src/driver/core/registry.js";
import { loadBundle } from "../../../../src/driver/loaders/bundles.js";
import { complexityDecision } from "../../../../src/driver/bundles/code/decisions/complexity.js";
import { testsModeDecision } from "../../../../src/driver/bundles/code/decisions/tests-mode.js";
import { refsToLoadDecision } from "../../../../src/driver/bundles/code/decisions/refs-to-load.js";
import { securityNeededDecision } from "../../../../src/driver/bundles/code/decisions/security-needed.js";
import { uiTouchedDecision } from "../../../../src/driver/bundles/code/decisions/ui-touched.js";
import { apiTouchedDecision } from "../../../../src/driver/bundles/code/decisions/api-touched.js";
import { resolveAgentModel } from "../../../../src/driver/bundles/code/agents/resolve-model.js";
import { defaultConfig } from "../../../../src/driver/types/config.js";
import { makeInitialDriverState } from "../../../../src/driver/core/state.js";
import { tempProject } from "../../../helpers/setup.js";
import { BUILTIN_AGENTS } from "../../../../src/driver/bundles/code/agents/index.js";
import { BUILTIN_GATES } from "../../../../src/driver/bundles/code/gates/index.js";
import { BUILTIN_FLOWS } from "../../../../src/driver/bundles/code/flows/index.js";

async function freshState(taskText = "x") {
  const proj = await tempProject();
  return {
    state: makeInitialDriverState({ project_dir: proj.dir, task: taskText, flow_name: "medium" }),
    cleanup: proj.cleanup,
  };
}

describe("decisions", () => {
  it("complexity defaults to medium when scratch is missing", async () => {
    const f = await freshState();
    try {
      expect(complexityDecision.decide(f.state)).toBe("medium");
    } finally {
      await f.cleanup();
    }
  });

  it("complexity respects scratch.complexity", async () => {
    const f = await freshState();
    try {
      f.state.scratch.complexity = "complex";
      expect(complexityDecision.decide(f.state)).toBe("complex");
    } finally {
      await f.cleanup();
    }
  });

  it("tests_mode defaults regression-only", async () => {
    const f = await freshState();
    try {
      expect(testsModeDecision.decide(f.state)).toBe("regression-only");
      f.state.scratch.tests_mode = "tdd";
      expect(testsModeDecision.decide(f.state)).toBe("tdd");
    } finally {
      await f.cleanup();
    }
  });

  it("refs-to-load triggers on keywords and caps at 5", async () => {
    const f = await freshState("refactor auth + cache + redis + perf + query schema + observability");
    try {
      const refs = await Promise.resolve(refsToLoadDecision.decide(f.state));
      expect(refs.length).toBeLessThanOrEqual(5);
      expect(refs.length).toBeGreaterThan(0);
    } finally {
      await f.cleanup();
    }
  });

  it("security_needed triggers on auth keywords", async () => {
    const f = await freshState("add jwt auth to login");
    try {
      expect(securityNeededDecision.decide(f.state)).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("ui_touched triggers on tsx/jsx in diff", async () => {
    const f = await freshState("any");
    try {
      f.state.scratch.diff_text = "diff --git a/src/Button.tsx b/src/Button.tsx";
      expect(uiTouchedDecision.decide(f.state)).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("api_touched triggers on api routes in diff", async () => {
    const f = await freshState("any");
    try {
      f.state.scratch.diff_text = "diff --git a/app/api/route.ts b/app/api/route.ts";
      expect(apiTouchedDecision.decide(f.state)).toBe(true);
    } finally {
      await f.cleanup();
    }
  });
});

describe("resolveAgentModel", () => {
  it("respects agent_overrides.model when present", () => {
    const agent = BUILTIN_AGENTS.find((a) => a.name === "planner")!;
    const cfg = { ...defaultConfig, agent_overrides: { planner: { model: "haiku" } } } as any;
    expect(resolveAgentModel(agent, "planning", cfg)).toBe("haiku");
  });

  it("falls back to default_models_by_phase", () => {
    const agent = BUILTIN_AGENTS.find((a) => a.name === "implementer")!;
    expect(resolveAgentModel(agent, "implementation", defaultConfig)).toBe("opus");
  });

  it("falls back to plugin.default_model when both above are absent", () => {
    const agent = BUILTIN_AGENTS.find((a) => a.name === "dependency-auditor")!;
    const cfg = { ...defaultConfig, default_models_by_phase: {} } as any;
    expect(resolveAgentModel(agent, "context", cfg)).toBe("haiku");
  });
});

describe("gates", () => {
  it("each built-in gate maps UserAnswer{accept|reject} to approved|rejected", () => {
    for (const g of BUILTIN_GATES) {
      expect(g.validate_response({ decision: "accept" }).status).toBe("approved");
      expect(g.validate_response({ decision: "reject" }).status).toBe("rejected");
      expect(g.validate_response({ decision: "accept", message: "lgtm" }).feedback).toBe("lgtm");
      expect(g.validate_response({ decision: "reject", message: "scope drift" }).feedback).toBe(
        "scope drift",
      );
    }
  });
});

describe("flows", () => {
  it("every flow's steps all exist in the registry", async () => {
    const r = createRegistry();
    await loadBundle("code", r);
    for (const flow of BUILTIN_FLOWS) {
      for (const step of flow.steps) {
        expect(r.steps.has(step), `step '${step}' referenced by flow '${flow.name}' is not registered`).toBe(true);
      }
    }
  });
});
