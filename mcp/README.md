# @claude-pipeline/mcp

MCP server that makes `pipeline-state.json` and `findings.jsonl` updates mechanical and schema-validated instead of soft markdown rules the orchestrator can skip.

## Why

Without enforcement, the orchestrator can mark a task `accepted` while never spawning a single agent — `findings.jsonl` stays empty, `/learn` has nothing to cluster, past-misses injection collapses to a no-op. This server replaces every "Write to .claude/pipeline-state.json" instruction with a tool call that validates inputs against the existing schemas and refuses incoherent transitions.

## Tools (20)

Grouped by role:

### Core state mutations (5)

| Tool | Purpose |
|------|---------|
| `pipeline_init` | Copy `templates/pipeline-state.json` into `.claude/`, create empty `findings.jsonl` + `driver-state.json` + `.mcp-managed` marker, generate task_id. Refuses to overwrite a finished task. |
| `pipeline_state_get` | Read current `.claude/pipeline-state.json` in one call. |
| `pipeline_set_phase_status` | Update `phases[phase].status`. Enforces INV_002 (empty agents), INV_003 (skipped_reason), INV_010 (transitions), INV_011 (prereqs), INV_012 (open spawns on both `completed` and `skipped`). `force=true` records `pipeline_violation`. |
| `pipeline_set_gate` | Approve/reject gates 0/1/2 + feedback. |
| `pipeline_validate` | Run all coherence invariants. Returns `{ok, violations[]}`. |

### Agent spawn-record contract (3)

