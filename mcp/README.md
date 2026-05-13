# @claude-pipeline/mcp

MCP server that makes `pipeline-state.json` and `findings.jsonl` updates mechanical and schema-validated instead of soft markdown rules the orchestrator can skip.

## Why

Without enforcement, the orchestrator can mark a task `accepted` while never spawning a single agent — `findings.jsonl` stays empty, `/learn` has nothing to cluster, past-misses injection collapses to a no-op. This server replaces every "Write to .claude/pipeline-state.json" instruction with a tool call that validates inputs against the existing schemas and refuses incoherent transitions.

## Tools (10)

| Tool | Purpose |
|------|---------|
| `pipeline_init` | Copy `templates/pipeline-state.json` into `.claude/`, create empty `findings.jsonl`, generate task_id. Refuses to overwrite a finished task. |
| `pipeline_state_get` | Read current `.claude/pipeline-state.json` in one call (avoids manual Read). |
| `pipeline_record_agent_run` | Core. Parse a reviewer/validator agent's fenced ```json header, validate against `reviewer-output.schema.json` / `validator-output.schema.json`, stream each finding into `findings.jsonl` (validated against `finding.schema.json`), append to `reviewer_verdicts[]`, increment `agents_count`, rebuild `pipeline-state-summary.md`. |
| `pipeline_record_nonreview_agent` | Same accounting for Planner/Implementer/Architect/Code-Analyzer/Dep-Auditor/Research/Migration (no JSON header). |
| `pipeline_set_phase_status` | Update `phases[phase].status`. Rejects `completed` with empty `agents[]` (INV_002). Requires `skipped_reason` for `test_first`/`context`. `force=true` records `pipeline_violation`. |
| `pipeline_set_gate` | Approve/reject gates 0/1/2 + feedback. |
| `pipeline_validate` | Run all coherence invariants. Returns `{ok, violations[]}`. |
| `pipeline_finish` | Set verdict, validate, append a mechanical metrics row to `~/.claude/metrics/pipeline.jsonl`. **Refuses on any violation.** |
| `pipeline_log_agent_feedback` | Append a human-confirmed missed-issue row to `~/.claude/metrics/agent-feedback.jsonl` (for `/agent-feedback`). |
| `pipeline_get_past_misses` | Read last N confirmed entries for an agent (for past-misses injection at pipeline start, rule #15). |

## Invariants (enforced by `pipeline_validate` + `pipeline_finish`)

| Code | Rule |
|------|------|
| `INV_SCHEMA_STATE` | `pipeline-state.json` validates against its JSON Schema. |
| `INV_001` | `complexity ∈ {medium, complex}` + any phase `completed` → `agents_count > 0`. |
| `INV_002` | `phases[p].status == "completed"` → `agents[].length > 0` (except `context`/`final`). |
| `INV_003` | `phases[p].status == "skipped"` → `skipped_reason` set (for `test_first`/`context`). |
| `INV_004` | `reviewer_verdicts.length ≤ agents_count`. |
| `INV_005` | `gate1 == "approved"` → `planning.status ∈ {completed, skipped}`. |
| `INV_006` | `gate2 == "approved"` → `implementation.status == "completed"` AND `validation.status == "completed"`. |
| `INV_007` | `verdict != null` → all required phases `completed` or `skipped`. |
| `INV_008` | Every line in `findings.jsonl` validates against `finding.schema.json`. |
| `INV_009` | `test_files_modified_by_implementer` non-empty → requires explicit human approval in `gate2_feedback`. |

## Install

```bash
cd /Users/teaarte/Programming/internal/claude-pipeline/mcp
pnpm install
pnpm build

# Register with Claude Code (user scope)
claude mcp add --scope user claude-pipeline -- node /Users/teaarte/Programming/internal/claude-pipeline/mcp/dist/server.js
```

Verify:
```bash
claude mcp list
# claude-pipeline: node .../mcp/dist/server.js - ✓ Connected
```

## Stop hook (safety net)

`~/.claude/hooks/pipeline-stop.sh` runs after every Claude Code session. It reads `.claude/pipeline-state.json` from the session cwd and prints to stderr when:
- `verdict != null` AND `agents_count == 0` AND `complexity != simple` → real pipeline violation
- `verdict == null` AND a state file exists → in-flight reminder
- `pipeline_violation` field set → echo it

Non-blocking; intended as a diagnostic.

## Testing

```bash
# Sandboxed end-to-end smoke (writes to a tmp metrics dir, does NOT touch ~/.claude/metrics/)
pnpm smoke
```

## Paths

- Schemas: `../templates/schemas/` (loaded at runtime)
- Default metrics dir: `~/.claude/metrics/` — override with `CLAUDE_PIPELINE_METRICS_DIR=<path>` (used by smoke)

## Architecture notes

- File IO uses `proper-lockfile` for safe concurrent read-modify-write of `pipeline-state.json`.
- `findings.jsonl` and metrics rows are append-only — never rewritten.
- `pipeline-state-summary.md` is rebuilt from the template after every mutating call (no manual edits required).
- Validation uses `ajv/dist/2020.js` because schemas are draft 2020-12.
- The server only parses the **first fenced ```json block** in agent output. Markdown narrative is ignored (per user choice — keeps the contract minimal).
