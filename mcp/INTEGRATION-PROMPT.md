# Next Step — Integrate MCP into Pipeline Files

> Copy the prompt below into a fresh Claude Code session **at the repo root** (`/Users/teaarte/Programming/internal/claude-pipeline`).
> It is fully self-contained — does not assume prior conversation context.

---

## PROMPT START

You are upgrading the multi-agent pipeline in this repo (`claude-pipeline`) to use the MCP server at `mcp/` for all state mutations. The MCP server is already implemented, built, registered with Claude Code at user scope under the name `claude-pipeline`, and verified with `pnpm smoke`. **Do NOT modify the MCP server source** unless you find a bug — your job is to rewire the markdown instructions in `commands/`, `pipelines/`, and `agents/` so the orchestrator and agents call MCP tools instead of editing JSON files directly.

### Context you need to read first (in order)

1. `mcp/README.md` — full tool reference + invariants
2. `WORKFLOW.md` (already updated) — high-level integration philosophy
3. `commands/task.md` — current orchestrator rules #1, #11, #22, #23 — these reference manual JSON writes
4. `pipelines/simple.md`, `pipelines/medium.md`, `pipelines/complex.md` — STEP descriptions that mention writing state
5. `commands/done.md` — currently does a manual JSON-to-JSON transform; must call `pipeline_finish` instead
6. `commands/agent-feedback.md` — currently appends to `agent-feedback.jsonl` manually; must call `pipeline_log_agent_feedback`

### MCP tools available (all under prefix `mcp__claude_pipeline__`)

