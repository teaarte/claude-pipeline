/**
 * BundleManifest — first-class declaration of a bundle's content.
 *
 * Bundles are domain implementations (code, marketing, content-gen, research,
 * etc.) that plug into the substrate via `loaders/bundles.ts`. The manifest
 * tells the loader which plugins this bundle ships and where the bundle's
 * shuttle preamble lives.
 *
 * v2.2.5 ships the contract + the code-bundle manifest + the loader. Future
 * phases ship additional bundles by adding a sibling `bundles/<name>/` dir
 * with a `bundle.ts` exporting a BundleManifest.
 */

import type { PluginMeta } from "./plugin.js";

export interface BundleManifest extends PluginMeta {
  /** Bundle identifier (e.g. "code", "tiktok", "marketing"). Lower-snake. */
  name: string;

  /** Semver string for the bundle implementation. */
  version: string;

  /** Human-readable bundle purpose. Shown to authors + in audit. */
  description: string;

  /** Flow name to use when complexity decision is unset / out-of-bundle. */
  default_flow: string;

  /** Flow names this bundle registers. */
  supported_flows: string[];

  /** Decision plugin names this bundle registers. */
  supported_decisions: string[];

  /** Agent plugin names this bundle registers. */
  supported_agents: string[];

  /** Step plugin names this bundle registers. */
  supported_steps: string[];

  /** Hook plugin names this bundle registers. */
  supported_hooks: string[];

  /** Gate plugin names this bundle registers. */
  supported_gates: string[];

  /**
   * Repo-relative path to the bundle's task-prompt preamble — the markdown
   * fragment that `commands/task.md` (skill shuttle) injects per Item 5.
   */
  task_prompt_template_path: string;

  /**
   * Optional repo-relative path to the bundle's state-schema extension
   * (templates/schemas/bundle-extensions/<bundle>.schema.json). Code-bundle
   * sets this; bundles with no extra required state can omit.
   */
  state_schema_extension?: string;

  /**
   * Optional repo-relative path to the bundle's baseline knowledge directory.
   * Files in this directory may be injected into agent prompts per Item 7
   * (team_knowledge_refs). Bundles can omit if no baseline knowledge ships.
   */
  knowledge_dir?: string;
}
