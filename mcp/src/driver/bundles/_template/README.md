# Bundle author howto

A **bundle** is a complete domain implementation that plugs into the pipeline
substrate. The code bundle (`mcp/src/driver/bundles/code/`) is the reference
implementation — it owns the 6-phase code-generation flow, all reviewer/
validator agents, and code-specific decisions (security_needed, refs_to_load,
stack_detect, etc.).

A future TikTok bundle, marketing bundle, or research bundle would live as a
sibling directory here. The substrate (FSM, plugin contracts, MCP enforcement,
audit) is bundle-agnostic.

## Directory layout

```
mcp/src/driver/bundles/<your-bundle>/
  agents/                ← AgentPlugin definitions + agent template paths
  decisions/             ← DecisionPlugin getters (deterministic or pure)
  flows/                 ← FlowPlugin definitions; declares phases + steps
  gates/                 ← GatePlugin definitions (user-facing decision points)
  hooks/                 ← HookPlugin (before-step / after-step / etc.)
  spawn/                 ← Optional: custom SpawnProviderPlugin if not reusing shuttle
  steps/                 ← StepPlugin implementations
  knowledge/             ← Bundle-baseline shared knowledge files (markdown)
  bundle.ts              ← BundleManifest (export name, version, plugin lists)
  task-prompt.md         ← Bundle-specific preamble injected into commands/task.md
```

## Minimum viable bundle

`bundle.ts` declares a `BundleManifest` (see
`mcp/src/driver/types/bundle.ts`). Item 4 (v2.2.5-bundle-foundation) ships
the loader that reads this manifest and registers all referenced plugins.

```typescript
import type { BundleManifest } from "../../types/bundle.js";

export const myBundle: BundleManifest = {
  name: "my-bundle",
  version: "0.1.0",
  description: "My bundle's purpose.",
  default_flow: "simple",
  supported_flows: ["simple"],
  supported_decisions: [],
  supported_agents: [],
  supported_steps: ["initialize", "finalize"],
  supported_hooks: [],
  supported_gates: [],
  task_prompt_template_path: "mcp/src/driver/bundles/my-bundle/task-prompt.md",
};
```

## Registration

A project opts into a bundle via `<project>/.claude/pipeline.config.json`:

```json
{
  "bundle": "my-bundle"
}
```

If absent, defaults to `"code"`.

## State extension (optional)

If your bundle needs additional required state fields (the way `code` requires
`tests_mode` + `stack`), add `templates/schemas/bundle-extensions/<bundle>.schema.json`
with conditional `if/then` constraints. The base schema is
`templates/schemas/pipeline-state.schema.json` and stays universal.

## Phases

A flow declares `phases: string[]` (e.g., `["context", "draft", "render", "publish"]`).
The substrate validates flow.phases against state.phases keys at runtime. There is
no hard-coded phase enum — that was removed in v2.2.5 Item 1.

## What NOT to put in a bundle

- Anything generic (FSM, registry, schema validation, audit) — stays in `core/`.
- External MCP integrations — those are `MCPClientPlugin` declared at config level
  (`pipeline.config.json.mcp_clients[]`), not bundle-internal.
- User-account or organization concerns — bundles are domain implementations, not
  multi-tenant primitives.

## Reference

- [`bundles/code/`](../code/) — full reference implementation.
- [`mcp/src/driver/types/plugin.ts`](../../types/plugin.ts) — plugin contracts.
- [`mcp/src/driver/types/bundle.ts`](../../types/bundle.ts) — `BundleManifest` (Item 4+).
- [`specs/phases/v2.2.5-bundle-foundation.md`](../../../../../specs/phases/v2.2.5-bundle-foundation.md) — design history.
