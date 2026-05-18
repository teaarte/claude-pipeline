/**
 * Bundle-aware loader. Reads a bundle's manifest (`bundles/<name>/bundle.ts`),
 * imports the per-category plugin index files declared by the manifest, and
 * registers every plugin into the supplied PluginRegistry.
 *
 * The loader does NOT statically import individual plugins — it imports the
 * bundle's category indexes (agents/index.ts, steps/index.ts, etc.) and
 * cross-checks names against the manifest's supported_* lists. Drift between
 * the manifest and what each index actually exports surfaces here as a
 * clear load-time error, keeping the manifest trustworthy.
 *
 * KNOWN_BUNDLE_DIRS is an explicit allowlist (not a filesystem scan) — this
 * is intentional for static-import tree-shaking and to keep the trust boundary
 * around bundle code obvious. New bundles register here at compile time.
 */

import type { PluginRegistry } from "../types/plugin.js";
import type { BundleManifest } from "../types/bundle.js";

const KNOWN_BUNDLE_DIRS: Record<string, () => Promise<{ default: BundleAssets }>> = {
  code: async () => ({
    default: {
      manifest: (await import("../bundles/code/bundle.js")).codeBundle,
      agents: (await import("../bundles/code/agents/index.js")).BUILTIN_AGENTS,
      steps: (await import("../bundles/code/steps/index.js")).BUILTIN_STEPS,
      gates: (await import("../bundles/code/gates/index.js")).BUILTIN_GATES,
      hooks: (await import("../bundles/code/hooks/index.js")).BUILTIN_HOOKS,
      flows: (await import("../bundles/code/flows/index.js")).BUILTIN_FLOWS,
      spawn_provider: (await import("../bundles/code/spawn/shuttle-provider.js"))
        .shuttleSpawnProvider,
      decisions: {
        complexity: (await import("../bundles/code/decisions/complexity.js"))
          .complexityDecision,
        tests_mode: (await import("../bundles/code/decisions/tests-mode.js"))
          .testsModeDecision,
        refs_to_load: (await import("../bundles/code/decisions/refs-to-load.js"))
          .refsToLoadDecision,
        security_needed: (
          await import("../bundles/code/decisions/security-needed.js")
        ).securityNeededDecision,
        ui_touched: (await import("../bundles/code/decisions/ui-touched.js"))
          .uiTouchedDecision,
        api_touched: (await import("../bundles/code/decisions/api-touched.js"))
          .apiTouchedDecision,
      },
    },
  }),
};

interface BundleAssets {
  manifest: BundleManifest;
  agents: any[];
  steps: any[];
  gates: any[];
  hooks: any[];
  flows: any[];
  spawn_provider: any;
  decisions: Record<string, any>;
}

export async function loadBundle(
  name: string,
  registry: PluginRegistry,
): Promise<BundleManifest> {
  const factory = KNOWN_BUNDLE_DIRS[name];
  if (!factory) {
    throw new Error(
      `loadBundle: unknown bundle '${name}'. Known bundles: ${Object.keys(KNOWN_BUNDLE_DIRS).join(", ") || "(none)"}.`,
    );
  }
  const { default: assets } = await factory();
  const manifest = assets.manifest;

  assertManifestShape(manifest, name);
  assertNamesMatchManifest(assets, manifest);

  for (const a of assets.agents) registry.agents.set(a.name, a);
  for (const s of assets.steps) registry.steps.set(s.name, s);
  for (const g of assets.gates) registry.gates.set(g.name, g);
  for (const f of assets.flows) registry.flows.set(f.name, f);
  for (const h of assets.hooks) registry.hooks.push(h);
  for (const [decisionName, plugin] of Object.entries(assets.decisions)) {
    registry.decisions.set(decisionName, plugin);
  }
  registry.spawn_provider = assets.spawn_provider;

  return manifest;
}

export async function loadBundles(
  names: string[],
  registry: PluginRegistry,
): Promise<BundleManifest[]> {
  const out: BundleManifest[] = [];
  for (const n of names) out.push(await loadBundle(n, registry));
  return out;
}

/**
 * Test-only seam: register a synthetic bundle's assets so loadBundle can find
 * it. Returns a teardown function. Not exported through any user-facing API.
 */
export function _registerSyntheticBundle(
  name: string,
  factory: () => Promise<{ default: BundleAssets }>,
): () => void {
  // M1: snapshot the previous factory so teardown restores it instead of
  // deleting outright — otherwise tearing down after replacing `code` would
  // wipe the production registration.
  const previous = KNOWN_BUNDLE_DIRS[name];
  KNOWN_BUNDLE_DIRS[name] = factory;
  return () => {
    if (previous) {
      KNOWN_BUNDLE_DIRS[name] = previous;
    } else {
      delete KNOWN_BUNDLE_DIRS[name];
    }
  };
}

function assertManifestShape(manifest: BundleManifest, expectedName: string): void {
  const requiredKeys: (keyof BundleManifest)[] = [
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
  for (const k of requiredKeys) {
    if (manifest[k] === undefined || manifest[k] === null) {
      throw new Error(`loadBundle('${expectedName}'): manifest missing required field '${String(k)}'`);
    }
  }
  if (manifest.name !== expectedName) {
    throw new Error(
      `loadBundle('${expectedName}'): manifest.name='${manifest.name}' does not match bundle directory name.`,
    );
  }
}

function assertNamesMatchManifest(assets: BundleAssets, manifest: BundleManifest): void {
  diffSet("agents", manifest.supported_agents, assets.agents.map((p) => p.name));
  diffSet("steps", manifest.supported_steps, assets.steps.map((p) => p.name));
  diffSet("gates", manifest.supported_gates, assets.gates.map((p) => p.name));
  diffSet("flows", manifest.supported_flows, assets.flows.map((p) => p.name));
  diffSet("hooks", manifest.supported_hooks, assets.hooks.map((p) => p.name));
  diffSet("decisions", manifest.supported_decisions, Object.keys(assets.decisions));
}

function diffSet(category: string, declared: string[], actual: string[]): void {
  const dSet = new Set(declared);
  const aSet = new Set(actual);
  const missing = declared.filter((n) => !aSet.has(n));
  const extra = actual.filter((n) => !dSet.has(n));
  if (missing.length || extra.length) {
    throw new Error(
      `bundle manifest/plugin drift for ${category}: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
    );
  }
}
