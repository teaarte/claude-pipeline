import { describe, it, expect } from "vitest";
import { refsToLoadDecision } from "../../../../../src/driver/bundles/code/decisions/refs-to-load.js";
import { securityNeededDecision } from "../../../../../src/driver/bundles/code/decisions/security-needed.js";
import type { DriverState } from "../../../../../src/driver/types/plugin.js";

function baseState(overrides: Partial<DriverState> = {}): DriverState {
  return {
    schema_version: "1.0",
    driver_state_id: "ds-test",
    project_dir: "/tmp/test-project",
    task: "test task",
    task_id: "t-2026-05-18-test",
    flow_name: "medium",
    step_index: 0,
    started_at: new Date().toISOString(),
    pending_spawns: {},
    pending_user_answer: null,
    decisions: {},
    complete: false,
    verdict: null,
    scratch: {},
    ...overrides,
  };
}

describe("refsToLoadDecision (item 9 — pure getter)", () => {
  it("returns empty array when state.decisions.refs_to_load is absent", async () => {
    expect(await refsToLoadDecision.decide(baseState())).toEqual([]);
  });

  it("returns the cached array when populated by the classifier-agent", async () => {
    const state = baseState({
      decisions: { refs_to_load: ["agents/references/api-design.md", "agents/references/caching.md"] },
    });
    expect(await refsToLoadDecision.decide(state)).toEqual([
      "agents/references/api-design.md",
      "agents/references/caching.md",
    ]);
  });

  it("filters non-string entries (defensive — protects against bad classifier output)", async () => {
    const state = baseState({
      decisions: { refs_to_load: ["valid.md", 42 as any, null as any, "also-valid.md"] },
    });
    expect(await refsToLoadDecision.decide(state)).toEqual(["valid.md", "also-valid.md"]);
  });

  it("returns empty array when cached value is not an array", async () => {
    const state = baseState({
      decisions: { refs_to_load: "not an array" as any },
    });
    expect(await refsToLoadDecision.decide(state)).toEqual([]);
  });
});

describe("securityNeededDecision (item 9 — pure getter)", () => {
  it("returns false when state.decisions.security_needed is absent", () => {
    expect(securityNeededDecision.decide(baseState())).toBe(false);
  });

  it("returns true when classifier said so", () => {
    const state = baseState({ decisions: { security_needed: true } });
    expect(securityNeededDecision.decide(state)).toBe(true);
  });

  it("returns false for non-boolean values (defensive)", () => {
    const state = baseState({ decisions: { security_needed: "yes" as any } });
    expect(securityNeededDecision.decide(state)).toBe(false);
  });
});
