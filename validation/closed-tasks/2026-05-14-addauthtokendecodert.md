## t-2026-05-14-addauthtokendecodert — Add auth-token decoder to core bootstrap

> **✓ Closed 2026-05-14.** First task deliberately chosen to surface Q9 root cause — security-touched diff should trigger 5-reviewer fan-out per spec. **Q9 root cause definitively identified.** New Q43 surfaced (impl_iters derivation overcount). Auto-`/done` ran cleanly.
>
> **Production verifications (mostly same as Step 4 — all hold):**
> - Q17 + Q26 + Q37 stack threading end-to-end (`project_type: "monorepo"`)
> - Q22 metrics row: `tests_mode: "regression-only"`, `plan_iters: 1`, `gate1_revisions: 0`, `verdict: "accepted"`, `acceptance_first_pass: true`, `blockers_found: 1`
> - Q23 cleanup perfect (only `settings.local.json` remains, no `mcp-audit.jsonl` stub)
> - Q24/Q36 Stop hook with `flow=medium step=X`, no stale "STEP 1"
> - **task_id slug WAS reasonable** this time (`addauthtokendecodert`) — this task didn't have the `## Context (read first...)` preamble that Q42 triggers on. Q42 still real, just doesn't fire on every task.
>
> **Q9 — DEFINITIVE ROOT CAUSE (5th recurrence, finally diagnosed):**
> Mid-flight inspection of `driver-state.decisions` revealed:
> ```json
> { "complexity": "medium", "tests_mode": "regression-only",
>   "refs_to_load": ["security-backend.md"] }
> ```
> **`security_needed`, `ui_touched`, `api_touched` are absent — never computed at all.** Their DecisionPlugins exist in registry but no flow step invokes them. Therefore `applies_to` predicates on gated reviewers (challenger, style, security, performance) evaluate against undefined → false → never spawn. Implementation phase agents this run: `[implementer, logic-reviewer]` only. Validation: `[acceptance]` only. Same as 4 prior runs.
>
> **Eliminated hypotheses:** (a) "predicates too aggressive returning false" — predicates never run; (b) "spawn step bug" — we don't reach spawn for those reviewers; (c) "Gate 1 revision resets decisions" — this run HAD a planning REQUEST_CHANGES → revision → APPROVE cycle, and decisions are STILL missing those three keys.
>
> **Q9 concrete fix scope:** add a "compute-review-decisions" step (or extend `classify` step) in `builtin/flows/{medium,complex}.ts` that calls `state.invokeDecision('security-needed' | 'ui-touched' | 'api-touched')` BEFORE the `review` step. Verification: `driver-state.decisions` should contain all three keys after planning phase closes. **~1-2h fix** (was estimated 2-3h; narrowing root cause shrank it).
>
> **Q43 NEW — `impl_iters` derivation overcount:**
> Metric row shows `impl_iters: 2` for this task. Reality: implementation review loop was a single pass (logic-reviewer APPROVE first try in implementation). Root cause: iteration counter on `reviewer_verdicts[]` is **global per agent across phases** (logic-reviewer iter=1 in planning, iter=2 in implementation = "2nd time this agent ran overall"). Q22 derive `max(iteration) WHERE phase=implementation` reads 2. Should be 1. Fix: change derive to `count(verdicts WHERE phase=X)` in `tools/finish.ts`. ~30min. Filed.
>
> **Recurrences (expected per known open Q-items):**
> - Q9 — under-spawning (5th time; now with root cause)
> - Q27 — all 4 pre-review infra files absent (`diff.txt`, `caller-context.md`, `antipattern-candidates.md`, `past-misses-*.md`)
> - Q30 — `pipeline-state.refs_loaded: []` despite `decisions.refs_to_load: ["security-backend.md"]` populated
> - Q41 — refs-to-load picked single security-backend.md on frontend monorepo. Less bad than Step 4's 5-backend-refs dump but still stack-blind.
>
> **Logic-reviewer caught a real issue.** Planning iter=1 verdict REQUEST_CHANGES with categories `[type-confusion, regression-risk, missing-edge-case]`. Real value delivered even with 1/5 review fan-out. Adversarial multi-perspective review (Q9 fix) would multiply this signal.
>
> **Categories used:** `type-confusion`, `regression-risk`, `missing-edge-case`, `race-condition`. All canonical vocab — no `other` fallback this run.
>
> **Audit:** 1/14 = 7% error rate (1× schema-validation, retry-recovered).

---
