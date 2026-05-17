# Open backlog

Active Q-items not yet shipped. Updated when new bugs surface from real-task validation OR existing items change status (e.g., Q41 partial → fully shipped when v2.3 daemon activates LLM path).

For closed items, see [`closed-q-items.md`](closed-q-items.md). For pipeline phase plans, see [`phases/`](phases/).

## Currently open

| Q | Severity | Status | Notes |
|---|---|---|---|
| Q41 | 🟡 MEDIUM | **scheduled v2.2.5 Item 9** | refs-to-load LLM-driven path. Originally architected to wait for v2.3 daemon's direct-API SpawnProvider, but **shuttle-classifier path (Impl A in product-vision.md) ships activation in v2.2.5** — no daemon required. Classifier-agent in `context` phase emits `state.decisions.refs_to_load` directly; existing English regex fallback in `decisions/refs-to-load.ts` becomes dead code. |
| Q44 | 🟡 MEDIUM | **scheduled v2.2.5 Item 9** | anti-pattern detection. Same activation as Q41 — classifier-agent emits `state.decisions.antipattern_rules_applicable` containing rule IDs that actually apply to the diff. Word-overlap heuristic in `anti-pattern-grep` hook becomes a pure getter that reads from state. |
| Q45 | 🟡 MEDIUM | **subsumed by Q41 activation** | multilingual refs picking. Not a separate bug — manifestation of Q41 partial state on non-English tasks. Resolves when Q41 ships in v2.2.5. |
| Q46 | 🟡 MEDIUM | **scheduled v2.2.5 Item 9** | non-Latin task → useless slug. Classifier-agent emits `state.task_short` as a semantic short identifier (the slug part); `task_id` keeps hex-stable form for referential integrity. Two fields, two purposes. **Do NOT** add transliteration libraries. |
| Q47 | 🟢 LOW | open | **`gate1_revisions: 0` in metrics row despite Gate 1 rejection cycle.** Not reproduced on frontend-core 2026-05-17 (Gate 1 was approved). Investigation pending next Gate 1 user-reject run. | `mcp/src/driver/builtin/steps/index.ts` mirror branch + `mcp/src/tools/finish.ts` derivation. |
| Q48 | 🟡 MEDIUM | open | **Metric row observability gap.** `pipeline.jsonl` metric row does NOT include `force_used`, `pipeline_violation`, `started_at`, `ended_at`, `gate2_revisions`, `reviewer_count`. State has them; audit has them; long-term storage doesn't. Cross-project analysis can't answer "how many runs were force-bypassed?" or "Gate 2 reject rate?". Filed from frontend-core run 2026-05-17 where state had `pipeline_violation: "phase-force-final"` but metric row didn't. **Fix:** extend `extractMetricsRow` in `mcp/src/tools/finish.ts` to read these fields. Pure code, ~1-2h. | `mcp/src/tools/finish.ts:86-118` (extend `row` object). |
| Q50 | 🟢 LOW | open | **`stack.test_command` carries trailing comment from CLAUDE.md.** `parseClaudeMd` in `stack-detect.ts:80` strips backticks/quotes but not `# trailing comment`. Real-task frontend-core: `test_command: "pnpm -r test                      # vitest run"` survived to state and metric row. **Fix:** one line — add `.replace(/\s*#.*$/, "").trim()` after quote-strip on line 80. ~30min including test. | `mcp/src/driver/builtin/decisions/stack-detect.ts:80`. |
| Q51 | 🟡 MEDIUM | open | **`stack.package_manager` ignores `pnpm-workspace.yaml`.** `detectNodePackageManager` (stack-detect.ts:118-123) only checks lock files. On frontend-core: lockfile absent at pipeline_init time → fell to "npm" default; commands use `pnpm -r`. Inconsistency in state object. **Fix:** also check `pnpm-workspace.yaml` (already used 5 lines below in `isMonorepoRoot`), `packageManager` field in root `package.json`, command-prefix from CLAUDE.md `Validation Commands` section. ~1h including tests. | `mcp/src/driver/builtin/decisions/stack-detect.ts:118-123`. |
| Q52 | 🟡 MEDIUM | open | **Partial-commit during `pipeline_continue_task agents-results` batch with mixed valid/invalid headers.** Real-task frontend-core 18:06:36: batch of 4 reviewer results → style-reviewer's findings had `severity: "non-blocking"` (not in enum) + missing `agent` field → batch returned error, but logic/challenger/performance were silently committed. Retry hit INV_012 (already-recorded ar-ids). Recovery method-by-trial. **Fix:** make `agents-results` atomic — either all results commit or none; per-result error report so the caller knows which subset to retry. ~2h. | `mcp/src/tools/record-agent-run.ts` (batch path). |
| Q53 | 🟢 LOW | open | **Stale `pending_spawns` in `driver-state.json` after Q52-recovery.** Downstream of Q52. Implementation phase clean in pipeline-state but driver-state retains the orphan ar-ids. Likely fixed for free once Q52 is atomic. | `mcp/src/driver/tools/continue-task.ts` (driver-state cleanup path). |
| Q54 | 🟢 LOW | open | **Workflow gap: gate-2 reject-with-feedback but still accept.** User on frontend-core rejected gate-2 with revision feedback but decided to ship anyway. Path required `pipeline_set_phase_status final completed force=true` then `pipeline_finish verdict=accepted` — recorded as `pipeline_violation: "phase-force-final"`. Design question, not bug. **Possible fix:** dedicated answer `acknowledge-and-ship` for gate-2 that stores feedback for the next task but doesn't block finish. Defer until next time the pattern recurs. | gate-2 protocol + `pipeline_finish`. |
| Q55 | 🟢 LOW | open | **`pipeline-state-summary.md` stale after `pipeline_finish`.** Summary written at force-set-phase (20:30:36) but finish ran 20:30:41. Summary shows "Final verdict: —" while state has `verdict: "accepted"`. **Fix:** `pipeline_finish` rewrites summary at completion. ~30min. | `mcp/src/tools/finish.ts` + `mcp/src/lib/summary.ts`. |
| Q57 | 🟡 MEDIUM | **scheduled v2.2.5 Item 8** | **Structured gate-answer protocol.** Replace free-text `answer: string` with `{decision: "accept"\|"reject", message?: string}`. Mirror logic collapses from regex-classifier to one ternary. Multi-channel ready (CLI/Web UI/Telegram/API). Category 2 fix per architectural principle — eliminates classification instead of patching it with multilingual keywords. Closes Q49 placeholder (Russian "да" → rejected) without filing it as a separate bug. Skill markdown gains a 5-line parser to accept `1`/`2 <message>` from CLI. Backward-compat shim accepts old free-text for 2 weeks post-merge then removed. | `mcp/src/driver/builtin/gates/index.ts` + `commands/task.md` + `commands/done.md`. |
| Q58 | 🟡 MEDIUM | **scheduled v2.2.5 Item 9** | **Intent classification (security_needed / antipattern_rules / task_short).** Classifier-agent in `context` phase consumes `pickFromCandidates` primitive (Q61) and emits structured JSON populating `state.decisions.{security_needed, antipattern_rules_applicable, task_short, refs_to_load}`. Decisions become pure getters. Replaces English keyword regex in `decisions/security-needed.ts` (Q49-class anti-pattern). | `mcp/src/driver/builtin/decisions/security-needed.ts` + new `agents/classifier.md` + new `bundles/code/steps/classify.ts`. |
| Q59 | 🟢 LOW | **scheduled v2.2.5 Item 9 (or deferred)** | **Anti-pattern section header marker convention.** Replace `/^#{1,4}\s+(what not to do\|don't\|antipatterns)/i` in `hooks/index.ts:125` with a structured marker `<!-- antipattern -->` block. Parser becomes language-agnostic. Category 2 fix. **Convention requires CLAUDE.md author awareness** — document in `mcp/README.md` "Authoring CLAUDE.md" section. Backward-compat: keep English regex as fallback if marker absent. | `mcp/src/driver/builtin/hooks/index.ts:125` + docs. |
| Q60 | 🟢 LOW | open | **Hook ordering invariant implicit.** `BUILTIN_HOOKS` array in `hooks/index.ts:340-345` defines execution order. `anti-pattern-grep` + `caller-context-expand` read `diff.txt` written by `git-diff-snapshot`. Sequential dependency, no explicit contract. **Fix:** add `depends_on?: string[]` field to `HookPlugin` or comment-invariant above the array. ~30min. | `mcp/src/driver/types/plugin.ts` + `mcp/src/driver/builtin/hooks/index.ts:340-345`. |
| Q61 | 🟡 MEDIUM | **scheduled v2.2.5 Item 9** | **`pickFromCandidates` primitive in `mcp/src/lib/`.** Extract the LLM-classification pattern from `refs-to-load.ts:39-115` into a reusable ~55-line helper. Inputs: `{query, task, candidates, cap, context_hint?}`. Output: filtered subset of candidates. Defensive parse against `known` Set so hallucinations are dropped. Used by classifier-agent (Impl A) and any future `query()` consumer (Impl B). Modular: each consumer site becomes a 5-line wrapper. | `mcp/src/lib/pick-from-candidates.ts` (new) + refactor `refs-to-load.ts`. |