| Tool | When to call |
|------|--------------|
| `pipeline_init` | Once at STEP 1, replaces "copy template + write JSON" |
| `pipeline_state_get` | Anywhere the orchestrator currently `Read`s `.claude/pipeline-state.json` |
| `pipeline_record_agent_run` | After every reviewer/validator agent (logic, challenger, style, security, performance, acceptance, plan-conformance, plan-grounding-check, context-doc-verifier, ui-consistency, api-contract, playwright, test) |
| `pipeline_record_nonreview_agent` | After Planner, Implementer, Architect, Code Analyzer, Dependency Auditor, Research, Migration |
| `pipeline_set_phase_status` | When transitioning a phase's status |
| `pipeline_set_gate` | After each Human Gate decision (0/1/2) |
| `pipeline_validate` | Before Gate 2 and inside `/validate-pipeline` |
| `pipeline_finish` | Once at the end of `/done`, replaces the JSON-to-JSON transform |
| `pipeline_log_agent_feedback` | Inside `/agent-feedback` |
| `pipeline_get_past_misses` | At pipeline start when building `.claude/past-misses-{agent}.md` (rule #15) |

### Required changes — file by file

**`commands/task.md`** — rewrite rules #1, #11, #15, #22, #23:
- Rule #1: "After every agent completion, call `mcp__claude_pipeline__pipeline_record_agent_run` (reviewers/validators) or `mcp__claude_pipeline__pipeline_record_nonreview_agent` (planner/implementer/etc.). The MCP tool rebuilds `pipeline-state-summary.md` automatically — do NOT manually edit it. Never use Write/Edit on `.claude/pipeline-state.json` or `.claude/findings.jsonl` directly."
- Rule #11: keep — exact integer counts are now enforced by the MCP layer (`agents_count` is incremented atomically per call).
- Rule #15: replace "read `~/.claude/metrics/agent-feedback.jsonl`, filter, write per-agent files" with "call `mcp__claude_pipeline__pipeline_get_past_misses` for each agent, write each result to `.claude/past-misses-{agent}.md`".
- Rule #22: remove "do NOT append historical phase data" — the MCP enforces this now. Keep the file-pointer policy.
- Rule #23: replace "every reviewer/validator's findings[] array is also appended to `.claude/findings.jsonl`" with "...is appended via `pipeline_record_agent_run`, which validates each finding against `finding.schema.json` and rejects invalid entries."

**STEP 1a in `commands/task.md`** — replace `cp ~/.claude/templates/pipeline-state.json → .claude/pipeline-state.json` instructions with a single `pipeline_init` call. Include the call signature as a code example.

**`pipelines/simple.md`, `medium.md`, `complex.md`** — every step that currently says "Spawn X agent" must be followed by a bullet:
```
After the agent completes:
- If X is a reviewer/validator → `pipeline_record_agent_run({project_dir, phase, agent_output})`
- If X is a non-reviewer (planner/implementer/etc.) → `pipeline_record_nonreview_agent({project_dir, phase, agent, output_file?, iterations?})`
Then update phase status if appropriate: `pipeline_set_phase_status({project_dir, phase, status})`
```
Replace any "update pipeline-state.json with..." sentences with the equivalent MCP call.

**`commands/done.md`** — almost entire body should become: validate via `pipeline_validate`, then call `pipeline_finish({project_dir, verdict, project_short?, task_short?})`. The current manual JSON-to-JSON transform is now done inside the MCP tool. Keep KB persistence (tech-debt.md), commit-message generation, and cleanup steps (those are not MCP responsibilities).

**`commands/agent-feedback.md`** — replace manual `agent-feedback.jsonl` write with `pipeline_log_agent_feedback({agent, category, pattern_to_look_for, severity, found_by, human_confirmed, ...})`.

**`commands/validate-pipeline.md`** — section 7 (Metrics Integrity) is now mostly enforced upstream; add a section that runs `pipeline_validate` for any in-flight `.claude/pipeline-state.json` in the current cwd. Also add a check that the MCP server is registered (`claude mcp list | grep claude-pipeline`).

**`agents/*.md`** — no source changes needed. Agents continue to emit fenced ```json headers exactly as defined in `templates/agent-output-formats.md`. The orchestrator parses the agent output text and passes the **entire text** to `pipeline_record_agent_run`. Make sure the agent prompt does NOT instruct the agent to write to `findings.jsonl` itself.

### Invariants you must not violate

- The MCP refuses `pipeline_set_phase_status({status: "completed"})` if `phases[phase].agents[]` is empty (unless `force=true`, which records a `pipeline_violation`). Do NOT use `force=true` in the standard flow — find the missing agent call and add it.
- `pipeline_finish` refuses on any invariant violation. If `/done` is failing, do NOT bypass with manual writes — fix the upstream cause.
- `findings.jsonl` is append-only. Never tell agents or the orchestrator to rewrite or delete entries.

### Acceptance criteria

1. `commands/task.md` has zero instructions to `Write` or `Edit` `.claude/pipeline-state.json` or `.claude/findings.jsonl`. Every state mutation references an `mcp__claude_pipeline__*` tool.
2. `pipelines/medium.md` STEP 3, 4, 5, 6, 6b, 6c, 7 each explicitly state which MCP record/status call must follow each agent spawn.
3. `commands/done.md` body fits in ~30 lines: validate → finish → KB persist → commit message → cleanup.
4. `commands/agent-feedback.md` does NOT contain manual JSONL append snippets.
5. Run `/validate-pipeline` (after your edits) and verify it passes on the updated configuration.
6. Test the integration on a real task: run `/quick "add a no-op comment to README.md"` or similar SIMPLE task — confirm that:
   - `.claude/pipeline-state.json` is created via `pipeline_init`
   - `.claude/findings.jsonl` exists and grows when any reviewer runs
   - `/done` calls `pipeline_finish` and writes a row to `~/.claude/metrics/pipeline.jsonl`
   - Stop hook does NOT print a violation

### What NOT to do

- Do not add new tools to the MCP server. The 10 existing tools cover the surface.
- Do not edit JSON schemas in `templates/schemas/` — invariants are layered on top of them; schema churn breaks past `.jsonl` rows.
- Do not write a fallback "manual mode" for when MCP is unavailable. If the server is down, the pipeline halts — that's intentional.
- Do not loosen invariants to make existing buggy state pass. The `s3-panel` `.claude/pipeline-state.json` from the previous run is intentionally left flagged as `pipeline_violation` — let it stay broken as a forcing function.

### Output expected

- Diff of all changed `.md` files (orchestrator, pipelines, commands).
- A short report: how many manual JSON-write instructions were removed, how many MCP tool call instructions were added, list of files touched.
- Result of `/validate-pipeline` after the changes.

## PROMPT END
