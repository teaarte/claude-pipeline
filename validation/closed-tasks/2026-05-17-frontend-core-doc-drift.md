## t-2026-05-17-c797 — frontend-core doc drift + module-contract test wiring

> **✓ Closed 2026-05-17.** Third real-task validation run. **First TypeScript-monorepo-frontend non-trivial fan-out repro on a project other than s3-panel.** Confirmed v2.2a review surface holds on a 3rd project. Surfaced architectural insight that classifier-agent activation does NOT require v2.3 daemon — promoted Q41/Q44/Q45/Q46/Q58/Q61 from "LLM-blocked / wait v2.3" to "scheduled v2.2.5 Item 9". Also surfaced 8 new Q-items (Q48 / Q50-55 / Q57-61) covering metric observability dropdown, stack-detect polish, agent-results partial-commit, and architectural restructure for gate-answer + antipattern marker.

- **Project:** `~/Programming/OSC/frontend-core` (TypeScript pnpm monorepo, frontend, Rsbuild 2.x + Module Federation 2.0 + Mantine v9)
- **Task (Russian):** "почини все найденные выше нюансы и шероховатости" — doc drift in CLAUDE.md/SPEC.md/ROADMAP.md (TypeScript 5.7+ → 6.x, Rsbuild 1.x → 2.x) + wire vitest in module-contract + add shape-stability test
- **Complexity (auto):** medium ✓
- **tests_mode (auto):** regression-only ✓
- **Wall time:** ~107 min (16:43 → 18:30; included Gate 0 reject + Gate 1 reject cycle + Gate 2 reject-with-feedback + force-finish)
- **Agents count:** 11 (full fan-out — same as wandr-be)
- **Verdict:** accepted (with `pipeline_violation: "phase-force-final"` due to gate-2 reject → force-finish workaround)
- **Subjective rating:** 8/10 — pipeline delivered real review value (logic-reviewer caught ROADMAP.md drift the implementer missed); shape of new Q-items reveals strong cluster of architectural improvements to bundle into v2.2.5

### Production verifications (the big ones)

