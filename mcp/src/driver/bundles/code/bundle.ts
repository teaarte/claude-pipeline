/**
 * Code-bundle manifest. The loader (`loaders/bundles.ts`) reads this file,
 * registers every plugin listed under supported_*, and pins the bundle's
 * shuttle preamble / state-schema extension paths.
 *
 * Adding/removing a built-in plugin = update the corresponding list here.
 * The loader cross-checks the declared names against what each plugin file
 * actually exports — drift between the manifest and the exports triggers a
 * load-time error so the manifest stays trustworthy.
 */

import type { BundleManifest } from "../../types/bundle.js";

export const codeBundle: BundleManifest = {
  name: "code",
  version: "1.0.0",
  description: "Code generation pipeline — TypeScript, Python, Go, Rust, etc.",
  default_flow: "medium",
  supported_flows: ["simple", "medium", "complex"],
  supported_decisions: [
    "complexity",
    "tests_mode",
    "refs_to_load",
    "security_needed",
    "ui_touched",
    "api_touched",
  ],
  supported_agents: [
    "acceptance",
    "api-contract",
    "architect",
    "challenger-reviewer",
    "classifier",
    "code-analyzer",
    "context-doc-verifier",
    "dependency-auditor",
    "implementer",
    "logic-reviewer",
    "migration",
    "performance",
    "plan-conformance",
    "plan-grounding-check",
    "planner",
    "playwright",
    "research",
    "security",
    "style-reviewer",
    "test",
    "ui-consistency",
  ],
  supported_steps: [
    "architect",
    "classify",
    "classify-agent",
    "context-verify",
    "enrich",
    "final-checks",
    "finalize",
    "gate-0",
    "gate-1",
    "gate-2",
    "git-diff",
    "git-stash",
    "implement",
    "initialize",
    "iterate",
    "plan",
    "plan-grounding",
    "plan-review",
    "pre-review",
    "reconcile",
    "review",
    "sacred-tests",
    "test-first",
    "test-verify",
  ],
  supported_hooks: [
    "git-diff-snapshot",
    "load-past-misses",
    "anti-pattern-grep",
    "caller-context-expand",
    "extract-classifier-output",
    "extract-tech-debt-from-prose",
  ],
  supported_gates: ["gate-0", "gate-1", "gate-2"],
  task_prompt_template_path: "mcp/src/driver/bundles/code/task-prompt.md",
  state_schema_extension: "templates/schemas/bundle-extensions/code.schema.json",
  knowledge_dir: "mcp/src/driver/bundles/code/knowledge",
};