## Scheduled (was deferred)

| Q | Severity | Where it lands | Notes |
|---|---|---|---|
| Q40 | architectural | [`phases/v2.2.5-bundle-foundation.md`](phases/v2.2.5-bundle-foundation.md) | **Promoted from deferred 2026-05-14.** End-goal is virtual teams for any niche (code / content / marketing / research / VFX) per [`ui-vision.md`](ui-vision.md). Bundle abstraction becomes prerequisite for v2.3 daemon + Web UI rather than a post-hoc retrofit. Phase v2.2.5 (~5-7d) ships: `Bundle` first-class concept, directory move `builtin/` → `bundles/code/`, `loaders/bundles.ts`, `state.bundle` field, Phase enum → flow-declared, `pipeline.config.json` per project, skills bundle-parameterized, `MCPClientPlugin` contract (external MCP consumer), `state.team_knowledge_refs` slot. |
| Q41 / Q44 / Q46 / Q58 / Q61 | 🟡 MEDIUM | [`phases/v2.2.5-bundle-foundation.md`](phases/v2.2.5-bundle-foundation.md) Item 9 | **LLM-classification cluster.** Promoted from "wait v2.3 daemon" 2026-05-17 after realizing shuttle-classifier path works on existing infra. One classifier-agent + one `pickFromCandidates` primitive activates all five together. ~1-2d. |
| Q57 | 🟡 MEDIUM | [`phases/v2.2.5-bundle-foundation.md`](phases/v2.2.5-bundle-foundation.md) Item 8 | **Structured gate-answer protocol.** Filed 2026-05-17 as Category 2 fix (restructure to eliminate classification). ~0.5-1d. |

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

Q-numbers monotonically increase (next: Q62). Numbers are stable across closures — once Q39 was filed, it stays Q39 even after fix.

**Note on Q49 / Q56:** Both reserved-then-superseded. Q49 was "gate user-answer English-only" placeholder — became Q57 (structured gate-answer) as a Category-2 fix per architectural principle. Q56 was reserved during a renumbering pass and never assigned. Both numbers remain unused (do not recycle).