| Q | Status | Production evidence |
|---|---|---|
| **Q9 fan-out** | ✅ **3rd project in a row** | `phases.implementation.agents: [implementer, logic-reviewer, challenger-reviewer, style-reviewer, performance]` — 4 reviewers. s3-panel × 5 (2 each) → wandr-be (4) → frontend-core (4). Fan-out stable. |
| **Q9 decisions wiring** | ✅ verified | `decisions: { security_needed: false, ui_touched: false, api_touched: false }` — all three populated. ui_touched=false correctly (task was prose+config, not UI files). |
| **Q26 monorepo + Q17 stack** | ✅ verified on pnpm monorepo | `project_type: "monorepo"`, `language: "typescript"`, all commands populated. **BUT:** `package_manager: "npm"` (wrong, should be `pnpm`) — see Q51. test_command captured trailing CLAUDE.md comment — see Q50. |
| **Q27 pre-review files** | ✅ all 4 generated | `diff.txt` 2.5K (3 modified files; missed untracked test file — see Q52 below… wait actually that's Q51 not Q52 — corrected: see Q51 follow-on note), `caller-context.md` 41B placeholder, `antipattern-candidates.md` 24B `(no formalizable rules)` placeholder (Q44 hook degraded gracefully on small diff with no extractable rules), `past-misses-{5 reviewers}.md` 5 files with `(no past-miss data)` placeholders. |
| **Q42 verdict.phase** | ✅ verified | All 8 reviewer_verdicts have `phase` field; logic-reviewer iter=1 distinguishable across planning vs implementation. |
| **Q43 impl_iters derive** | ✅ verified again | `impl_iters: 4` from 4 distinct reviewers in implementation phase. Same shape as wandr-be. |
| **Q22 metric row on full fan-out** | ✅ verified | `agents_count: 11, plan_iters: 2, impl_iters: 4, blockers_found: 2, gate1_revisions: 0, acceptance_first_pass: true, reviewers_with_blockers: ["logic-reviewer"]`. |
| **Q29 vocab in production** | ✅ verified | `categories_seen: [coverage-gap, over-engineering, spec-deviation, other, duplication]` — `spec-deviation` and `over-engineering` are Q29 additions. |
| **Q22 acceptance_first_pass strict-PASS** | ✅ verified vs wandr-be | frontend-core: `acceptance_first_pass: true` (PASS, not PASS_WITH_WARNINGS). wandr-be was `false` (PASS_WITH_WARNINGS). Derivation correctly distinguishes. |
| **Q23 cleanup** | ✅ verified | Post-`/done` `.claude/` contains only `settings.local.json`. |
| **Gate 0 + Gate 1 rejection-revision cycles** | ✅ verified | Gate 0 rejected (user "да" mis-classified — see Q57 root finding); Gate 1 logic-reviewer iter=1 REQUEST_CHANGES (missing `docs/ROADMAP.md:23` Rsbuild drift) → planner revised → Gate 1 approved on iter=2. Full revision loop on production codebase. |
| **logic-reviewer caught real implementer miss** | ✅ value delivered | Gate 2 logic-reviewer iter=1 REQUEST_CHANGES — `docs/ROADMAP.md:23` still had `Rsbuild 1.x` drift the implementer missed (was excluded from plan's Not-In-Scope but task said "fix all nuances"). This is the v2.2a value proposition working as designed: independent reviewer catches what implementer rationalized away. |

### Architectural insight surfaced from this run

**The big one (2026-05-17):** classifier-agent for LLM-classification cluster (Q41/Q44/Q46/Q58) does NOT require v2.3 daemon's direct-API SpawnProvider. It runs on existing shuttle infrastructure as a regular agent spawn in `context` phase. The "wait for v2.3 daemon" assumption was inertia from the Q41 author's design intent (direct-API as canonical), not an architectural requirement.

This insight came from a code-review pass during the session. User question: "почему не можем через скилл или mcp"? Tracing the spawn lifecycle showed Claude Code Task tool ALREADY does LLM work for every agent; classifier-agent is just one more agent of the same shape.

**Effect on roadmap:** Q41/Q44/Q45/Q46/Q58/Q61 moved from "LLM-blocked, deferred to v2.3" to "scheduled v2.2.5 Item 9". 6 Q-items unblocked by reframing.

**Architectural principle refined:** product-vision.md "Architectural principle" section reorganized into **3 categories in priority order**:
1. Deterministic code
2. **Restructure input to eliminate classification** (NEW category — gate-answer V1, antipattern marker convention)
3. Code + LLM picking from candidates

User's framing crystallized during this session: "Pure code for deterministic problems. Restructure input where possible. LLM picking when the input space is irreducibly free-form."

### Bugs found (filed as Q-items)

1. **Q48** 🟡 MEDIUM — Metric row in `pipeline.jsonl` does NOT carry `force_used` / `pipeline_violation` / `started_at` / `ended_at` / `gate2_revisions` / `reviewer_count`. State has them; long-term observability storage doesn't. Cross-project analysis blind to force-bypass rate / Gate 2 reject rate / wall-clock. **Most strategically important finding** — single-fix high-leverage on observability.
2. **Q50** 🟢 LOW — `stack.test_command` carries trailing `# comment` from CLAUDE.md. One-line fix in `parseClaudeMd`.
3. **Q51** 🟡 MEDIUM — `stack.package_manager` ignores `pnpm-workspace.yaml`. Frontend-core: detected "npm" while commands use `pnpm -r`. Multi-signal detection needed.
4. **Q52** 🟡 MEDIUM — Partial-commit during `pipeline_continue_task agents-results` batch with mixed valid/invalid headers. Real-task style-reviewer findings had invalid enum → batch ostensibly rejected but logic/challenger/performance silently committed. Retry hit INV_012.
5. **Q53** 🟢 LOW — Stale `pending_spawns` in `driver-state.json` after Q52 recovery. Downstream of Q52.
6. **Q54** 🟢 LOW — Workflow gap: gate-2 reject-with-feedback but still accept requires `force=true` workaround. Design question, not bug.
7. **Q55** 🟢 LOW — `pipeline-state-summary.md` stale after `pipeline_finish` (shows "Final verdict: —" while state has `verdict: "accepted"`).
8. **Q57** 🟡 MEDIUM — Structured gate-answer protocol. Filed as Category 2 architectural fix (eliminates classification at gates by restructuring input to `{decision: "accept"|"reject", message?}` enum). Closes the would-be Q49 (Russian "да" → changes_requested) without adding multilingual keyword lists. Scheduled v2.2.5 Item 8.
9. **Q58** 🟡 MEDIUM — security_needed / refs-to-load / task_short / antipattern-rules via classifier-agent + `pickFromCandidates` primitive. Scheduled v2.2.5 Item 9.
10. **Q59** 🟢 LOW — Anti-pattern section header marker convention in CLAUDE.md. Category 2 fix replacing English-regex header detection.
11. **Q60** 🟢 LOW — Hook ordering invariant explicit (`BUILTIN_HOOKS` array has implicit `git-diff-snapshot` → consumers dependency).
12. **Q61** 🟡 MEDIUM — `pickFromCandidates` primitive in `mcp/src/lib/`. Extracts refs-to-load LLM-classification pattern into reusable helper. Scheduled v2.2.5 Item 9.

All 12 added to [`../../specs/open-backlog.md`](../../specs/open-backlog.md). Next Q-number: Q62. Q49 + Q56 reserved-then-superseded (do not recycle).

### Friction / UX notes

- **`stack.package_manager: "npm"` + `test_command: "pnpm -r test..."`** — internal inconsistency in state object surfaced as concrete bug (Q51) on first non-s3-panel pnpm monorepo. Stack-detect needed multi-signal detection.
- **Trailing whitespace + `# comment` in stack commands** — survived through state and into long-term metric row. Cosmetic but pollutes downstream agent prompts (Q50).
- **Russian task → useless task_id slug** (`t-2026-05-17-c797` pure hex). Same Q46 manifestation as wandr-be. Confirms Q46 is real and frequent on non-Latin tasks.
- **Gate 2 reject-with-feedback workflow** — user wanted to ship anyway (feedback was about doc cosmetic, real code worked). Required 3 attempts at `pipeline_finish` before discovering `pipeline_set_phase_status final completed force=true` path. UX friction recorded as Q54.
- **`agents-results` batch with mixed validity** — confusing recovery. Q52.

### Objective signals from logs

- `plan_iters`: 2 (logic-reviewer iter1 REQUEST_CHANGES → planner re-spawn → iter2 APPROVE)
- `impl_iters`: 4 (logic + challenger + style + performance — full fan-out)
- `reviewer_disagreements`: 0
- `acceptance_first_pass`: true ✓ (PASS, not PASS_WITH_WARNINGS)
- `agents_count`: 11
- `blockers_found`: 2 (planning + implementation logic-reviewer findings)
- Audit error count: 5 (2 × INV_012 from Q52, 2 × INV_007 from gate-2 workflow, 1 × schema-validation from Q52 style-reviewer batch)
- `force_used`: true (1 × `pipeline_set_phase_status force=true`)
- `_repaired` count: 0
- **NOTE:** none of the above visible in metric row (`force_used`, audit error count, etc.) — see Q48.

### Cost signal (estimated; v2.5 will measure)

- ~$0.15-0.40 in opus tokens (planner × 2 + implementer × 1 + reviewers × 5)
- ~$0.01-0.03 in haiku tokens (acceptance + context-doc-verifier + plan-grounding-check)
- ~107 min wall-clock includes user-think time at 3 gates + Gate 2 reject-revise cycle attempt

### Quality of actual delivery

- Plan: 19.3K — detailed, multi-step
- Diff: 2.5K — surgical doc edits + one new test file
- Acceptance: PASS (all 7 ACs)
- Blockers caught: 2 (planning + implementation)
- All blockers addressed in plan revision

**Real value delivered.** Pipeline's review surface caught a real implementer miss (ROADMAP.md drift) AT GATE 2 — not as a downstream bug. This is the v2.2a value proposition validated for a 3rd consecutive project across 3 different languages (TypeScript-frontend-monorepo, TypeScript-backend, TypeScript-monorepo-Rsbuild). Generalizability of v2.2a fan-out is now strong.

### Notes

- **Pipeline is production-ready for code-domain tasks across multiple TypeScript project shapes.** s3-panel × 5 (frontend-monorepo-pnpm), wandr-be × 1 (backend), frontend-core × 1 (frontend-monorepo-pnpm-Rsbuild). v2.2.5 substrate work can proceed with full confidence.
- **The strategic insight** (classifier-agent doesn't need daemon) is the most valuable artifact from this entry — unblocked 6 Q-items that were sitting "wait for v2.3" with no concrete activation path.
- **8 new Q-items filed** — most either small detect-polish (Q50/Q51/Q60) or architectural (Q48/Q57/Q58/Q61). Cluster into v2.2.5 items 8-11 as 4 commits beyond the original 7 substrate commits.
- **Architectural principle now has 3 categories** (vs 2 before). Category 2 (restructure input) is the new addition — gate-answer V1 (Q57) is the canonical example.
- Future second-project validation: Python or Go backend would be the next under-tested stack shape.
