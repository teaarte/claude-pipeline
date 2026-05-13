# Validate Pipeline — Self-Test

Run integrity checks on the pipeline configuration. No arguments needed.

---

## Checks

### 0. MCP Server Registration
- Run `claude mcp list` (Bash) and confirm output contains `claude-pipeline: ... ✓ Connected`. If missing or disconnected, this is a **blocking** issue. Suggest fix: `claude mcp add --scope user claude-pipeline -- node /Users/teaarte/Programming/internal/claude-pipeline/mcp/dist/server.js`.
- Read `mcp/README.md`. Confirm the listed MCP tool names match what is referenced in `commands/task.md`, `commands/done.md`, `commands/agent-feedback.md`, and the driver framework under `mcp/src/driver/`. Any reference to a tool name not present in `mcp/README.md` is a blocking issue.

### 1. Agent Files
For each agent in `~/.claude/agents/*.md`:
- File exists and is non-empty
- Reviewer/validator agents have an Output section that documents emitting a fenced ```json block (per `templates/schemas/{reviewer,validator}-output.schema.json`)
- No references to non-existent files (grep for paths like `~/.claude/agents/` and verify targets exist)

### 2. Driver Framework
The v2 plugin framework lives in `mcp/src/driver/`. Confirm:
- Every `AgentPlugin.template_path` in `mcp/src/driver/builtin/agents/index.ts` resolves to an existing `agents/*.md` file.
- Every step referenced in a `FlowPlugin.steps` array is registered in `mcp/src/driver/builtin/steps/index.ts`.
- `grep -rEi "planner|implementer|logic-reviewer|gate-[012]" mcp/src/driver/core/` returns no matches.

### 3. Command Files
For each command in `~/.claude/commands/*.md`:
- All referenced agent/pipeline/template paths exist
- No references to deleted agents (e.g. cost-estimator.md)

### 4. Templates
- `~/.claude/templates/pipeline-state.json` exists and is valid JSON
- `~/.claude/templates/pipeline-state-summary.md` exists
- `~/.claude/templates/agent-output-formats.md` exists
- Agent output formats table matches actual agent files (same status values)

### 5. Agent / Model Resolution (v2 driver surface)
- Every `AgentPlugin` registered in `mcp/src/driver/builtin/agents/index.ts` has a `default_model` of `"haiku" | "sonnet" | "opus"`.
- Every `AgentPlugin.template_path` resolves to an existing `agents/*.md` file.
- `mcp/src/driver/builtin/agents/resolve-model.ts` exports `resolveAgentModel(plugin, phase, config)` that follows the cascade `agent_overrides[name].model ?? default_models_by_phase[phase] ?? plugin.default_model`.
- `mcp/src/driver/types/config.ts` `ClaudePipelineConfig` includes `agent_overrides` and `default_models_by_phase` fields.

### 6. Framework Consistency (v2 plugin surface)
- Every step name referenced in any `FlowPlugin.steps[]` array exists in `mcp/src/driver/builtin/steps/index.ts`.
- Every `FlowPlugin.complexity` value is one of `"simple" | "medium" | "complex"` (or registered custom complexity).
- Every `AgentPlugin` referenced in built-in steps is registered in `mcp/src/driver/builtin/agents/index.ts`.
- Grep gate: `grep -rEi "planner|implementer|logic-reviewer|gate-[012]|simple-flow|medium-flow|complex-flow" mcp/src/driver/core/` returns no matches (core stays plugin-name-free).
- Plugin contract types in `mcp/src/driver/types/plugin.ts` exports `StepPlugin`, `AgentPlugin`, `FlowPlugin`, `GatePlugin`, `DecisionPlugin`, `HookPlugin`, `SpawnProviderPlugin`, `PLUGIN_API_VERSION`.
- All 7 plugin types have at least one built-in registered in `loaders/builtins.ts`.

### 7. Metrics Integrity
- `~/.claude/metrics/pipeline.jsonl` exists and every line is a valid JSON object with `schema_version: "1.0"`. The MCP server enforces validity on every write via `pipeline_finish` — any malformed line predates the MCP integration or was hand-written and should be flagged.
- `~/.claude/metrics/agent-feedback.jsonl` exists; every line validates against `templates/schemas/agent-feedback.schema.json`. Same MCP-enforced provenance via `pipeline_log_agent_feedback`.

### 7a. In-Flight Pipeline State (MCP)
- If `.claude/pipeline-state.json` exists in the current working directory, call `mcp__claude-pipeline__pipeline_validate({project_dir})` and surface any invariant violations as findings. This catches in-flight state that drifted out of MCP-managed invariants (e.g. a phase marked `completed` with no `agents[]`, a missing `skipped_reason`, etc.).
- If validation fails, do NOT propose deleting `.claude/pipeline-state.json` — surface the violation list so the user can fix the upstream cause or `/done` with the failure recorded.

### 8. Schema Integrity
- `templates/schemas/finding.schema.json` exists and is valid JSON Schema (draft 2020-12).
- `templates/schemas/reviewer-output.schema.json` exists; references finding.schema.json.
- `templates/schemas/validator-output.schema.json` exists; references finding.schema.json.
- `templates/schemas/pipeline-state.schema.json` exists.
- `templates/schemas/agent-feedback.schema.json` exists.
- `templates/schemas/category-vocab.json` exists; every agent listed in finding.schema.json `agent` enum has a corresponding `vocab[<agent>]` array.

### 9. Vocab Coverage
- For every agent that appears in finding.schema.json's `agent` enum, `category-vocab.json` must list non-empty vocab.
- Each vocab list must include `"other"` as the catch-all entry.

### 10. Schema Version Enforcement
- Every schema file in `templates/schemas/*.json` declares a `schema_version` field with `const: "1.0"` (or higher).
- Every JSON template (`templates/pipeline-state.json`) carries `schema_version`.
- Sample rows in `metrics/pipeline.jsonl` and `metrics/agent-feedback.jsonl` (if present) carry `schema_version`.

### 11. Cross-Reference Sanity
- For every reference cited in `commands/*.md`, `agents/*.md`, or any `mcp/src/driver/builtin/decisions/*.ts` ref-loader of the form `agents/references/<name>.md` — verify the file exists.
- For every reference cited as `templates/schemas/<name>.json` — verify the file exists.
- Dangling references → blocking issue.

## Output

```
Pipeline Validation Report

MCP Server:    [Connected / DISCONNECTED] (claude-pipeline)
Agents:        [N] found, [N] valid, [N] issues
Pipelines:     [N] found, [N] valid, [N] issues
Commands:      [N] found, [N] valid, [N] issues
Templates:     [N] found, [N] valid, [N] issues
Model Routing: [PASS/FAIL]
Metrics:       [PASS/FAIL]
In-Flight:     [No state / VALID / VIOLATIONS]

Issues:
- [file]: [description of issue]
- ...

Overall: [PASS / N issues found]
```

If PASS: *"Pipeline configuration is consistent."*
If issues: list each with suggested fix.
