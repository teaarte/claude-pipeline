import { describe, it, expect } from "vitest";
import { createRegistry, requireFlow, requireStep, requireAgent, requireGate, requireDecision, requireSpawnProvider } from "../../../src/driver/core/registry.js";
import { loadBundle } from "../../../src/driver/loaders/bundles.js";

describe("driver/core/registry", () => {
  it("createRegistry returns empty collections", () => {
    const r = createRegistry();
    expect(r.steps.size).toBe(0);
    expect(r.agents.size).toBe(0);
    expect(r.flows.size).toBe(0);
    expect(r.gates.size).toBe(0);
    expect(r.decisions.size).toBe(0);
    expect(r.hooks.length).toBe(0);
    expect(r.spawn_provider).toBeNull();
  });

  it("loadBundle('code', r) registers ≥17 steps, ≥20 agents, ≥3 flows, ≥3 gates, ≥6 decisions, ≥3 hooks, 1 spawn provider", async () => {
    const r = createRegistry();
    await loadBundle("code", r);
    expect(r.steps.size).toBeGreaterThanOrEqual(17);
    expect(r.agents.size).toBeGreaterThanOrEqual(20);
    expect(r.flows.size).toBeGreaterThanOrEqual(3);
    expect(r.gates.size).toBeGreaterThanOrEqual(3);
    expect(r.decisions.size).toBeGreaterThanOrEqual(6);
    expect(r.hooks.length).toBeGreaterThanOrEqual(3);
    expect(r.spawn_provider).not.toBeNull();
  });

  it("required-lookup helpers throw for unknown names", () => {
    const r = createRegistry();
    expect(() => requireFlow(r, "nope")).toThrow();
    expect(() => requireStep(r, "nope")).toThrow();
    expect(() => requireAgent(r, "nope")).toThrow();
    expect(() => requireGate(r, "nope")).toThrow();
    expect(() => requireDecision(r, "nope")).toThrow();
    expect(() => requireSpawnProvider(r)).toThrow();
  });
});
