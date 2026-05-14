## t-2026-05-14-contextreadfirstinth — Phase 0.5 Step 4: synthetic _demo-contract

> **✓ Closed 2026-05-14 (Step 4 run on s3-panel — see also separate Step 3 entry below with same `task_id` due to Q42 slug collision).** First end-to-end run on post-v2.2-clear-bundle main. Auto-`/done` after user accepted with a small in-flight fix (.js extension cleanup). **Major production verifications:**
>
> - **Q17 + Q26 + Q37 end-to-end stack threading** ✓ — `pipeline.jsonl` row carries `stack: {language:"typescript", package_manager:"pnpm", project_type:"monorepo", test/lint/build commands from CLAUDE.md}`. Q26 priority chain works (commands from CLAUDE.md, not `npm run X`); Q26 monorepo enum addition works; Q37 stack-to-row threading works.
> - **Q22 metrics row** ✓ — `tests_mode:"regression-only"`, `impl_iters:1`, `plan_iters:1`, `gate1_revisions:0`, `verdict:"accepted"`, `reviewer_count:5`. All correctly populated.
> - **Q23 cleanup** ✓ — `.claude/` post-`/done` contains only `settings.local.json` (no `mcp-audit.jsonl` stub).
> - **Q24 + Q36 Stop hook** ✓ — block message shows `flow=medium step=21` (Q10 deprecation + Stop-hook refactor), NOT stale "STEP 1". Q36 positive framing held when Gate 2 was accepted.
> - **Q29 vocab expansion** ✓ **VERIFIED IN PRODUCTION** — `categories_seen: ["spec-deviation", "scope-creep", "other"]`. Both new categories from Q29 (`spec-deviation`, `scope-creep`) used by logic-reviewer on real findings. Q29 fix delivered exactly what it promised.
>
> **New issues surfaced (filed):**
> - **Q41 NEW** — `refs-to-load` decision is stack-blind. For frontend monorepo task, it picked `[arch-patterns, db-postgres, redis, api-design, concurrency]` — all backend refs. Root cause: regex-on-task-text only, no `state.stack` awareness. Filed with **LLM-driven design** (refs become self-describing via YAML frontmatter; decision becomes async + LLM-classification). Bundles into v2.2a alongside Q30 (persistence — same decision).
> - **Q42 NEW** — `task_id` slug collision. Step 3 (Identity contract) and Step 4 (_demo-contract) produced **identical `task_id: t-2026-05-14-contextreadfirstinth`** because both `/task` invocations begin with the same `## Context (read first, in this order)` preamble. Promoted from cross-cutting observation (had 3 supporting data points) to filed Q-item because of **concrete metric collision** — `~/.claude/metrics/pipeline.jsonl` now has two rows with same `task_id` but different `task_short`, breaking cross-task aggregation. Fix: hash-suffix on collision detection.
>
> **Anomaly worth noting:** `acceptance_first_pass: false` in metrics row, despite acceptance ostensibly passing first try. Possible Q22 derivation edge-case interaction with the post-acceptance fix (user dropped `.js` extensions after first acceptance call → second pass triggered? need audit-log inspection on next run to verify). Not filing yet — collect 1-2 more data points.

- **Project:** `~/Work/AI-FACTORY/s3-panel`
- **Complexity (auto):** medium ✓
- **tests_mode (auto):** regression-only ✓
- **Wall time:** ~90 min (started 14:42Z, Gate 2 reached 15:23Z)
- **Agents count:** 8 (context: 2, planning: 3, test_first: 0 skipped, implementation: 2, validation: 1)
- **Verdict:** at Gate 2, paused for analysis before `/done`
- **Subjective rating:** 8/10 — first run after v2.1-polish-bundle landed; **7 of 10 bundled fixes verified working in production**

### What worked — v2.1-polish-bundle fixes verified end-to-end

| Q | Production evidence |
|---|---|
| **Q7** (slug) | `task_id="t-2026-05-14-contextreadfirstinth"` — schema-valid format |
| **Q8** (gate mirror) | `gates = {gate0:"approved", gate1:"approved", gate1_feedback:"approve", gate2:"pending"}`. **2 audit-entries `pipeline_gate_mirror` in correct order.** Scratch flags `gate-0_mirrored`/`gate-1_mirrored` present (idempotency). |
| **Q11** (error_class) | The 1 audit-error carries `error_class: "schema-validation"` — categorization working |
| **Q17** (stack populate) | `state.stack` has `language:"typescript"`, `package_manager:"pnpm"` populated (no longer all-null) — **but see Q26** below for wrong values |
| **Q20** (verdict.phase) | All 5 `reviewer_verdicts[]` entries carry `phase` field — logic-reviewer rows in `planning` vs `implementation` now distinguishable |
| **Q22** (metrics row) | `state.tests_mode = "regression-only"` (was null in prior runs). `pipeline_finish` will produce a correct metrics row this time. |
| **Q24** (Stop hook) | `pending_user_answer = {gate:"gate-2", message:"..."}` correctly populated. Stop hook stays silent at Gate 2 pause. **No more scary "Pipeline is in flight" message.** |

