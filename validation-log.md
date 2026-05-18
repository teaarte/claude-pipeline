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
- **Same friction point** (UX, not bugs) → candidate for v2.3 UX improvement.
- **Same recovery path used repeatedly** (e.g., `pipeline_unlock_writes` for state fixes) → friction signal that v2 needs softer recovery UX.
- **Cost trajectory** when v2.5 lands — if costs grow per task, investigate before v2.3 ships.
- **Vocab evolution (Q29 loop):** when a real-task run produces multiple findings with `category: "other"` AND the agent's narrative (or `proposed_new_category`) clearly names a better label, propose the new category in **this** entry's "Bugs found" block (or a dedicated "Vocab proposals" bullet). Format: `vocab[<agent>]: add "<new-category>" — example: <task-id finding context>`. Promote into `templates/schemas/category-vocab.json` once a category clears ≥1 real-task occurrence + human confirmation; the promotion goes in the next polish bundle as a one-line vocab edit.

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

### Cost signal (when v2.5 lands, otherwise estimated)
- Token estimate (input/output): <if known>
- USD estimate: <if known>

### Notes
- Anything else worth remembering for future me
```

---

## Closed tasks (newest first)

Per-task entries live in `validation/closed-tasks/`. Each file is a self-contained snapshot of one real-task `/task` run with verifications, recurrences, new Q-items surfaced, and notes for future-me. Listed newest-first below.

| Date | task_id | Project / scope | Verdict | File |
|---|---|---|---|---|
| 2026-05-19 | (bundle) | **v2.2.5-followups** — code-review fix bundle (13 HIGH + 16 MEDIUM + 6 LOW; H1+H2 closed regressions in v2.2.5 Items 7 + 8) | accepted | [closed-tasks/2026-05-19-v2.2.5-followups.md](validation/closed-tasks/2026-05-19-v2.2.5-followups.md) |
| 2026-05-18 | `t-2026-05-18-implementphase07step` | **frontend-core** — Phase 0.7 Step 1 module-contract overlay primitives (1st run on v2.2.5+followups branch; 8 blockers caught at gate-1; surfaced 5 observations now Items 6-10 of v2.2.6 + Q63) | accepted (force-final) | [closed-tasks/2026-05-18-frontend-core-phase07-step1.md](validation/closed-tasks/2026-05-18-frontend-core-phase07-step1.md) |
| 2026-05-17 | `t-2026-05-17-c797` | **frontend-core** — doc drift fix + module-contract test wiring (3rd project full fan-out; surfaced 8 new Q-items + classifier-agent shuttle-path insight) | accepted (force) | [closed-tasks/2026-05-17-frontend-core-doc-drift.md](validation/closed-tasks/2026-05-17-frontend-core-doc-drift.md) |
| 2026-05-14 | `t-2026-05-14-31fb` | **wandr-be** — tech-debt cleanup sweep (first non-frontend, first non-English, first full-fan-out) | accepted | [closed-tasks/2026-05-14-wandr-be-techdebt-sweep.md](validation/closed-tasks/2026-05-14-wandr-be-techdebt-sweep.md) |
| 2026-05-14 | `t-2026-05-14-addauthtokendecodert` | s3-panel — auth-token decoder in core bootstrap | accepted | [closed-tasks/2026-05-14-addauthtokendecodert.md](validation/closed-tasks/2026-05-14-addauthtokendecodert.md) |
| 2026-05-14 | `t-2026-05-14-contextreadfirstinth` | s3-panel — Phase 0.5 Step 4 `_demo-contract` | accepted | [closed-tasks/2026-05-14-contextreadfirstinth-step4.md](validation/closed-tasks/2026-05-14-contextreadfirstinth-step4.md) |
| 2026-05-14 | `t-2026-05-14-workingdirectoryuser` | s3-panel — Phase 0.5 Steps 1-2 rename `apps/curator` → `apps/core` | accepted | [closed-tasks/2026-05-14-workingdirectoryuser.md](validation/closed-tasks/2026-05-14-workingdirectoryuser.md) |
| 2026-05-14 | `t-2026-05-14-blocked-at-context` | s3-panel — second real-task attempt, blocked at context phase by Q16 | INCOMPLETE | [closed-tasks/2026-05-14-blocked-at-context.md](validation/closed-tasks/2026-05-14-blocked-at-context.md) |
| 2026-05-13 | `t-2026-05-13-gateway-ui-gateway-orval-tanstaack-query` | s3-panel — Phase 0.5 gateway scaffolding (first real run, surfaced Q7-Q15) | accepted | [closed-tasks/2026-05-13-gateway-ui.md](validation/closed-tasks/2026-05-13-gateway-ui.md) |

When adding a new entry: create `validation/closed-tasks/<date>-<short-slug>.md` (date in `YYYY-MM-DD`), add a row to the table above. Use the **Template** above as the entry shape.


## Cross-cutting observations (not tied to a single task)

Behavioral patterns surfaced across multiple real-task runs that don't fit into one task entry. Each observation has a corresponding Q-item in `specs/v3-productization-roadmap.md`.

### 2026-05-17 — full fan-out stable across 3 projects + classifier-agent unlocked LLM cluster (frontend-core run)

**Observed:** Third real-task run with v2.2a delivered the same 4-reviewer implementation-phase fan-out shape as wandr-be. s3-panel × 5 (pre-v2.2a, 2 reviewers) → wandr-be × 1 (4 reviewers, full vocab) → frontend-core × 1 (4 reviewers, `acceptance_first_pass: true`). The "5× review depth" v2.2a target is now validated on 3 different TypeScript-monorepo project shapes (backend / Mantine-frontend / Rsbuild-frontend).

**Strategic insight surfaced during session:** classifier-agent for LLM-classification cluster (Q41 refs / Q44 antipattern / Q46 task_short / Q58 security_needed) **does not require v2.3 daemon's direct-API SpawnProvider**. It works as a regular agent spawn via existing shuttle infrastructure — Claude Code's Task tool already does the LLM work. The "wait for v2.3 daemon" assumption was inertia from the Q41 author's original design intent, not an architectural requirement. Tracing the spawn lifecycle proved this concretely.

**Effect on roadmap:** Q41 / Q44 / Q45 / Q46 / Q58 / Q61 promoted from "LLM-blocked / wait v2.3" to "scheduled v2.2.5 Item 9". The shuttle-classifier path is canonical; direct-API `query?()` remains an optional accelerator for non-CLI channels (Web UI, Telegram, headless) in v2.3+.

**Architectural principle refined into 3 categories** (per [`specs/product-vision.md`](specs/product-vision.md)):
1. Deterministic code
2. **Restructure input to eliminate classification** (NEW — gate-answer V1 / antipattern marker convention)
3. Code + LLM picking from candidates

User crystallized this during session push-back on multilingual gate-answer regex: "Pure code for deterministic. Restructure where possible. LLM picking when input is irreducibly free-form." Filed Q57 (gate-answer structural fix) + Q59 (antipattern marker) as Category 2 examples; Q41/Q44/Q46/Q58/Q61 as Category 3 cluster via `pickFromCandidates` primitive.

**8 new Q-items filed** (Q48 / Q50 / Q51 / Q52 / Q53 / Q54 / Q55 + Q57 / Q58 / Q59 / Q60 / Q61). Bundled into v2.2.5 items 8-11 — original 7 substrate commits extend to 11 total. **Q49 reserved-then-superseded** by Q57 (don't recycle).

**Q48 (metric observability dropdown)** is the most strategically valuable filing — `pipeline.jsonl` doesn't carry `force_used` / `pipeline_violation` / `started_at` / `ended_at` / `gate2_revisions` / `reviewer_count`. Long-term cross-project analysis blind to force-bypass rate. Pure deterministic fix in `finish.ts`.

### 2026-05-14 — v2.2a "review-completeness" bundle landed (resolution block)

Six validation-driven Q-items shipped on branch `v2.2a-review-completeness` as one PR (6 commits, ordered easy → architectural):

- **Q43** `cda5046` — `impl_iters` / `plan_iters` derive by `count(verdicts WHERE phase=X)`, not `max(iteration)`. Legacy fallback dropped.
- **Q42** `39ff1a9` — `task_id` slug collisions resolve via `-[a-f0-9]{4}` suffix; `TASK_ID_PATTERN` relaxed (additive). New `makeUniqueTaskId()` in `mcp/src/lib/ids.ts`.
- **Q41** `a810dbe` — refs become self-describing (YAML frontmatter on all 25 `agents/references/*.md`); `DecisionPlugin.decide()` accepts optional `DecisionContext{active_agents, spawn_provider}`; `SpawnProviderPlugin.query?()` added (optional one-shot LLM classification); refs-to-load is LLM-driven when `query()` is present, regex-fallback otherwise. Hand-rolled frontmatter parser, no new runtime dep.
- **Q9** `f806977` — pre-review step invokes `security_needed` / `ui_touched` / `api_touched` decisions; review step fans out via `spawn-agents-parallel` (logic + challenger + style + security + performance, filtered by `applies_to`) for non-simple flows. SIMPLE flow keeps single logic-reviewer.
- **Q30** `82cf886` — `set-phase-status.ts` at planning-close reads `driver-state.json` and copies `decisions.refs_to_load` → `state.refs_loaded` (+ `refs_dropped_due_to_cap`). Missing driver-state degrades silently.
- **Q27** `da3952d` — four hooks (`git-diff-snapshot`, `load-past-misses`, `anti-pattern-grep`, `caller-context-expand`) emit the documented files at `before-step` on `review`. Each falls back to an explicit stub when its source is empty.

**Final acceptance:** 343 tests / 45 files (baseline 295/41). `pnpm typecheck`, `pnpm test`, `pnpm smoke`, `pnpm smoke:orchestrator` all green per commit. Framework-purity grep gate over `mcp/src/driver/core/` still empty. Tool count unchanged at 21.

**Real-task verification: pending.** Recommended next validation run: a task touching security + UI + API simultaneously (e.g. "password-change form + /api/auth/password endpoint + rate-limit + form validation") to exercise the full reviewer fan-out + all four pre-review files in a single MEDIUM/COMPLEX task. Expected: 5 reviewers in implementation + 4+ validators (acceptance / plan-conformance / UI-consistency / API-contract). Q41's LLM classification path requires a `SpawnProviderPlugin.query()` implementation — the shipped shuttle provider leaves it `undefined`, so refs-to-load currently uses the regex fallback. Wiring a real `query()` implementation (Anthropic SDK direct call) is out of scope for v2.2a and tracked separately.

### 2026-05-14 — Bash-tool subprocess has no TTY (assumption invalidated)

**Observed:** Attempted to ship `scripts/set-tab-title.sh` that emits OSC-0 escape (`\033]0;<title>\007`) to `/dev/tty`, intended to be called from `commands/task.md` / `commands/done.md` via Claude Code's Bash tool, to auto-rename the user's terminal tab to `<project> · <task_id>`. Smoke test in the planning Claude Code session itself returned:

```
scripts/set-tab-title.sh: line 44: /dev/tty: Device not configured
```

**Root cause:** Claude Code's Bash tool spawns subprocesses via `child_process.spawn()` with stdin/stdout/stderr piped to the parent process — **no pseudo-terminal allocation**. The subprocess therefore has no controlling terminal, so writes to `/dev/tty` fail. `[ -w /dev/tty ]` returns true (the device file exists with correct mode bits) but the actual `open()` fails because there's no TTY association.

**Implication:** **Any script invoked via Bash tool that needs to write side-channel output to the user's terminal cannot do so.** This rules out:
- Terminal tab title (OSC-0)
- Terminal bell / alert (`\a`)
- Cursor position / progress bars via ANSI
- Any other terminal-escape-based UX

Stderr and stdout reach the user only via Claude Code's chat rendering — they are captured and re-displayed, not passed through to the underlying terminal.

**Filed as Q38** (🟢 LOW, deferred to v2.3 Web UI). Underlying user need (*"what's running where, on which task"*) better served by browser-tab + Web UI navigation rather than terminal-escape tricks. Workaround for current users: shell function in `.zshrc` that reads `.claude/pipeline-state.json` and emits OSC-0 from a real shell context (not via skill / not via Bash tool).

**Pattern lesson:** Before designing a feature that depends on a side-channel from inside a Claude Code subprocess context (Bash tool, hook, MCP server), **smoke-test the channel availability first.** Don't infer from `[ -w /dev/path ]` style permission checks — those don't catch "device exists but no TTY association" errors. Run an actual write + check exit status.

---

### 2026-05-14 — v2.2-clear-bundle resolution (10 of the 13 remaining v2.1 Q-items closed)

Shipped as a single-session bundled fix on branch `v2.2-clear-bundle`. One commit per Q-item, all four gates (typecheck / test / smoke / smoke:orchestrator) green per commit.

**Schema deprecations** (legacy v1 fields the v2 driver never maintained — `reviewer_verdicts[]` / `gates` / `driver-state.json` are the actual sources of truth):
- **Q10** `pipeline-state.current_step` removed; Stop hook now reads `flow_name + step_index` from `driver-state.json` and emits `flow=… step=…` (or `unknown`) instead of the always-stale `"STEP 1"`.
- **Q31** `phases.{planning,implementation}.iterations` removed; `record-nonreview-agent` no longer writes the field; `finish.ts` `impl_iters/plan_iters` derive purely from `reviewer_verdicts[].iteration`.
- **Q32** `phases.validation.acceptance_first_pass` removed; `finish.ts` no longer falls back to it.
- **Q34** `phases.planning.grounding_check` removed; summary template swapped to `grounding_mismatches` (still populated).

**Population fixes** (filling in fields the schema documented but v2 never wrote):
- **Q33** `state.files.{created,modified}` populated from `git diff --name-status HEAD` at implementation-close. New `mcp/src/lib/git-diff.ts` helper; degrades to empty + `error_class: "git-unavailable"` audit entry on non-repo dirs.
- **Q37** `pipeline.jsonl` metrics row now carries `state.stack` (was always `null`).

**Detector polish**:
- **Q26** `stack-detect` parses CLAUDE.md `Validation Commands` first (priority over `package.json scripts`) with a broader regex covering bullet/bold/colon-inside-bold variants. `pnpm-workspace.yaml` / `lerna.json` / `nx.json` / `turbo.json` markers classify the root as `monorepo` (new 4th `project_type` enum value, propagated to 4 consumers); positive frontend/backend signal still wins over monorepo.

**Prompt + vocab + docs**:
- **Q28** all 13 reviewer/validator templates carry a 4th "Output constraints" bullet naming `findings[].schema_version` as required.
- **Q29** `logic-reviewer` vocab adds `spec-deviation`, `scope-creep`, `coverage-gap`; new `category-vocab.json.md` change-notes companion; validation-log Step 5 grew a *Vocab evolution* sub-bullet.
- **Q25** docs-only — `mcp/README.md` gains a *First-time project setup* section recommending `Write(.claude/**)` pre-approval in `settings.local.json`; `commands/task.md` points readers to it.

**Test surface**: 274 → 295 (+21 net). New files: `test/lib/category-vocab.test.ts`, `test/lib/git-diff.test.ts`. Schema/deprecation regression assertions in `finish.test.ts`, `init.test.ts`, `record-nonreview-agent.test.ts`, `record-agent-run.test.ts`, `pipeline-stop.test.ts`.

**Still open from the v2.1 backlog**: Q9 (review under-spawning), Q27 (pre-review infra), Q30 (refs-to-load) — deferred to v2.2a *review-completeness* bundle (needs a fresh auth/perf real-task run to confirm fan-out fires end-to-end). Q1-Q6 code-quality items remain in v2.2-code-polish.

---

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

**Effect:** post-hoc cost analysis blocked (which model ran which spawn?); v2.5 cost-aware routing has no historical training data; audit trail loses model attribution.

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
