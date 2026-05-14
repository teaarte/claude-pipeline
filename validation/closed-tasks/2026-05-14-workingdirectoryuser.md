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
- USD estimate: n/a until v2.5

### Notes
- This is the **first end-to-end successful run** after v2.1-hotfix. Q7 and Q16 fixes are verified in production conditions.
- Pipeline reached Gate 2 cleanly with `pipeline_validate ok:true` — `/done` should record a metrics row without recovery needed.
- Next real-task validation should consciously cover: (a) a task that should spawn challenger/style/security/performance (auth or perf-sensitive change) to nail Q9; (b) a task that touches API to verify `applies_to` predicate works at all.

---