Audit error rate: **1/15 = 7%** (was 48% on first run → 27% → 7%). Strong improving trend.

### Gate interaction (real conversation)
- **Gate 0:** approved as-is on first prompt
- **Gate 1:** approved on first plan (no revision; plan-grounding-check verdict = `GROUNDED` first try)
- **Gate 2:** **pending** — user requested thorough pre-`/done` analysis

### Bugs found (4 new + 2 recurrences)

1. **🟡 MEDIUM — Q9 RECURRENCE (3rd time): code review under-spawned.**
   - **Implementation phase:** 2 agents (`implementer` + `logic-reviewer` only). Spec says 6 (impl + 5 reviewers).
   - **Validation phase:** 1 agent (`acceptance` only). Spec says 4+ (acceptance + plan-conformance + UI-consistency + API-contract + optionally playwright).
   - Now confirmed across THREE separate real-task runs. Hypothesis space narrowing — likely `applies_to` predicates or step impl in `builtin/steps/index.ts`. Filed for v2.2-review-completeness bundle alongside Q27.

2. **🟡 MEDIUM — Q26 NEW: Q17 stack-detector takes wrong command values.**
   - Detected: `test_command:"npm run test"`, `lint_command:"npm run lint"`, `build_command:"npm run build"`, `project_type:"library"`.
   - Real (from s3-panel CLAUDE.md "Validation Commands"): `pnpm -r lint`, `pnpm -r test`, `pnpm -r typecheck`, `pnpm -r build`. Project is a pnpm monorepo, not a library.
   - Q17 spec required CLAUDE.md > package.json priority chain; detector skipped CLAUDE.md parsing entirely.
   - Filed as new Q26.

3. **🟡 MEDIUM — Q27 NEW: pre-review infrastructure files missing.**
   - **All four expected files absent:** `.claude/diff.txt`, `.claude/caller-context.md`, `.claude/antipattern-candidates.md`, `.claude/past-misses-*.md`.
   - Confirmed via state: `past_misses_applied: 0` for ALL 5 reviewer_verdicts.
   - **Compound effect with Q9:** the 1/5 reviewer that fires (Q9 deficit) is reviewing **blind to 4 of its expected input files**. Real review value far below already-low Q9 baseline.
   - Filed as new Q27. **Top priority for v2.2 alongside Q9** — bundled as "v2.2-review-completeness".

4. **🟢 LOW — Q28 NEW: schema_version missing in per-finding entries.**
   - The 1 audit-error: `must have required property 'schema_version'` on `/findings/0`. Retry-recovered.
   - Q21 added bullet-list constraints for `summary_line`/`id`/`summary` but missed `schema_version` per-finding requirement.
   - Filed as Q28 (Q21 extension).

5. **🟢 LOW — Q29 NEW: logic-reviewer overuses `category:"other"`.**
   - 4 of 5 findings categorized as `other`. The natural categories LLM wanted are not in vocab: `spec-deviation`, `scope-creep`, `coverage-gap`.
   - Q18 fixed inline-resolution; vocab itself needs expansion.
   - Filed as Q29.

6. **🟢 LOW — Q10 RECURRENCE:** `current_step: "STEP 1"` while `step_index=20`. Known cosmetic.

### Friction / UX notes (not bugs)

- **task_id slug semantics** (cross-cutting observation already filed): generated slug `contextreadfirstinth` came from preamble *"## Context (read first, in this order)"*. Third confirmation of the universal preamble pattern. Cross-cutting observation now has 3 supporting data points — could promote to Q30 if next 1-2 runs confirm same pattern.

### Objective signals from logs