| Tool | Purpose |
|------|---------|
| `pipeline_begin_agent` | Returns `{agent_run_id: "ar-<uuid>"}` and appends to `phases[phase].open_spawns[]`. Required before any `pipeline_record_*` call. |
| `pipeline_record_agent_run` | For reviewer/validator agents. Validates fenced ```json header against `reviewer-output.schema.json` / `validator-output.schema.json`, streams findings into `findings.jsonl` (validated against `finding.schema.json`), appends to `reviewer_verdicts[]`, closes matching `open_spawn`, increments `agents_count`. **Requires `agent_run_id`.** |
| `pipeline_record_nonreview_agent` | For Planner/Implementer/Architect/Code-Analyzer/Dependency-Auditor/Research/Migration. Same accounting, no JSON header. **Requires `agent_run_id`.** |

### Driver entry points (2)

| Tool | Purpose |
|------|---------|
| `pipeline_run_task` | Driver entry. Calls `pipelineInit`, runs FSM until next shuttle pause (spawn-agent / ask-user / complete / error). Refuses to overwrite in-flight state (`withDriverStateLock`). |
| `pipeline_continue_task` | Driver resume. Accepts `agent-result`, `agents-results`, `user-answer`, `recovery` inputs. Routes spawn results through `pipelineRecord*` (closes `open_spawns`). |

### Recovery (5)

| Tool | Purpose |
|------|---------|
| `pipeline_cancel_spawn` | Removes an `open_spawn` entry without recording an agent result. Used when an agent crashed or was killed before completing. Audited. |
| `pipeline_abandon` | Moves `pipeline-state.json` → `abandoned-<ts>.json`, deletes `.mcp-managed` and `.mcp-bypass-allowed` markers, writes one final audit-log entry. Does NOT append to `pipeline.jsonl`. |
| `pipeline_unlock_writes` | Writes `.mcp-bypass-allowed` marker with `{schema_version, issued_at, expires_at, reason, issued_by_task_id}`. Default TTL 300s, max 3600s, max active marker lifetime ≤ 3600s from issue (HMAC-style cap — refuses to extend active marker without `force=true`). |
| `pipeline_relock_writes` | Deletes `.mcp-bypass-allowed` marker immediately. |
| `pipeline_fix_task_id` | Rewrite `pipeline-state.json`'s `task_id` to a schema-valid value under `withStateLock`. Validates `new_task_id` against `^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}$` and requires an audit-trail `reason`. Use when a malformed `task_id` (legacy state, manual construction) would block `pipeline_finish`. |

### Metrics + finalization (2)

| Tool | Purpose |
|------|---------|
| `pipeline_finish` | Set verdict, run `pipeline_validate`, append a mechanical metrics row (computed from `pipeline-state.json`) to `~/.claude/metrics/pipeline.jsonl`. **Refuses on any invariant violation.** |
| `pipeline_log_agent_feedback` | Append a human-confirmed missed-issue row to `~/.claude/metrics/agent-feedback.jsonl` (called by `/agent-feedback`). |

### Past-misses (2)

| Tool | Purpose |
|------|---------|
| `pipeline_get_past_misses` | Returns top-N past misses for an agent ranked by `recency × confidence × match_rate` score (halflife ≈ 42 days, time constant 60). Match rate computed from `categories_seen[]` in the last 20 `pipeline.jsonl` rows. |
| `pipeline_set_pattern_confidence` | Sets `manual_confidence` on an `agent-feedback.jsonl` entry. Allows demoting stale patterns to score = 0. |

### Meta (1)

| Tool | Purpose |
|------|---------|
| `pipeline_meta` | Returns `{ protocol_version, plugin_api_version, schema_versions, tools[] }`. Used by orchestrators / Web UI for protocol-version assertion and tool discovery. |

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
| `INV_010` | Phase status transitions follow a state machine: terminal states (`completed`, `skipped`) cannot reopen. Enforced inside `pipeline_set_phase_status`; `force=true` bypasses and records a `pipeline_violation`. |
| `INV_011` | Phase prerequisite ordering: a phase cannot leave `pending` until its prereq is `completed` or `skipped` (`context → planning → test_first → implementation → validation`). Enforced inside `pipeline_set_phase_status`, `pipeline_record_agent_run`, and `pipeline_record_nonreview_agent`. `force=true` bypasses in `set_phase_status`; record calls have no bypass. |

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

## Hooks (mechanical guardrails on top of the MCP)

### `~/.claude/hooks/pipeline-guard.sh` — PreToolUse

Blocks direct `Write` / `Edit` / `MultiEdit` / `NotebookEdit` and write-shaped Bash mutations targeting MCP-managed files.

**Protected paths:**
- `<project>/.claude/pipeline-state.json`
- `<project>/.claude/pipeline-state-summary.md`
- `<project>/.claude/findings.jsonl`
- `<project>/.claude/mcp-audit.jsonl`
- `<project>/.claude/driver-state.json`
- `<project>/.claude/.mcp-managed` (marker protects itself — can't be deleted)
- `<project>/.claude/.mcp-bypass-allowed` (same)
- `~/.claude/metrics/pipeline.jsonl`
- `~/.claude/metrics/agent-feedback.jsonl`
- `~/.claude/metrics/mcp-audit.jsonl`

**Scoping (Item 4a):** project paths are protected only when an ancestor directory contains a `.mcp-managed` marker (created by `pipeline_init`, removed by `pipeline_abandon` / `/done`). Home-metrics paths are always protected.

**Write-op detection (Item 4b + review-fix expansion):** beyond shell mutators (`>`, `>>`, `| tee`, `sed -i`, `awk -i`, `rm`, `mv`, `cp`, `truncate`), the guard also blocks:
- Python: `os.remove`, `os.unlink`, `shutil.rmtree`, `open(..., 'w')`, `os.system`, `subprocess.*`, `pathlib.Path().write_text`
- Node: `unlinkSync`, `writeFileSync`, `appendFileSync`, `rmSync`, `truncateSync`, `createWriteStream`, `fs.promises.*`
- Deno: `removeSync`, `writeTextFileSync`, `writeFileSync`, `truncateSync`
- Perl: `unlink`, `open` with write mode
- Ruby: `File.delete`, `File.write`, `FileUtils.rm`
- `find ... -delete`, `find ... -exec rm/mv/cp/truncate`
- `dd ... of=<protected>`
- `bash/sh/zsh -c "..."` containing any of the above
- `pwsh -Command "Remove-Item"`
- `gzip/gunzip/bzip2/xz/zstd` in-place compression that would overwrite a protected file
- Command substitution `$(...)` / `` `...` `` containing mutators
- Relative paths (resolved against `$PWD`) + split-form (`find /x/.claude -name pipeline-state.json -delete`)

20 evasion fixtures in `tests/guard-evasion/` regression-protect this surface.

**Bypass (Item 4c):** call `pipeline_unlock_writes({ttl_seconds, reason})` to write `<project>/.claude/.mcp-bypass-allowed`. The guard honors it only while `now < expires_at`. The marker is **forgery-resistant**: it stores `issued_at` and the guard rejects markers where `expires_at - issued_at > 3600s` (cap), so `expires_at=9999` does nothing. Bypass usage is audited to `~/.claude/metrics/mcp-audit.jsonl`. Call `pipeline_relock_writes` to remove the marker; `/done` removes it automatically.

**Path traversal:** `mcp/src/lib/project-dir.ts:assertProjectDirAllowed()` restricts `project_dir` arguments to `cwd` / `TMPDIR` / `~/.claude/settings.json:pipeline.allowed_project_roots`. Override for tests via `CLAUDE_PIPELINE_ALLOW_ANY_PROJECT_DIR=1`.

Registered in `~/.claude/settings.json` under `hooks.PreToolUse` with matcher `Write|Edit|MultiEdit|NotebookEdit|Bash`.

### `~/.claude/hooks/pipeline-stop.sh` — Stop

Runs at session-stop:
- `verdict != null` AND `agents_count == 0` AND `complexity != simple` → prints pipeline-violation warning to stderr.
- `verdict == null` AND a state file exists AND `stop_hook_active == false` → **blocks the stop** by emitting `{"decision": "block", "reason": "..."}` so Claude is prompted to run `/done`. On the next stop (`stop_hook_active == true`) the hook falls back to stderr so the user can exit.
- `pipeline_violation` field set → echoes to stderr.

Together these hooks turn "never `Write` pipeline-state.json" and "always run `/done`" from soft markdown rules into mechanical enforcement.

## Invariants — addendum (v2 review hardening)

- `INV_012` enforced on both `completed` AND `skipped` (review fix L3 — previously fired only on `completed`).
- `pipeline_record_*` tools require `agent_run_id` and atomically close the matching `open_spawn[]` entry.
- `lib/audit.ts` is concurrency-safe via `proper-lockfile.lock`. Global audit stream redacts `project_dir` / `task` / `task_short` / `reason` to length markers. Per-project stream capped at 50k entries with FIFO rotation. IO errors go to stderr (not silent).
- `lib/parse-json-header.ts` lenient stage bounded: `LENIENT_OBJECT_CEILING=128KB`, `LENIENT_RETRY_CAP=5`.

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
