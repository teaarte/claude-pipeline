# Open backlog

Active Q-items not yet shipped. Updated when new bugs surface from real-task validation OR existing items change status (e.g., Q41 partial → fully shipped when v2.3 daemon activates LLM path).

For closed items, see [`closed-q-items.md`](closed-q-items.md). For pipeline phase plans, see [`phases/`](phases/).

## Currently open

| Q | Severity | Status | Notes |
|---|---|---|---|
| Q52 | 🟡 MEDIUM | open | **Partial-commit during `pipeline_continue_task agents-results` batch with mixed valid/invalid headers.** Real-task frontend-core 18:06:36: batch of 4 reviewer results → style-reviewer's findings had `severity: "non-blocking"` (not in enum) + missing `agent` field → batch returned error, but logic/challenger/performance were silently committed. Retry hit INV_012 (already-recorded ar-ids). Recovery method-by-trial. **Fix:** make `agents-results` atomic — either all results commit or none; per-result error report so the caller knows which subset to retry. ~2h. | `mcp/src/tools/record-agent-run.ts` (batch path). |
| Q53 | 🟢 LOW | open | **Stale `pending_spawns` in `driver-state.json` after Q52-recovery.** Downstream of Q52. Implementation phase clean in pipeline-state but driver-state retains the orphan ar-ids. Likely fixed for free once Q52 is atomic. | `mcp/src/driver/tools/continue-task.ts` (driver-state cleanup path). |
| Q54 | 🟢 LOW | open | **Workflow gap: gate-2 reject-with-feedback but still accept.** User on frontend-core rejected gate-2 with revision feedback but decided to ship anyway. Path required `pipeline_set_phase_status final completed force=true` then `pipeline_finish verdict=accepted` — recorded as `pipeline_violation: "phase-force-final"`. Design question, not bug. **Possible fix:** dedicated answer `acknowledge-and-ship` for gate-2 that stores feedback for the next task but doesn't block finish. Defer until next time the pattern recurs. | gate-2 protocol + `pipeline_finish`. |
| Q62 | 🟢 LOW | open | **Ref content enrichment phase.** v2.2.5-followups (M12) loosened the reviewer-prompt rule that required `**Red Flags in Diff**` / `**Anti-Patterns**` sections in every ref. ~12 refs under `agents/references/{e2e,perf,test,ui}-*.md` never had those sections, so the rule was silently dead. A future phase should decide whether structured sections, extended frontmatter, or per-stack ref expansion is the right shape, then re-enrich the bare refs accordingly. Not blocking — frontmatter (`tags`, `agent_hints`, `summary`, `when_to_load`) already signals relevance to reviewers. | `agents/references/`. |
| Q63 | 🟡 MEDIUM | **scheduled v2.2.6** | **`pipeline_violation: "phase-force-final"` on every successful run.** Same workflow shape as Q54 but now observed on a SUCCESS path, not a rejection. Frontend-core 2026-05-18 task closed with `verdict: "accepted"` but `force_used: true` + `pipeline_violation: "phase-force-final"` in the metric row. Root cause: after `acceptance: PASS`, the `validation` phase stays `in_progress` (acceptance is recorded but no one explicitly closes the phase) and `final` stays `pending`. `pipeline_validate` then trips INV_007 (`verdict` can't be `accepted` while validation/final are not closed). User force-sets `final completed force=true`, which writes `pipeline_violation` — and now this marker is permanently in the metric row of every successful task. **Consequence:** `force_used`/`pipeline_violation` lose their value as a "something went wrong" signal — they fire on every clean run. Cross-project analytics "how many runs needed force?" returns 100%. **Fix:** (a) on `acceptance: PASS` record (the validator hook), auto-transition `validation` to `completed` when `open_spawns=0`; (b) `pipeline_finish` auto-transitions `final` to `completed` without `force=true` when `verdict='accepted'` and all prior phases closed cleanly. The `force` path remains for genuine recovery. **Where:** `mcp/src/tools/record-agent-run.ts` (acceptance auto-close) + `mcp/src/tools/finish.ts` (final auto-close on clean path). ~3-4h. Add as Item 10 to v2.2.6 OR keep as standalone followup; user to decide. |

## Deferred (no trigger to fix yet)

| Q | Severity | Why deferred | Trigger to activate |
|---|---|---|---|
| Q38 | 🟢 LOW | Terminal-tab auto-rename via OSC-0 — Claude Code Bash tool subprocess has no TTY; can't reach user terminal. | Solved natively by v2.3 Web UI (browser tabs instead of terminal escape codes). No fix needed in pipeline. |

## Code-quality follow-ups (v2.2-code-polish bundle, separate)

Surfaced by architecture review post-v2 ship. Not validation-driven (no real-task data backs them). Bundle them whenever convenient — these don't unblock anything user-visible.

| Q | Severity | Effort | What |
|---|---|---|---|
| Q1 | code-quality | ~1d | Reduce 33 `any` types across `mcp/src/` to typed equivalents. Mostly `(state as any).field` patterns that have proper types if traced. |
| Q2 | code-quality | ~1d | `mcp/src/driver/builtin/steps/index.ts` is a 1000+ line hot file. Split per step-kind (review, gate, spawn, etc.) — each ~150 lines. |
| Q3 | code-quality | ~30min | Reviewer/validator agent output examples are 30-50 lines each, structurally identical across 13 files. Consolidate to single `templates/agent-output-formats.md` reference + per-agent category list. |
| Q4 | code-quality | ~30min | `mcp/src/driver/types/plugin.ts` is the only file >300 lines in types/. Split per contract (one file per plugin interface) for cleaner import boundaries. |
| Q5 | code-quality | ~30min | Add CI threshold for test:source ratio. Currently 76% (343 test : ~450 source). Fail if drops below 60%. |
| Q6 | code-quality | ~1-2h | Consolidate single source of truth for agent output examples (overlaps Q3 — possibly merge). |

**Total v2.2-code-polish bundle effort:** ~3-5 days. Ship when:
- Boredom strikes between feature work
- Before adding any new agent template (saves rework)
- As a "warm-up bundle" before a bigger phase

## Adding new Q-items

When real-task validation surfaces a new bug:

1. Add a row to this file's "Currently open" table with severity (🔴 HIGH / 🟡 MEDIUM / 🟢 LOW) + 1-line summary.
2. Add a per-task entry in [`../validation/closed-tasks/`](../validation/closed-tasks/) (or update existing one if mid-flight).
3. Reference the Q-number in commit messages when fixing.
4. On merge → move row to [`closed-q-items.md`](closed-q-items.md) under the relevant bundle, with commit SHA.

**Severity guide:**
- 🔴 HIGH — blocks further validation / breaks `/done` / corrupts state
- 🟡 MEDIUM — degrades correctness or observability silently
- 🟢 LOW — cosmetic / UX friction / non-blocking

Q-numbers monotonically increase (next: Q64). Numbers are stable across closures — once Q39 was filed, it stays Q39 even after fix.

**Note on Q49 / Q56:** Both reserved-then-superseded. Q49 was "gate user-answer English-only" placeholder — became Q57 (structured gate-answer) as a Category-2 fix per architectural principle. Q56 was reserved during a renumbering pass and never assigned. Both numbers remain unused (do not recycle).