- `plan_iters`: 1 (plan-grounding-check first-try GROUNDED, no replan)
- `impl_iters`: 1 (logic-reviewer iter1 APPROVE, no revision)
- `reviewer_disagreements`: 0 (challenger didn't spawn — Q9)
- `acceptance_first_pass`: yes
- `agents_count by complexity`: 8 (observed) vs ~12 expected for MEDIUM with full review fan-out — Q9 + Q27 deficit
- Output size outliers: not directly measurable
- `_repaired` count: 0
- `force_used` count: 0
- Audit verdict distribution: 14 ok / 1 error / 0 force_used — **error rate 7%, down from 27%**
- error_class breakdown: 1× `schema-validation` (Q28 root cause)

### Quality of actual delivery

| Aspect | Result |
|---|---|
| Diff | 2 files changed (`docs/ROADMAP.md` + `packages/module-contract/src/index.ts`), +42/-4 lines — focused ✓ |
| Plan | 306 lines, Approach Summary + locked-in Constraints + 22 atomic steps ✓ |
| Identity interface | All 10 fields per SPEC.md §3.2 + REFERENCE-osc-context.md §3 ✓ |
| ROADMAP boxes 125-129 | All ticked ✓ |
| analyzer-claims | 12 structured claims, queryable JSON ✓ |
| typecheck/lint/build | passed per acceptance verdict ✓ |
| Blockers caught | 0 (5 info findings, all advisory) — but Q9+Q27 mean we can't trust "0 blockers" |

**Work itself is correct.** All issues found are in pipeline plumbing, not in delivered output.

### Notes

- This run is the **first end-to-end execution of v2.1-polish-bundle** code in production. 7/10 bundle fixes verified working: Q7, Q8, Q11, Q17 (partial — see Q26), Q20, Q22, Q24. The remaining 3 (Q18, Q19, Q23, Q21) work but weren't directly testable from this state.
- The trend on audit-error rate (48% → 27% → 7%) is real signal — Q11 categorization + better prompt examples + cleaner state shape compound.
- Two structural gaps remain (Q9 + Q27 + Q30) that limit how much we can claim about "review quality". Until all three close, the value-prop "multi-perspective adversarial review" is aspirational.

### Additional findings from full state-file read (Q30-Q34)

After the jq-driven query pass, a line-by-line read of `pipeline-state.json` surfaced **5 more issues** that aggregate-shape queries miss — a category of "v1-era legacy fields the v2 driver doesn't maintain":

- **Q30** 🟡 MEDIUM — `state.refs_loaded: []` and `state.refs_dropped_due_to_cap: []`. `DecisionPlugin` `refs-to-load` (Global Rule #13) should inject reference files into agent prompts; never fires. Frontend TS project should at minimum get `perf-react.md` + `security-frontend.md`. Confirmed across both real-task runs on s3-panel — never any refs loaded. **Bundles with Q9 + Q27 into v2.2-review-completeness.**
- **Q31** 🟡 MEDIUM — `phases.planning.iterations: 0` and `phases.implementation.iterations: 0` despite `reviewer_verdicts[].iteration: 1` for both phases. Field defined in schema, never written by v2 driver.
- **Q32** 🟢 LOW — `phases.validation.acceptance_first_pass: false` despite acceptance iter1 PASS verdict. Q22 fix correctly derives `acceptance_first_pass: true` for metrics row by bypassing this stale source field. Cleanup: deprecate field OR populate it.
- **Q33** 🟡 MEDIUM — `state.files.created: []`, `state.files.modified: []` despite git diff showing 2 modified files. v2 driver doesn't write these. `/learn` loses file-level signal; v2.5 cost-aware routing data starved.
- **Q34** 🟢 LOW — `phases.planning.grounding_check: null` despite plan-grounding-check verdict = GROUNDED. Same shape as Q31/Q32.

**Architectural pattern across Q31/Q32/Q34:** v1 markdown-orchestrator wrote rich per-phase summary fields; v2 TypeScript driver writes the underlying `reviewer_verdicts[]` array (correct) but skips the per-phase legacy summary fields. **Q35 umbrella ticket**: schema-hygiene audit — decide per field whether to deprecate (remove + bump major schema_version) or sync (write at verdict-record time). Q33 is similar but the field is high-value, so populate. Q31/Q32/Q34 are cosmetic — deprecate.

**Sibling observations (not filed as Q-items):**
- `logic_vs_challenger_disagreement: false` is vacuously-false because challenger never spawns (Q9). Could be `null` / `"n/a"` until challenger fires. Tied to Q9 — defer.
- `state.task` stores 2600+ chars of raw input including `## Context (read first, in this order)` preamble + leading whitespace + `\n` escapes. Source of slug semantics issue (cross-cutting observation already filed). Not a bug per se but explains why slug = "contextreadfirstinth".
- `checkpoint_results: []` — TDD-only field, correct empty in `regression-only` mode. Not a bug.

---
