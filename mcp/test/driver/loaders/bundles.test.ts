import { describe, it, expect, afterEach } from "vitest";
import { createRegistry } from "../../../src/driver/core/registry.js";
import {
  loadBundle,
  loadBundles,
  _registerSyntheticBundle,
} from "../../../src/driver/loaders/bundles.js";
import type { BundleManifest } from "../../../src/driver/types/bundle.js";

const FULL_CODE_MANIFEST_KEYS = [
  "name",
  "version",
  "description",
  "default_flow",
  "supported_flows",
  "supported_decisions",
  "supported_agents",
  "supported_steps",
  "supported_hooks",
  "supported_gates",
  "task_prompt_template_path",
];

describe("loaders/bundles (item 4)", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("loads the code bundle and registers every plugin declared in its manifest", async () => {
    const reg = createRegistry();
    const manifest = await loadBundle("code", reg);
    for (const k of FULL_CODE_MANIFEST_KEYS) expect(manifest).toHaveProperty(k);
    expect(manifest.name).toBe("code");
    // Every declared name resolves to a registered plugin.
    for (const n of manifest.supported_agents) expect(reg.agents.has(n)).toBe(true);
    for (const n of manifest.supported_steps) expect(reg.steps.has(n)).toBe(true);
    for (const n of manifest.supported_gates) expect(reg.gates.has(n)).toBe(true);
    for (const n of manifest.supported_flows) expect(reg.flows.has(n)).toBe(true);
    for (const n of manifest.supported_decisions) expect(reg.decisions.has(n)).toBe(true);
    expect(reg.spawn_provider).not.toBeNull();
  });

  it("throws a clean error on unknown bundle name", async () => {
    const reg = createRegistry();
    await expect(loadBundle("does-not-exist", reg)).rejects.toThrow(
      /unknown bundle 'does-not-exist'/,
    );
  });

  it("loadBundles registers a synthetic second bundle alongside code (bundle pluralism)", async () => {
    const synthAgents = [
      { name: "synth-agent", template_path: "agents/synth.md", output_schema: "nonreview" as const, default_model: "haiku" as const },
    ];
    const synthSteps = [
      {
        name: "synth-step",
        phase: "context",
        async run() {
          return { type: "advance" as const };
        },
      },
    ];
    const synthFlows = [
      { name: "synth-flow", complexity: "simple", phases: ["context", "final"], steps: ["synth-step"] },
    ];
    const synthManifest: BundleManifest = {
      name: "synth",
      version: "0.0.1",
      description: "Synthetic test bundle",
      default_flow: "synth-flow",
      supported_flows: ["synth-flow"],
      supported_decisions: [],
      supported_agents: ["synth-agent"],
      supported_steps: ["synth-step"],
      supported_hooks: [],
      supported_gates: [],
      task_prompt_template_path: "synthetic",
    };
    cleanups.push(
      _registerSyntheticBundle("synth", async () => ({
        default: {
          manifest: synthManifest,
          agents: synthAgents,
          steps: synthSteps,
          gates: [],
          hooks: [],
          flows: synthFlows,
          spawn_provider: null,
          decisions: {},
        },
      })),
    );
    const reg = createRegistry();
    const manifests = await loadBundles(["code", "synth"], reg);
    expect(manifests.map((m) => m.name)).toEqual(["code", "synth"]);
    expect(reg.agents.has("synth-agent")).toBe(true);
    expect(reg.flows.has("synth-flow")).toBe(true);
    expect(reg.steps.has("synth-step")).toBe(true);
    // Code bundle's agents are still registered (no clobber).
    expect(reg.agents.has("planner")).toBe(true);
  });

  it("rejects a manifest missing required fields", async () => {
    const bad = { name: "bad", version: "0", description: "missing fields" } as any;
    cleanups.push(
      _registerSyntheticBundle("bad", async () => ({
        default: {
          manifest: bad,
          agents: [],
          steps: [],
          gates: [],
          hooks: [],
          flows: [],
          spawn_provider: null,
          decisions: {},
        },
      })),
    );
    const reg = createRegistry();
    await expect(loadBundle("bad", reg)).rejects.toThrow(/missing required field/);
  });

  it("rejects a manifest whose name does not match the directory key", async () => {
    const renamed: BundleManifest = {
      name: "actually-something-else",
      version: "0.0.1",
      description: "name mismatch",
      default_flow: "x",
      supported_flows: [],
      supported_decisions: [],
      supported_agents: [],
      supported_steps: [],
      supported_hooks: [],
      supported_gates: [],
      task_prompt_template_path: "x",
    };
    cleanups.push(
      _registerSyntheticBundle("renamed", async () => ({
        default: {
          manifest: renamed,
          agents: [],
          steps: [],
          gates: [],
          hooks: [],
          flows: [],
          spawn_provider: null,
          decisions: {},
        },
      })),
    );
    const reg = createRegistry();
    await expect(loadBundle("renamed", reg)).rejects.toThrow(/does not match bundle directory/);
  });

  it("rejects when bundle's category index ships a name not in manifest.supported_*", async () => {
    const driftManifest: BundleManifest = {
      name: "drift",
      version: "0.0.1",
      description: "manifest says zero agents but index ships one",
      default_flow: "x",
      supported_flows: [],
      supported_decisions: [],
      supported_agents: [], // empty
      supported_steps: [],
      supported_hooks: [],
      supported_gates: [],
      task_prompt_template_path: "x",
    };
    cleanups.push(
      _registerSyntheticBundle("drift", async () => ({
        default: {
          manifest: driftManifest,
          agents: [
            { name: "ghost-agent", template_path: "x", output_schema: "nonreview" as const, default_model: "haiku" as const },
          ],
          steps: [],
          gates: [],
          hooks: [],
          flows: [],
          spawn_provider: null,
          decisions: {},
        },
      })),
    );
    const reg = createRegistry();
    await expect(loadBundle("drift", reg)).rejects.toThrow(/drift for agents/);
  });
});
