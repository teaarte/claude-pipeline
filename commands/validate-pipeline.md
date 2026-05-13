# Validate Pipeline — Self-Test

Run integrity checks on the pipeline configuration. No arguments needed.

---

## Checks

### 0. MCP Server Registration
- Run `claude mcp list` (Bash) and confirm output contains `claude-pipeline: ... ✓ Connected`. If missing or disconnected, this is a **blocking** issue — every `mcp__claude-pipeline__*` call referenced in `commands/`, `pipelines/`, and `agents/` will fail. Suggest fix: `claude mcp add --scope user claude-pipeline -- node /Users/teaarte/Programming/internal/claude-pipeline/mcp/dist/server.js`.
- Read `mcp/README.md`. Confirm the listed MCP tool names (table under "## Tools") match what is referenced in `commands/task.md` (rules #1, #15, #22-29), `commands/done.md`, `commands/agent-feedback.md`, and the pipeline files. Any reference to a tool name not present in `mcp/README.md` is a blocking issue.

### 1. Agent Files
For each agent in `~/.claude/agents/*.md`:
- File exists and is non-empty
- Reviewer/validator agents have an Output section that documents emitting a fenced ```json block (per `templates/schemas/{reviewer,validator}-output.schema.json`)
- No references to non-existent files (grep for paths like `~/.claude/agents/` and verify targets exist)

### 2. Pipeline Files
For each pipeline in `~/.claude/pipelines/*.md`:
- All referenced agent paths exist (e.g. `~/.claude/agents/planner.md`)
- STEP numbers are sequential (sub-steps like 5b are allowed, no major gaps or duplicates)
- At least one Human Gate exists

### 3. Command Files
For each command in `~/.claude/commands/*.md`:
- All referenced agent/pipeline/template paths exist
- No references to deleted agents (e.g. cost-estimator.md)

### 4. Templates
- `~/.claude/templates/pipeline-state.json` exists and is valid JSON
- `~/.claude/templates/pipeline-state-summary.md` exists
- `~/.claude/templates/agent-output-formats.md` exists
- Agent output formats table matches actual agent files (same status values)

### 5. Model Routing Consistency
- Model routing table in `task.md` lists all agents that appear in pipeline files
- No agent appears in pipeline files but missing from routing table
- No agent in routing table that doesn't exist as a file

### 6. Feature Consistency
- `task.md` mentions background enrichment → pipeline files (medium.md, complex.md) reference it in STEP 3
- `complex.md` mentions TeamCreate for planners → fallback to parallel planners is documented
- `task.md` Global Rules count matches actual rule numbers (no gaps)

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
- For every reference cited in `commands/*.md`, `pipelines/*.md`, `agents/*.md` of the form `agents/references/<name>.md` — verify file exists.
- For every reference cited as `templates/schemas/<name>.json` — verify file exists.
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
