# Validation Log

Personal journal of real-task `/task` runs on actual projects (not on claude-pipeline itself). Captures both **objective metrics** (from MCP-managed JSONL streams) and **subjective UX notes** that logs cannot capture.

Drives `specs/v3-productization-roadmap.md` "Validation-driven v2.1 backlog" section. Each bug surfaced here → Q-numbered roadmap item.

> **Quick path for fresh sessions:** paste the prompt from [`validation-prompt.md`](./validation-prompt.md) into a new Claude Code session right after `/task` completes (before `/done`). It executes the full Steps 1-6 workflow below + commits the result. Use this when you don't want to do the analysis manually.

---

## How to fill out a new entry — self-contained instructions

> **A fresh Claude Code session can execute this without prior context.** Just open this file + the project where `/task` ran, follow the steps below.

### When to add an entry

After every `/task` run on a real project. Add BEFORE `/done` cleans `.claude/` (or at least make sure you've captured the data — `/done` deletes most evidence files).

### Step 1 — Locate the data sources

For the project where you just ran `/task`, the per-task evidence lives in:

```
<project>/.claude/
  pipeline-state.json         # canonical state (phases, gates, verdict, agents_count)
  pipeline-state-summary.md   # human-glance summary (auto-rebuilt)
  driver-state.json           # FSM scratchpad — step_index, scratch, pending_user_answer
  findings.jsonl              # every finding emitted (severity, category, file:line, ...)
  mcp-audit.jsonl             # every MCP call (tool, args_summary, verdict, ts)
```

Cross-task aggregates live in:

```
~/.claude/metrics/
  pipeline.jsonl              # one row per completed task (post-/done)
  agent-feedback.jsonl        # human-confirmed reviewer misses
  mcp-audit.jsonl             # global audit log (redacted project_dir, capped 10k)
```

### Step 2 — Run these jq commands to extract the data

Paste each command into Bash. Replace `<PROJECT>` with the absolute project path.

```bash
PROJECT="<PROJECT>"  # e.g. /Users/teaarte/Work/AI-FACTORY/s3-panel

# Identity + state shape
jq '{task_id, complexity, tests_mode, verdict, agents_count, blockers_found,
     pipeline_violation, gates,
     phases: (.phases | map_values(.status))}' "$PROJECT/.claude/pipeline-state.json"

# Validate state against MCP invariants (catches schema drift, broken state)
# Call via MCP tool: mcp__claude-pipeline__pipeline_validate({project_dir: PROJECT})

# Open spawns per phase (should be 0 in every phase if atomic spawn-record worked)
jq '.phases | to_entries | map({phase: .key, status: .value.status,
     open: (.value.open_spawns // [] | length),
     agents: (.value.agents // [] | length)})' "$PROJECT/.claude/pipeline-state.json"

# Reviewer verdicts — which agents ran in code review, blocking counts
jq '.reviewer_verdicts | map({agent, verdict, blocking: .blocking_issues, non_blocking})' \
   "$PROJECT/.claude/pipeline-state.json"

# Findings severity distribution
jq -r '.severity' "$PROJECT/.claude/findings.jsonl" | sort | uniq -c

# Findings by category
jq -r '.category' "$PROJECT/.claude/findings.jsonl" | sort | uniq -c | sort -rn

# Driver-state — current FSM step + scratch keys
jq '{driver_state_id, flow_name, step_index, complete, verdict,
     pending_user_answer, pending_spawns_count: (.pending_spawns | length),
     decisions, scratch_keys: (.scratch | keys)}' "$PROJECT/.claude/driver-state.json"

# Audit verdict distribution — how many MCP calls errored
jq -r '.verdict' "$PROJECT/.claude/mcp-audit.jsonl" | sort | uniq -c

# Last 10 audit events — what happened just before user stopped
tail -10 "$PROJECT/.claude/mcp-audit.jsonl" | \
  jq -c '{ts, tool, verdict, args: (.args_summary | {phase, agent, status, gate, decision})}'

# Find force_bypass / force_used events (security-relevant)
jq 'select(.force_used == true)' "$PROJECT/.claude/mcp-audit.jsonl"

# Find errors in continue-task (driver retry / swallowed-INV signals)
jq 'select(.verdict == "error") | {ts, tool, error}' "$PROJECT/.claude/mcp-audit.jsonl"

# Output size per agent (token-leak signal — outliers indicate accidentally inlined context)
jq -r 'select(.tool == "pipeline_record_agent_run") |
       "\(.args_summary.agent // "unknown")\t\(.args_summary.agent_output // "<n/a>")"' \
   "$PROJECT/.claude/mcp-audit.jsonl"
```

### Step 3 — Fill out the template

Copy the **template block below** into a new `## t-...` heading at the top of the "Entries" section. Replace placeholders.

- For each numbered field, paste the jq output directly or paraphrase.
- Subjective rating: gut feeling 1-10.
- Bug list: each goes through 4 checks:
  1. **Is it a real bug** (vs expected behavior the user didn't anticipate)?
  2. **Is it new** or already a known Q-item in `specs/v3-productization-roadmap.md` "Validation-driven v2.1 backlog"?
  3. **What's the severity** (🔴 HIGH blocks further work / 🟡 MEDIUM degrades quality / 🟢 LOW cosmetic)?
  4. **What's the root cause hypothesis** + which `mcp/src/...` file likely owns the fix?

### Step 4 — Update the roadmap if new bug class

If a bug is genuinely new (not duplicate of an existing Q-item):

1. Open `specs/v3-productization-roadmap.md`.
2. Locate the "Validation-driven v2.1 backlog" table.
3. Add a new row: next Q-number, severity, description, effort estimate, file path for fix, **this validation-log entry's task_id**.
4. Commit both files together: `git add validation-log.md specs/v3-productization-roadmap.md`.

If a bug is recurrence of an existing Q-item, just reference it in this log entry (`Q9 (recurrence)`) — don't duplicate the row in roadmap. Recurrences are the v2.1 priority signal.

### Step 5 — Trend check every 3-5 entries

Glance back at the last 3-5 entries. Look for:
- **Same Q-item recurring** → that's a v2.1 priority. Promote to top of fix list.
- **Same friction point** (UX, not bugs) → candidate for v2.5 UX improvement.
- **Same recovery path used repeatedly** (e.g., `pipeline_unlock_writes` for state fixes) → friction signal that v2 needs softer recovery UX.
- **Cost trajectory** when v2.7 lands — if costs grow per task, investigate before v2.5 ships.

After 5+ entries, run `/metrics-report` + `/learn` for cross-task aggregates.

### Step 6 — Decide whether to close current task

Don't skip this — running `/done` on a broken state wastes data:

- **If `pipeline_validate` returned `ok: true` and you want the metrics row preserved** → run `/done`. Closes task properly, appends to `~/.claude/metrics/pipeline.jsonl`.
- **If `pipeline_validate` returned violations and you want to record the failed task** → fix violations through `pipeline_unlock_writes` + manual edit + `pipeline_relock_writes`, OR use `force=true` on the offending `pipeline_set_phase_status` / `pipeline_finish` (records `pipeline_violation` flag).
- **If state is hopelessly corrupted and not worth preserving** → `pipeline_abandon({project_dir, reason})`. Moves state to `abandoned-<ts>.json`, no metrics row, log entry still captures findings for posterity.

Pick option matches your data-collection intent. The first 3-5 validation runs probably benefit from preservation even with violations — captures realistic "what real bugs look like in state" data.

### Common gotchas

- **Don't run `/done` before extracting data.** `/done` cleans most `.claude/` files. Either capture data first, OR rely on `~/.claude/metrics/pipeline.jsonl` (which `/done` writes to before cleaning).
- **Some bugs hide in `driver-state.json` not `pipeline-state.json`.** v2 has two state files (canonical vs FSM scratch). Always check both.
- **`mcp-audit.jsonl` per-project gets deleted by `/done`.** Global `~/.claude/metrics/mcp-audit.jsonl` survives but is **redacted** (project_dir → length marker). Extract per-project audit BEFORE `/done`.
- **Subjective rating matters more than you think.** Objective metrics can pass while UX is awful. Trust the gut score.

---

## Template

```markdown
## t-YYYY-MM-DD-<slug> — <short task description>

- **Project:** <repo path>
- **Complexity (auto):** simple | medium | complex
- **tests_mode (auto):** tdd | regression-only
- **Wall time:** ~Nm
- **Agents count:** N
- **Verdict:** accepted | rejected | force-closed | abandoned
- **Subjective rating:** N/10

### What worked
- ...

### Gate interaction (real conversation, not log)
- **Gate 0:** [skipped for SIMPLE | approved as-is | asked for re-classification]
- **Gate 1:** [approved as-is | requested revision N times, final approved | rejected]
- **Gate 2:** [accepted | rejected with feedback]

### Bugs found (file as Qxx in roadmap if new class)
- [HIGH|MEDIUM|LOW] <description> — root cause hypothesis — file:line if known — links to roadmap Q-item

### Friction / UX notes (not bugs, but pain points)
- ...

### Objective signals from logs (jq queries)
- `plan_iters`: N
- `impl_iters`: N
- `reviewer_disagreements`: N
- `acceptance_first_pass`: yes | no
- `agents_count by complexity`: <observed vs expected>
- Output size outliers: <agent>: <chars> if >2× mean
- `_repaired` count: N
- `force_used` count: N

### Cost signal (when v2.7 lands, otherwise estimated)
- Token estimate (input/output): <if known>
- USD estimate: <if known>

### Notes
- Anything else worth remembering for future me
```

---

## Entries (newest first)

## Cross-cutting observations (not tied to a single task)

Behavioral patterns surfaced across multiple real-task runs that don't fit into one task entry. Each observation has a corresponding Q-item in `specs/v3-productization-roadmap.md`.

### 2026-05-14 — `task_id` slug derived from task-text preamble, not task essence

**Observed:** Real-task run on s3-panel produced `task_id = "t-2026-05-14-workingdirectoryuser"`. The actual task was a rename refactor (`apps/curator` → `apps/core`), but the slug came from the boilerplate preamble that prefixes every `/task` invocation: *"Working directory: /Users/teaarte/Work/AI-FACTORY/s3-panel ## Context (read first, in this order) ..."*.

**Root cause:** `deriveTaskId` in `mcp/src/driver/tools/run-task.ts` calls `makeTaskId(task)` which slugifies whatever leading text it finds. Real-world `/task` invocations consistently start with a "Working directory:" preamble (added by the Orchestrator skill) so the first slug-friendly token-run is always `"workingdirectoryuser"`, `"workingdirectoryYou"`, etc.

**Effect:** task_id is no longer useful for human recognition or grep-friendly cross-referencing. Q7 fixed the format (schema-valid) but not the semantics. Workaround: caller passes explicit `task_id` to `pipeline_run_task`.

**Not yet filed as a Q-item** — borderline between bug and UX-polish. Could be addressed by either (a) better heuristic in `deriveTaskId` (strip known preamble prefixes; prefer first imperative verb / first `##` heading content), or (b) accept the slug as cosmetic and rely on `task_id` being a database key, not human-readable. Decision deferred — collect 1-2 more runs to confirm preamble pattern is universal before fixing.

---

### 2026-05-14 — `open_spawns[].model` always `null`

**Observed:** Real-task `pipeline-state.json` consistently shows `model: null` on every open-spawn entry:

```json
"open_spawns": [
  {
    "id": "ar-9145be56-9a65-481f-ba32-0d353ab1fb23",
    "agent": "implementer",
    "model": null,
    "started_at": "2026-05-14T02:13:35.977Z"
  }
]
```

**Root cause (traced):** `SpawnRecorder` type signature in `mcp/src/driver/core/fsm.ts:28-32` accepts only `{project_dir, phase, agent}` — no `model` field. `mcpSpawnRecorder` in `mcp/src/driver/tools/run-task.ts:33-40` calls `pipelineBeginAgent` without `model`. `pipelineBeginAgent` defaults `input.model ?? null` (`mcp/src/tools/begin-agent.ts:54`). The model resolved upstream by `resolveAgentModel(plugin, phase, config)` is dropped before reaching the open-spawn record.

**Effect:** post-hoc cost analysis blocked (which model ran which spawn?); v2.7 cost-aware routing has no historical training data; audit trail loses model attribution.

**Filed as Q19** (🟡 MEDIUM, ~1h fix). Three-line code change: extend SpawnRecorder type + thread model through + forward to pipeline_begin_agent. Unit test asserts non-null for each complexity.

---

### 2026-05-14 — Agents `find`-hunting for `templates/schemas/category-vocab.json`

**Observed:** Logic-reviewer (and likely other reviewer/validator agents) running multiple `find` commands in real-task runs trying to locate the vocab file:

```
cat ~/.claude/plugins/cache/*/templates/schemas/category-vocab.json
find ~/.claude -name "category-vocab.json"
find / -path "*/templates/schemas/category-vocab.json"   ← whole filesystem
find ~ -name "category-vocab.json"
```

**Root cause:** agent prompts reference `templates/schemas/category-vocab.json` by **relative path**, which only resolves from the claude-pipeline repo root. Agent is spawned inside the user's project (e.g. `s3-panel/`) → path doesn't resolve → `find` fallback wastes tokens + slow filesystem walks.

**Filed as Q18** (🟡 MEDIUM, ~1-2h fix). Architectural answer: driver embeds vocab inline in prompt at spawn build time. Connects to Q6 (similar SoT principle for output examples).

---

## t-2026-05-14-workingdirectoryuser — apps/curator → apps/core rename refactor (Phase 0.5 Steps 1-2)

> **✓ Closed 2026-05-14.** `/done` ran successfully. Metrics row written to `~/.claude/metrics/pipeline.jsonl` (`verdict: accepted`, 8 agents, 5 reviewer_verdicts preserved). State files cleaned. Q12 + Q13 fixes verified holding. **New issues observed post-`/done`:** Q22 (metrics row has null `tests_mode` / `impl_iters=0` despite 1 revision) and Q23 (architectural — Plan B `pipeline_done_cleanup` MCP tool was deferred; Q14 audit regen recurred as expected). Q14 also recurred (267-byte `mcp-audit.jsonl` stub remains).
>
> **✓ RESOLVED 2026-05-14 by v2.1-polish-bundle (branch `v2.1-polish-bundle`, 9 commits):**
> - Q19 fixed in commit `c114f21` (`fix(driver): Q19 — thread resolved model through SpawnRecorder to open_spawns`).
> - Q20 fixed in commit `e7741d0` (`feat(state): Q20 — add phase field to reviewer_verdicts entries`).
> - Q8 fixed in commit `359f566` (`fix(driver): Q8 — mirror gate decisions from scratch to pipeline-state.gates`).
> - Q11 fixed in commit `c290fb8` (`feat(audit): Q11 — add error_class field for verdict=error categorization`).
> - Q22 fixed in commit `a038293` (`fix(finish): Q22 — extract tests_mode + impl_iters + acceptance_first_pass correctly`).
> - Q23 fixed in commit `dda67cd` (`feat(tools): Q23 — pipeline_done_cleanup MCP tool (closes Q14, supersedes Q12 Plan A)`). Q14 subsumed by Q23 (no more audit-regen stub); Q12 Plan A retired.
> - Q17 fixed in commit `9b35bd3` (`feat(driver): Q17 — auto-detect project stack and persist to pipeline-state`).
> - Q18 fixed in commit `226f994` (`feat(driver): Q18 — embed category vocab inline in agent spawn prompts`). No more file-system `find` hunting.
> - Q21 fixed in commit `eb445e0` (`fix(agents): Q21 — output examples respect header schema constraints`).
> - Bug-list 1-9 from this entry: Q8 ✓, Q9 deferred (needs auth/perf task profile), Q11 ✓, Q17 ✓, Q18 ✓, Q20 ✓, Q21 ✓, Q22 ✓, Q23 ✓.
> - Tests: 209 → 265 (+56). Tool count: 20 → 21. `mcp-audit.jsonl` stub will not recur after Q23 lands.
>
> **+ Q24 hot-fix during polish-bundle real-run validation (2026-05-15):** during the s3-panel run that exercised Q8/Q11/Q17/Q22 fixes in production, Stop hook surfaced a confusing `decision: "block"` message at Gate 0 ("Pipeline is in flight at step STEP 1 with verdict=null. Run /done..."). Pipeline was correctly paused awaiting user input — but the hook didn't check `driver-state.pending_user_answer`. Filed + fixed on the same branch:
> - Q24 fixed in commit (TBD `git log` after this entry) — `hooks/pipeline-stop.sh` reads `driver-state.json:pending_user_answer`; Case 2 block guard requires both `verdict` empty AND no pending answer. 6 vitest tests in `mcp/test/hooks/pipeline-stop.test.ts`.
> - Tests: 265 → 271 (+6). Test files: 38 → 39.
> - Made Q10 (`current_step` stale → message read "STEP 1" while step_index=3) more visible. Q10 stays open as cosmetic.
> - Bonus signal from this run: **Q8 confirmed working in production** — `pipeline-state.gates.gate0 = "approved"` (was always `pending` before).

- **Project:** `~/Work/AI-FACTORY/s3-panel`
- **Complexity (auto):** medium ✓
- **tests_mode (auto):** regression-only ✓ (frontend project; correct)
- **Wall time:** ~40 min (started 01:53Z, Gate 2 reached ~02:33Z)
- **Agents count:** 8 (context: 2, planning: 3, test_first: 0 skipped, implementation: 2, validation: 1)
- **Verdict:** at Gate 2, paused for analysis before `/done`
- **Subjective rating:** 8/10 — first run after v2.1-hotfix shipped; Q7/Q16 fixes verified working end-to-end

### What worked
- **Q7 fix confirmed:** `task_id="t-2026-05-14-workingdirectoryuser"` matches `^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}$`. `pipeline_validate` returns `{ok:true, violations:[]}`.
- **Q16 fix confirmed:** all plugin agents spawned successfully (code-analyzer, planner, logic-reviewer, acceptance — none are CC built-in subagent_types). Without Q16 fix this would have blocked at context phase like t-2026-05-14-blocked-at-context did.
- **INV_012 enforcement working:** `open_spawns` empty across every closed phase (context/planning/implementation). Atomic spawn-record contract held.
- Iterative review loop worked: logic-reviewer iter1 `REQUEST_CHANGES` (2 blocking: `missing-edge-case`, `duplicate-logic`) → revision → iter2 `APPROVE`.
- context-doc-verifier `WARN` (1 non-blocking `claim-mismatch`) — non-blocking flow handled correctly.
- plan-grounding-check `GROUNDED` first try, no replan loop.
- acceptance `PASS` (all 13 ACs).
- Audit log captured 15 MCP calls (~26.5KB) with 11 ok / 4 error — **error rate 27%, down from 48% on first run** (Q11 trend improving).
- 3 structured findings written to `findings.jsonl` with valid agent/severity/category.

### Gate interaction (real conversation, not log)
- **Gate 0:** approved as-is (medium classification confirmed without re-classification).
- **Gate 1:** approved on first plan (no revision; plan-grounding-check passed first try).
- **Gate 2:** **pending** — user requested pre-`/done` analysis before closing.

### Bugs found

1. **🟡 MEDIUM — Q8 RECURRENCE: Gate decisions not mirrored to `pipeline-state.gates`.**
   `driver-state.scratch.gate-0_decision=approve` + `gate-1_decision` present, but `pipeline-state.gates = {gate0:"pending", gate1:"pending", gate2:"pending"}`. `pipeline_finish` will compute `gate1_revisions=0` from missing data. Root cause unchanged — step impl in `builtin/steps/index.ts` not calling `pipelineSetGate`.

2. **🟡 MEDIUM — Q9 RECURRENCE: Code review still under-spawned.**
   - **Implementation phase:** 1/5 reviewers (only `logic-reviewer`; missing challenger, style, security, performance).
   - **Validation phase:** 1 agent (`acceptance` only; missing `plan-conformance` per Global Rule #21, plus optionally UI-consistency / API-contract / playwright depending on touched layers).
   - Confirms hypothesis is real, not first-run noise. Need to inspect `applies_to` decisions + step spawn logic.

3. **🟡 MEDIUM — Q11 RECURRENCE: 4/15 (27%) audit error rate.**
   Two patterns each appearing 2×:
   - `Agent header failed validator/reviewer-output.schema.json validation` (summary_line >100 chars; finding.id wrong pattern; finding.summary >200 chars).
   - `Finding category '<X>' is not in vocab for agent 'logic-reviewer'` (categories `inconsistent-spec` and `plan-incomplete` — not in vocab but sound plausible for logic-reviewer; agent fell back to retry with `other`).
   Without Q11's `error_class` field, these look identical to genuine failures.

4. **🟡 MEDIUM — Q17 RECURRENCE: `pipeline-state.stack` still all `null`/`"unknown"`.**
   `language="unknown"`, all command fields `null`. Unchanged since first run.

5. **🟡 MEDIUM — Q18 RECURRENCE (indirect):** the two rejected vocab categories suggest logic-reviewer didn't have inline vocab at spawn time — same Q18 architectural fix (embed vocab inline) would prevent the agent from inventing categories in the first place.

6. **🟢 LOW — Q20 NEW: `reviewer_verdicts[].phase` field is missing.**
   `pipeline-state.reviewer_verdicts[]` entries have `{agent, iteration, verdict, blocking_issues, non_blocking, past_misses_applied, past_miss_matches, categories_seen}` — **no `phase` field**. logic-reviewer ran in both `planning` and `implementation` phases this run; the two rows are indistinguishable except by `iteration` and order. Should add `phase: Phase` field in `templates/schemas/pipeline-state.schema.json` `reviewer_verdicts` shape and populate from `pipeline_record_agent_run`. Filed as Q20.

7. **🟡 MEDIUM — Q21 NEW: Agents systematically violate output-header schema.**
   Two-of-two reviewer header validation failures: `summary_line > 100 chars` and `findings[].id` doesn't match `^f-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$`. Retry-recovered (agents iterate to satisfy the schema), but each retry burns a Task-tool invocation. Root cause likely the canonical output example in `agents/*.md` either omits the length constraint, or LLMs naturally produce sentences >100 chars for `summary_line`. Two-pronged fix: (a) tighten the agent prompt's example to actually exceed the 100-char limit so LLM sees the constraint actively; (b) consider relaxing the schema if 100 chars is too tight in practice. Connects to Q6 (single source of truth for output examples) and Q11 (would mark as `error_class: "agent-retry-recovered"`). Filed as Q21.

8. **🟡 MEDIUM — Q22 NEW: metrics row in `pipeline.jsonl` has null/wrong fields after `pipeline_finish`.**
   Inspecting the just-written row at `~/.claude/metrics/pipeline.jsonl`:
   ```json
   { "tests_mode": null,    // should be "regression-only" — auto-detected at /task time
     "plan_iters": 0,       // OK — Gate 1 approved first plan
     "gate1_revisions": 0,  // Q8 recurrence — gates never mirrored to pipeline-state
     "impl_iters": 0,       // ❌ should be ≥1: logic-reviewer ran REQUEST_CHANGES → APPROVE = 1 revision
     "acceptance_first_pass": false,  // confusing — acceptance ran ONCE with verdict PASS
     "tests_written": null  // OK for tests_mode=regression-only
   }
   ```
   `tests_mode` and `impl_iters` are clear bugs — metric aggregation by tests-mode / impl-iteration distribution will be broken across runs. `acceptance_first_pass` field semantics are confusing and may need rename or removal. Likely cause: `pipeline_finish` mechanical extraction reads from `pipeline-state.json` but the fields it reads from (tests_mode, iterations) aren't being maintained during the run, OR the extraction logic is bugged. Need to inspect `mcp/src/tools/finish.ts` extraction logic + verify source-of-truth fields in pipeline-state. Filed as Q22.

9. **🟡 MEDIUM — Q23 NEW (architectural): `/done` cleanup should go through a dedicated MCP tool, not Bash `rm` via guard-unlock window.**
   Current Q12 fix (Plan A) keeps cleanup logic in `commands/done.md` markdown and uses the unlock_writes/relock_writes dance + `Bash rm -f`. Real-run revealed three correlated issues:
   - User noticed cleanup is done via `Bash(rm -f ...)` and questioned the design — guard exists to prevent raw writes, then we open a 300s bypass window to do raw writes anyway.
   - Q14 (audit regen) recurred exactly as predicted: 267-byte `mcp-audit.jsonl` stub left behind because `pipeline_relock_writes` audits itself AFTER `rm` deleted the audit file.
   - File-list maintenance lives in markdown — drifts from MCP-side reality (e.g., new state files don't auto-extend cleanup).

   Original Q12 spec acknowledged Plan B (dedicated MCP tool) as "preferred". Filing as Q23 with explicit supersession path: implement `pipeline_done_cleanup({project_dir})` MCP tool that (a) runs entirely server-side, (b) deletes `mcp-audit.jsonl` LAST after all internal state writes, (c) needs no guard bypass at all (it's an MCP-internal operation). This will close Q14 automatically and let `commands/done.md` shrink to ~5 lines.

### Post-`/done` verification snapshot

- ✓ State files removed: `plan.md`, `pipeline-state.json`, `pipeline-state-summary.md`, `findings.jsonl`, `driver-state.json`, `context-doc.md`, `analyzer-claims.json` — all gone.
- ✓ `.mcp-bypass-allowed` removed by `pipeline_relock_writes` (Q13 fix held).
- ✓ `settings.local.json` preserved (Claude Code project settings, correctly out of scope).
- ⚠️ `mcp-audit.jsonl` regenerated as 267-byte stub (Q14 recurrence; will be closed by Q23).
- ✓ Metrics row written to `~/.claude/metrics/pipeline.jsonl` (5 reviewer_verdicts preserved, verdict=accepted) — but with field gaps (Q22).

### Friction / UX notes (not bugs, but pain points)

- **task_id slug semantics:** generated slug = `workingdirectoryuser` — derived from the first words of the task description, which began with the boilerplate preamble *"Working directory: /Users/teaarte/Work/AI-FACTORY/s3-panel ## Context (read first, in this order) ..."*. The actual task ("rename apps/curator to apps/core") never surfaces in the id. Q7 fix made the format valid; semantics still noisy. Workaround: pass explicit `task_id` to `pipeline_run_task`. Cross-cutting observation added below.
- `driver-state.step_history_len: 0` even though `step_index=20`. Either step_history isn't being persisted by `writeDriverState`, or it lives in a different key. Worth checking before relying on it for crash recovery.

### Objective signals from logs (jq queries)

- `plan_iters`: 1 (plan-grounding-check GROUNDED first try)
- `impl_iters`: 2 (logic-reviewer REQUEST_CHANGES → APPROVE)
- `reviewer_disagreements`: 0 (challenger didn't spawn — Q9)
- `acceptance_first_pass`: yes
- `agents_count by complexity`: 8 (observed) vs ~12 expected for MEDIUM (5 reviewers in impl + plan-conformance/UI/API in validation) — Q9 deficit
- Output size outliers: not measurable directly (audit captures call meta, not payload sizes)
- `_repaired` count: 0 (no JSON-header repairs needed this run)
- `force_used` count: 0

### Cost signal
- Token estimate: ~not measured (Q19 makes per-spawn model attribution impossible; Q17 makes stack-aware estimation impossible)
- USD estimate: n/a until v2.7

### Notes
- This is the **first end-to-end successful run** after v2.1-hotfix. Q7 and Q16 fixes are verified in production conditions.
- Pipeline reached Gate 2 cleanly with `pipeline_validate ok:true` — `/done` should record a metrics row without recovery needed.
- Next real-task validation should consciously cover: (a) a task that should spawn challenger/style/security/performance (auth or perf-sensitive change) to nail Q9; (b) a task that touches API to verify `applies_to` predicate works at all.

---

## t-2026-05-14-blocked-at-context — second real-task attempt, blocked at context phase

> **✓ RESOLVED 2026-05-14 by v2.1-hotfix bundle:**
> - Q16 fixed in commit `98b9f45` (`fix(driver): Q16 — force subagent_type=general-purpose for Task tool`).
> - Q7 fixed in commit `4ea0c9f` (`fix(init): Q7 — sanitize task_id slug to match schema pattern`).
> - Q12 fixed in commit `4e2527b` (`fix(done): Q12 — wrap cleanup with pipeline_unlock_writes/relock_writes`).
> - Q15 added new tool `pipeline_fix_task_id` in commit `baa253e` for clean task_id recovery.
> - Q13 subsumed by Q12 (`pipeline_relock_writes` already unlinks the bypass marker).
> - Tests: 180 → 209 (+29). Pipeline now functional end-to-end for real tasks.
> - Remaining Q-items (Q8, Q9, Q10, Q11, Q14) deferred to v2.1 polish bundle.

- **Project:** `~/Work/AI-FACTORY/s3-panel` (likely; second `/task` attempted)
- **Complexity (auto):** medium (presumed — didn't reach Gate 0 confirmation)
- **Wall time:** <5min — blocked before context enrichment completed
- **Verdict:** **INCOMPLETE — never reached Gate 1.** Context phase failed to spawn `code-analyzer`, then `context-doc-verifier`. Pipeline stuck on `pipeline_begin_agent` succeeding but the subsequent `Task` tool invocation failing.
- **Subjective rating:** N/A — couldn't run.

### What worked
- `pipeline_begin_agent` succeeded (open_spawn registered, agent_run_id minted).
- Driver correctly proceeded to issue shuttle response with `claude_code_task` payload.

### What failed
- Shuttle invoked `Task` tool with `subagent_type: "code-analyzer"` and later `subagent_type: "context-doc-verifier"`.
- Claude Code's `Task` tool rejected both with: *"Agent type '<X>' not found. Available agents: claude-code-guide, Explore, fe-test-all-agent, general-purpose, Plan, runtime-debug-agent, statusline-setup, test-all-agent"*.

### Bug found — Q16 (NEW, 🔴 CRITICAL — see roadmap)

The driver's spawn payload puts the AgentPlugin name (`code-analyzer`, `context-doc-verifier`) as Claude Code's `subagent_type`. But CC's `Task` tool only accepts its internal subagent_type catalog — none of our plugin names match.

**v2 design intent:** `subagent_type` should always be `"general-purpose"` (CC's catch-all), and the actual AgentPlugin role + template content lives in the **prompt text**. Currently broken somewhere in `mcp/src/driver/builtin/spawn/shuttle-provider.ts` or whichever code constructs `claude_code_task`.

**Severity: CRITICAL.** Blocks all real-task validation. Any agent whose plugin name doesn't accidentally match CC's catalog (= ~all of them) → spawn fails → pipeline stuck.

### Action items
- **Cannot continue validation until Q16 is fixed.** Other Q-items don't matter if no task can complete.
- This blocked task should be **abandoned** (`pipeline_abandon`) — state has dangling open_spawns from failed Task invocations, no clean recovery.
- v2.1 priority restructured: **Q16 first as standalone hotfix**, ~1-2h. Then continue validation. Q1-Q15 stay bundled for the later polish round.

### Recovery for current state
1. `pipeline_abandon({project_dir, reason: "Q16 blocks all spawns — no recovery"})` 
2. After Q16 hotfix lands → resume validation with fresh `/task`.

## t-2026-05-13-gateway-ui-gateway-orval-tanstaack-query — Phase 0.5 gateway scaffolding

> **✓ Bugs from this run resolved 2026-05-14 by v2.1-hotfix bundle:**
> Q7 (`4ea0c9f`), Q12 (`4e2527b`), Q15 (`baa253e`). Q13 subsumed by Q12.
> Remaining unfixed: Q8 (gate mirror), Q9 (review under-spawning), Q10 (current_step stale), Q11 (audit error_class), Q14 (audit regen) — bundled into v2.1 polish round.

- **Project:** `~/Work/AI-FACTORY/s3-panel`
- **Complexity (auto):** medium ✓
- **tests_mode (auto):** regression-only ✓ (frontend project, correct)
- **Wall time:** ~3 hours
- **Agents count:** 8 (context: 2, planning: 3, implementation: 2, validation: 1)
- **Verdict:** paused at Gate 2 (not yet closed — waiting for analysis)
- **Subjective rating:** 7/10 (first real run; system reached Gate 2 successfully but multiple v2 bugs surfaced)

### What worked
- Pipeline auto-classified complexity correctly (medium for gateway+orval+tanstack work).
- `tests_mode: regression-only` auto-detected for frontend repo — correct.
- 5 reviewer verdicts recorded (context-doc-verifier `VERIFIED`, plan-grounding-check `PASS_WITH_WARNINGS`, logic-reviewer × 2 `REQUEST_CHANGES`, acceptance `PASS`).
- Plan-revision loop triggered when user asked for clarification — 2nd logic-reviewer iteration ran.
- Atomic spawn-record contract worked — `open_spawns[]` empty in every phase, 8 agents cleanly accounted.
- 29 structured findings collected (5 blocking + 7 warn + 17 info).
- Audit log captured 21 MCP calls (~92K total, well under cap).
- Driver correctly paused at `gate-2` after impl + reviews + validation.

### Gate interaction (real conversation, not log)
- **Gate 0:** approved as-is (auto for SIMPLE; for MEDIUM was confirmed quickly).
- **Gate 1:** **rejected initial plan, asked for clarification + revision; pipeline re-ran planner; eventually accepted revised plan.** This caused 2× logic-reviewer iterations on the plan (correct behavior). May have contributed to under-spawning in code review phase (see bug #3 below).
- **Gate 2:** **pending — user noticed bugs in state before closing.**

### Bugs found

1. **🔴 HIGH — Q7: `pipeline_init` slug sanitization broken.**
   `task_id` came out as `t-2026-05-13-gateway-ui-gateway-orval-tanstaack-query` — contains hyphens (schema expects `[a-z0-9]{4,}` alphanumeric-only after date) AND has typo "tanstaack" instead of "tanstack". `pipeline_validate` already catches this as `INV_SCHEMA_STATE`. Will block `pipeline_finish` at `/done`. Fix: `mcp/src/tools/init.ts` slugifier must replace hyphens/underscores with empty string, lowercase, strip non-alphanumeric.

2. **🟡 MEDIUM — Q8: Gate decisions stored in driver scratch but not mirrored to `pipeline-state.gates` via `pipeline_set_gate`.**
   `driver-state.json:scratch` has `gate-0_decision` and `gate-1_decision` keys. But `pipeline-state.json:gates` shows all three gates as `"pending"`. Driver records the user's gate answer locally in scratch but never propagates to canonical state. Consequences: metrics row at `/done` shows `gate1_revisions: 0` (even though plan was actually revised), `INV_005`/`INV_006` never fire for these tasks (because gates never reach `"approved"`), observability lost. Fix: gate steps (`builtin/steps/index.ts`) must call `pipelineSetGate` after capturing the user answer.

3. **🟡 MEDIUM — Q9: Code review under-spawned.**
   `MEDIUM` flow per spec should spawn 5 parallel reviewers (logic + challenger + style + security + performance). In this run, implementation phase has only **2 agents** (implementer + logic-reviewer). `__spawn_issued_review` is in scratch — review step ran — but only spawned one reviewer. Two hypotheses:
   - `applies_to` predicates for challenger / style / security / performance returned false. `security_needed` could plausibly be false (no auth-related diff for gateway scaffolding), but challenger and style should always run on MEDIUM.
   - Review step has a code bug — calls `spawnOne` instead of `spawnAgentsParallel`. Need to inspect `mcp/src/driver/builtin/steps/index.ts` review step impl.
   - **Possible interaction with the Gate 1 revision loop**: did the revised plan reset `decisions.security_needed`? If so, that's a third hypothesis.
   Effect: code review coverage was reduced to logic-reviewer alone for this task. Real quality risk.

4. **🟢 LOW — Q10: `current_step` field in `pipeline-state.json` stays stale.**
   Shows `"STEP 1"` while phases context/planning/implementation are `completed` and validation is `in_progress`. The v2 driver updates FSM state in `driver-state.json:step_index` and leaves `pipeline-state.json:current_step` untouched. Either the v2 driver should update it, or the field is obsolete and should be removed from the schema.

6. **🟡 MEDIUM — Q17: `pipeline-state.json:stack` fields never populated.**
   Inspection of `pipeline-state.json` post-run shows:
   ```json
   "stack": {
     "language": "unknown",
     "package_manager": null,
     "test_command": null,
     "lint_command": null,
     "build_command": null,
     "project_type": null
   }
   ```
   Despite the s3-panel project having clear stack indicators (CLAUDE.md "Stack" section: React 19 + TypeScript 5.7 + pnpm + Vitest + Rsbuild; package.json with `pnpm` workspaces; etc.). `pipeline_init` accepts a `stack` parameter (per `smoke.ts` fixture), but the v2 driver entry doesn't compute it pre-flight. Agents receive all-null `project_stack` context → reference loading degraded; metrics row in `pipeline.jsonl` carries useless stack info for cross-stack `/learn` analysis. **Effort ~2-4h** — add stack-detection helper + wire into driver's pre-flight before `pipeline_init`. **See roadmap Q17.**

5. **🟢 LOW — Q11: 10/21 `pipeline_continue_task` calls returned `verdict: "error"`.**
   Half of continue-task calls errored; last call succeeded so pipeline recovered. Likely combination of (a) JSON-parse retries via soft parser, (b) `closePriorPhases` swallowed `INV_002/010/011` during phase boundary crossings, (c) `INV_011` prereq check fires when step tries to begin agent before prior phase recorded as `completed`. Audit log has the errors:
   ```bash
   jq 'select(.verdict == "error") | {ts, tool, error}' .claude/mcp-audit.jsonl
   ```
   Investigate categorically: are they all known-safe swallows, or are some real signal?

### Friction / UX notes
- Plan revision at Gate 1 worked but: the second plan came back without clear indication of what changed vs first. Would be useful to see a "diff against previous plan" at Gate 1 on re-presentation.
- Gate 2 message says "Accept (verdict=accepted) or reject (verdict=rejected) with feedback" — no summary of what was actually done. User has to read findings + diff separately to decide. Should include 1-paragraph summary of completed work inline.
- No way to see live progress while pipeline runs (SSE live stream is v2.5 Web UI work). Currently feels like a black box for the ~3 hours.

### Objective signals from logs
- `plan_iters`: 2 (one revision after Gate 1 rejection — correct)
- `impl_iters`: 1
- `reviewer_disagreements`: 0
- `acceptance_first_pass`: yes (acceptance ran after impl and passed first try)
- `agents_count by complexity`: 8 actual vs ~10-13 expected for MEDIUM (under-spawned, see Q9)
- Output size outliers: not measured in this run
- `_repaired` count: not measured (would require jq on audit args_summary)
- `force_used` count: 0 (no force_bypass in this run)

### Cost signal
- Used Claude Code subscription (no per-token tracking yet — v2.7).
- Subjective: felt expensive given ~3h wall time. Will measure properly when v2.7 lands.

### Notes
- This is the FIRST real-task run of v2 framework. Bug count is expected to be high — that's the point of validation phase.
- All bugs found here are **post-shipping** discoveries, not pre-shipping misses. v2 acceptance criteria all passed; these are corner cases real-use surfaces.
- The Gate-1 revision flow worked semantically but observability got lost (Q8). User had to ask "did the pipeline actually record that I revised?" — answer was "no, only in scratch".
- Need a clear `/task` UX for "I want to discard this run and start over without losing pipeline state for analysis" — would have been useful when bugs surfaced.

**Action items next:**
- Add Q7-Q11 to roadmap `v2.1 code-polish round` (doing now in same commit).
- Close this task: recover via `pipeline_unlock_writes` + manual `task_id` fix, then `/done`. Or `pipeline_abandon` if not worth saving the state. Decide based on whether you want this run's metrics row in `pipeline.jsonl` (yes for analysis later, no if the metrics row is itself corrupt-shaped).
- Run 2-4 more real tasks in next 1-2 weeks before deciding on v2.1 fix priorities.

### `/done` execution observations (added retrospectively after running /done)

Recovery path was actually taken: `pipeline_finish` failed on task_id as predicted (Q7 confirmed). Agent applied Recovery B (force-close after manual fix). Worked end-to-end, but surfaced **3 new UX bugs** in the `/done` flow itself:

- **Final task_id:** `t-2026-05-13-gwarchspec` (manually written via Python edit; 10-char alphanumeric slug, schema-valid). Metrics row appended successfully.
- **Final verdict:** `accepted`.

#### Q7+ (extension of existing Q7) — Manual task_id fix has no clean recovery primitive

The recovery required this 4-step dance:
1. `mcp__claude-pipeline__pipeline_unlock_writes({ttl_seconds: 300, reason: "fix corrupt task_id"})`
2. `python3 -c "..."` to load JSON, mutate `task_id`, write back
3. `mcp__claude-pipeline__pipeline_relock_writes`
4. Re-call `pipeline_finish`

This works but is hostile UX. Q7's main fix (proper slugifier in `pipeline_init`) prevents the bug. The **additional** recommendation: provide `pipeline_fix_task_id({project_dir, new_task_id, reason})` as a clean recovery MCP tool. Auto-validates new id against schema, audits the change, no python hack needed.

#### Q12 🟡 MEDIUM — `/done` cleanup blocked by guard hook (chicken-and-egg)

`/done` skill ran `rm -f .claude/pipeline-state.json .claude/findings.jsonl ...` — **the guard hook correctly blocked it** because those paths are MCP-managed. Error message says `"/done re-locks automatically"` but the recovery was manual:
- Agent called `pipeline_unlock_writes` first
- Then ran `rm` (succeeded)
- `pipeline_relock_writes` did NOT auto-delete the `.mcp-bypass-allowed` marker → orphan (see Q13)

**Root cause:** `commands/done.md` skill markdown describes a `rm`-based cleanup. But the guard added in v2 doesn't let `rm` touch protected files. The skill needs updating to call `pipeline_unlock_writes` before the `rm` block, or — cleaner — to use a new `pipeline_done_cleanup({project_dir})` MCP tool that does the deletion server-side without guard interaction.

**Effort:** ~1h. Fix `commands/done.md` skill markdown, OR (preferred) add `pipeline_done_cleanup` MCP tool.

#### Q13 🟢 LOW — `.mcp-bypass-allowed` orphan after /done

Agent ran first `rm` batch → all files gone except `.mcp-bypass-allowed`. Required a separate `rm -f .claude/.mcp-bypass-allowed`. **Root cause:** `/done` cleanup list in `commands/done.md` doesn't include this marker filename. **Or:** the unlock that happened during cleanup re-created it. Easy fix: add `.mcp-bypass-allowed` to the cleanup list. Better fix: `pipeline_relock_writes` should auto-delete the marker (verify it does — Q12 implementation may make this moot).

**Effort:** ~10min. Update `commands/done.md` cleanup file list, or fix `pipeline_relock_writes` to delete the marker.

#### Q14 🟢 LOW — `mcp-audit.jsonl` regenerates during cleanup (267-byte stub orphan)

After `/done` cleanup, `.claude/` contained only `settings.local.json` AND a fresh 267-byte `mcp-audit.jsonl`. This stub got created by the cleanup process itself — every MCP call (unlock, relock, finish) appends to the project-local audit. So cleaning `mcp-audit.jsonl` early in the cleanup just gets it re-created by subsequent cleanup-process MCP calls.

**Root cause:** Loop ordering. Either: (a) delete `mcp-audit.jsonl` LAST after all other MCP calls done, (b) have `/done` route its own audit entries to global stream only (with a `tool: "done:cleanup"` marker), (c) have `pipeline_done_cleanup` (proposed in Q12) do the file deletion inside one MCP call that doesn't re-emit audit until after the deletion.

**Effort:** ~30min. Tied to Q12 — same fix probably resolves both.

### Cumulative bug count from this single task

Initial findings: 5 (Q7-Q11).
Post-/done findings: +3 (Q12-Q14) plus Q7 extension.

**Total: 8 distinct v2 bugs surfaced from one real task run.**

This is high — but expected for a first real-task validation. The pattern is healthy:
- Q7 is the only blocker that hurts every task (schema-violation task_id → can't finish without recovery).
- Q8, Q9 are quality-of-output bugs (gates lost in metrics, review under-spawned).
- Q10-Q14 are friction / UX bugs that don't break correctness but hurt the experience.

Priority signal: **fix Q7 first** (single point of failure for /done). The rest can wait for bundled v2.1 polish round.
