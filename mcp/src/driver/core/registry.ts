/**
 * PluginRegistry — in-memory map of all registered plugins. Built once per
 * driver invocation by `loaders/bundles.ts` via `loadBundle()` (+ optional
 * project-config.ts overlays). Driver core consults this registry by
 * type/name; it has no awareness of which specific plugins are present.
 */

import type {
  PluginRegistry,
  StepPlugin,
  AgentPlugin,
  FlowPlugin,
  GatePlugin,
  DecisionPlugin,
  HookPlugin,
  SpawnProviderPlugin,
} from "../types/plugin.js";

export function createRegistry(): PluginRegistry {
  return {
    steps: new Map<string, StepPlugin>(),
    agents: new Map<string, AgentPlugin>(),
    flows: new Map<string, FlowPlugin>(),
    gates: new Map<string, GatePlugin>(),
    decisions: new Map<string, DecisionPlugin<any>>(),
    hooks: [] as HookPlugin[],
    spawn_provider: null as SpawnProviderPlugin | null,
  };
}

export function requireFlow(registry: PluginRegistry, name: string): FlowPlugin {
  const f = registry.flows.get(name);
  if (!f) throw new Error(`No flow registered with name '${name}'`);
  return f;
}

export function requireStep(registry: PluginRegistry, name: string): StepPlugin {
  const s = registry.steps.get(name);
  if (!s) throw new Error(`No step registered with name '${name}'`);
  return s;
}

export function requireAgent(registry: PluginRegistry, name: string): AgentPlugin {
  const a = registry.agents.get(name);
  if (!a) throw new Error(`No agent registered with name '${name}'`);
  return a;
}

export function requireGate(registry: PluginRegistry, name: string): GatePlugin {
  const g = registry.gates.get(name);
  if (!g) throw new Error(`No gate registered with name '${name}'`);
  return g;
}

export function requireDecision<T>(registry: PluginRegistry, name: string): DecisionPlugin<T> {
  const d = registry.decisions.get(name) as DecisionPlugin<T> | undefined;
  if (!d) throw new Error(`No decision registered with name '${name}'`);
  return d;
}

export function requireSpawnProvider(registry: PluginRegistry): SpawnProviderPlugin {
  if (!registry.spawn_provider) {
    throw new Error("No SpawnProviderPlugin registered.");
  }
  return registry.spawn_provider;
}
