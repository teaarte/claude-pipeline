# Validation Log

Personal journal of real-task `/task` runs on actual projects (not on claude-pipeline itself). Captures both **objective metrics** (from MCP-managed JSONL streams) and **subjective UX notes** that logs cannot capture.

Drives `specs/v3-productization-roadmap.md` "Validation-driven v2.1 backlog" section. Each bug surfaced here → Q-numbered roadmap item.

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

## t-2026-05-13-gateway-ui-gateway-orval-tanstaack-query — Phase 0.5 gateway scaffolding

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
