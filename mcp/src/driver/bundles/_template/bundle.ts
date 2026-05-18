// Stub bundle manifest. Copy this file into your new bundle directory
// (e.g. mcp/src/driver/bundles/<your-bundle>/bundle.ts) and fill in the
// fields. See README.md in this directory for the full howto.
//
// The loader (`loaders/bundles.ts`) reads `bundles/<name>/bundle.ts`,
// registers every plugin listed in the supported_* arrays, and validates
// that names declared here match what the bundle's category indexes
// actually export. Drift surfaces at load time.

import type { BundleManifest } from "../../types/bundle.js";

export const templateBundle: BundleManifest = {
  name: "_template",
  version: "0.0.0",
  description: "Skeleton bundle — copy into bundles/<your-bundle>/ and edit.",
  default_flow: "simple",
  supported_flows: [],
  supported_decisions: [],
  supported_agents: [],
  supported_steps: [],
  supported_hooks: [],
  supported_gates: [],
  task_prompt_template_path: "mcp/src/driver/bundles/_template/task-prompt.md",
};
