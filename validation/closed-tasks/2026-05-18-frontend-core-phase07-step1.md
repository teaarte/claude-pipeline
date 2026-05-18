## t-2026-05-18-implementphase07step — frontend-core Phase 0.7 Step 1 (module-contract overlay primitives)

> **✓ Closed 2026-05-18.** First real-task validation run on v2.2.5 + v2.2.5-followups branch. Surfaced 4 architectural observations now scheduled in v2.2.6 (Items 6-10). **Real ROI signal:** plan-grounding-check + logic-reviewer caught 8 blocking issues at gate-1 BEFORE any code was written — exactly the workflow value v2.2a was designed to deliver. Acceptance PASS first try after gate-1 replan.

- **Project:** `~/Programming/OSC/frontend-core` (TypeScript pnpm monorepo, frontend, Rsbuild 2.x + Module Federation 2.0)
- **Task:** Implement Phase 0.7 Step 1 — extend `packages/module-contract` with TenantContext + ActiveService + enriched ModuleEvent shape per `docs/REFERENCE-osc-architecture.md`. Type-only TS changes across 8 files (5 spec'd + 3 widened by gate-1 revision).
- **Complexity (auto):** medium ✓
- **tests_mode (auto):** regression-only ✓
- **Wall time:** ~50 min (00:57 → 01:48; included Gate-1 reject + 4-point revision + clean impl + 4 reviewers + acceptance PASS + /done force-final)
- **Agents count:** 11 (full fan-out — context-doc-verifier, plan-grounding-check, planner, logic-reviewer×2 (planning + implementation), challenger, style, performance, acceptance, plus 2 nonreview)
- **Verdict:** accepted (with `pipeline_violation: "phase-force-final"` from /done's final-phase force — Q63 root cause)
- **Subjective rating:** 9/10 — pipeline delivered concrete plan-stage value (caught contravariance regression in BaseModuleProps.onEvent retype) that bare CC would have surfaced only after typecheck failure; cost ~20 min overhead vs estimated ~15-30 min saved on the avoided rework cycle.

### Production verifications

| Q (closed in v2.2.5) | Status | Production evidence |
|---|---|---|
| **Q40 bundle abstraction** | ✅ verified | `state.bundle: "code"` (auto-filled by `pipeline_init` from default `pipeline.config.json`). Schema 1.1 enforced. `loadBundle("code", ...)` runs cleanly. |
| **Q9 fan-out** | ✅ stable | `phases.implementation.agents: [implementer, logic-reviewer, challenger-reviewer, style-reviewer, performance]` — same shape as wandr-be / frontend-core 2026-05-17. **4th project-run in a row.** |
| **Q41 cluster — substrate only** | ⚠️ partial | Pure-getter decisions (`refs_to_load`, `security_needed`) return defaults `[]` / `false`. `state.refs_loaded=[]` because classifier-agent auto-spawn was deferred from Item 9 (see Item 6 of v2.2.6). Refs catalog **silently dead** on this run. |
| **Q48 metric observability** | ✅ verified | Metric row carries `force_used: true`, `pipeline_violation: "phase-force-final"`, `started_at`, `ended_at`, `gate2_revisions: 0`, `reviewer_count: 7`. **First production confirmation of the Q48 fix from v2.2.5 Item 11.** |
| **Q47 gate revision counters** | ✅ verified | `gate1_revisions: 1` (one Gate-1 reject), `gate2_revisions: 0`. Counters persist on `state.phases.{planning,implementation}.gate*_revisions`. |
| **Q57 structured gate-answer** | ✅ verified | Gate-0 accept + Gate-1 reject-with-message both went through structured `{decision, message}` shape. No regex classification at gates. |
| **Q50 stack-detect comment-strip** | ✅ verified | `stack.test_command: "pnpm -r test"` — no trailing CLAUDE.md `# vitest run` comment. (Pre-v2.2.5 frontend-core run had carry-over comment.) |
| **Q22/Q33/Q37 metric row stack** | ✅ verified | `stack.{language, package_manager, test_command, lint_command, build_command, project_type}` all populated correctly: `typescript / pnpm / pnpm -r test / pnpm -r lint / pnpm -r build / monorepo`. |
| **Q42 reviewer_verdicts[].phase** | ✅ verified | All 8 verdicts have `phase`; logic-reviewer distinguishable across `planning` (iter=1) and `implementation` (iter=2). |
| **Q43 impl_iters/plan_iters derive** | ✅ verified | `impl_iters: 4` (4 reviewers in impl), `plan_iters: 2` (plan-grounding + logic-reviewer in planning). |

### Pipeline value delivered (concrete)

**Gate-1 phase (the highest-value moment):**

- **plan-grounding-check NEEDS_REVISION** — caught 7 blocking `citation-claim-mismatch` issues: planner's plan cited `docs/REFERENCE-glossary.md` line numbers that drifted by 1-2 from the actual file (e.g. plan said `## B at line 27`; actually line 26). Eight total citations off across "Auth fetcher", "authFetcher", "## B", "## C", "Capability" anchors. Without this check the implementer would have applied edits with wrong line anchors → silent mis-edits OR confusion at review time.

- **logic-reviewer REQUEST_CHANGES caught a real type-system regression** — *"Retyping `BaseModuleProps.onEvent` to `(ModuleEventInput)=>void` breaks apps/core+playground typecheck under strictFunctionTypes; conflicts with AC-14/AC-15."* Proposed 3 fix options. User picked Option A (widen scope to surgical retypes in `apps/core/{App,ModuleHost}.tsx` + `apps/playground/App.tsx`). **This is the workflow ROI the architecture was designed for** — catch logical incompatibility BEFORE writing code, not at typecheck failure post-impl.

**Gate-1 user feedback (substantive human engagement):**

4-point revision delivered to planner: (1) apply Option A; (2) collapse Steps 3+4 to avoid transient broken state; (3) add Step 13f for glossary update; (4) refresh 7 drifted citations. Each point traceable to a specific reviewer finding. Forced gate-1 review made the user inspect plan carefully.

**Implementation phase (lower marginal value on this task type):**

After replan, single implementer pass produced 8 files matching spec. 4 reviewers (logic / challenger / style / performance) all APPROVE. Challenger surfaced 3 info-severity observations for future tasks (identity-name collision, shape-test weakness, optional crash-hazard). Style + performance reviewers contributed 0 findings — for a **type-only TS diff** their structural role is empty; pure overhead on this task type → motivates v2.2.6 Item 7 (reviewer selectivity by `change_kind`).

### New Q-items / observations surfaced

Five new findings, all scheduled into **v2.2.6 stack-classifier phase** (Items 6-10):

| New Q | Severity | What | Where in v2.2.6 |
|---|---|---|---|
| (was deferred from v2.2.5 Item 9) | 🟡 MEDIUM | **Classifier auto-spawn silent omission.** `state.refs_loaded=[]`; refs catalog dormant. Auto-spawn was deferred for test-rework cost; observed cost is now bigger. | Item 6 |
| (was deferred from v2.2.5 Item 9) | 🟡 MEDIUM | **Reviewer selectivity by `change_kind`.** style + performance wasted ~10K tokens with 0 findings on a type-only diff. Classifier should emit `change_kind: "type-only" \| ...`; flow consults `AgentPlugin.relevant_for_change_kinds?[]` before spawning. | Item 7 |
| (newly observed) | 🟡 MEDIUM | **Canonical `task_id` propagation.** Reviewer findings (challenger, style, performance, acceptance, impl-phase logic) emitted with `task_id: "phase-0.7-step-1"` (semantic, extracted from task prose) instead of canonical `t-2026-05-18-implementphase07step`. **Breaks cross-task analytics.** Spawn-context needs "Canonical identifiers" block + defensive runtime check on record. | Item 8 |
| (newly observed) | 🟡 MEDIUM | **Implementer tech-debt → issues-found.md auto-capture.** Implementer mentioned "Pre-existing prettier debt in repo (19 files)" in output prose, but `.claude/issues-found.md` was never written. /sweep workflow handoff silently lost. Need explicit template instruction + backfill hook on implementer output. | Item 9 |
| **Q63** (newly filed) | 🟡 MEDIUM | **`pipeline_violation: "phase-force-final"` on every successful run.** After acceptance:PASS, validation phase stays `in_progress` → `/done` trips INV_007 → user force-sets final → violation marker permanently in metric row. **Destroys the signal value of `force_used`/`pipeline_violation` columns just added in v2.2.5 Item 11.** Fix: auto-close validation on acceptance:PASS + clean open_spawns; auto-close final on clean success in `pipeline_finish`. | Item 10 |

### Cross-cutting observations

1. **Reviewer asymmetry by phase.** Planning-phase reviewers (plan-grounding + logic-reviewer) carried the value; implementation-phase reviewers (4 of them) added marginal info-only findings. For **type-only** changes specifically: ~75% of impl-phase reviewer tokens were noise. Strong motivation for Item 7 (change_kind-based selectivity).

2. **past-misses dormant on first task per project.** All 5 reviewer past-misses files emitted `(no past-miss data)` — expected for a fresh project (per-project history hasn't accumulated). Will need 10-20 task runs on the same project to test whether the past-misses feature actually catches recurring patterns OR if it's just an artifact-emission ceremony.

3. **anti-pattern-grep degraded gracefully.** Frontend-core CLAUDE.md doesn't carry a `<!-- antipattern -->` marker block or English "What NOT to do" header → hook emitted `(no formalizable rules)` placeholder. Hook works as designed, but the feature contributes zero on this project. Documents the need for projects to author structured anti-pattern blocks (v2.2.6 CLAUDE.md authoring doc updates).

4. **driver-state.json hit ~29 KB** before /done cleanup. Rich agent-output history was discarded by `pipeline_done_cleanup`. Strong motivation for v2.3.2 SQLite snapshot-on-clean (the expanded schema covers this exact case).

### Pipeline workflow friction observed

- **Validation phase + final phase don't auto-close after success.** Required manual force-finalize at /done. → Q63 (Item 10 v2.2.6).
- **/done ritual after a clean success was ~10 minutes** of state-validation + force + summary. With Q63 fix this should drop to <2 min.
- **No alternative to gate-2 reject + ship** (Q54 unchanged) — orthogonal to Q63 but same workflow region; both will need v2.6 curator era to resolve cleanly.

### What this run validates vs what it doesn't

**Validates:**
- v2.2.5 substrate (bundle, schema 1.1, structured user-answer, metric row observability) — all working on a real task.
- v2.2.a multi-reviewer fan-out pattern — 4th project-run in a row holding shape.
- Gate-1 multi-reviewer plan review delivers concrete value (8 blocking issues caught pre-impl).
- Q22/Q33/Q37/Q42/Q43/Q47/Q48/Q50/Q57 production-verified in one task.

**Does NOT validate:**
- Classifier-agent flow (deferred — refs catalog silently dead).
- past-misses recurrence detection (no history yet).
- Anti-pattern rule matching (no rules in CLAUDE.md).
- Reviewer effectiveness by task type (need ≥5 runs of different shapes to see pattern).
- Cross-task project memory benefits (need 10+ runs).

### Files referenced

- v2.2.6 phase spec: [`specs/phases/v2.2.6-stack-classifier.md`](../../specs/phases/v2.2.6-stack-classifier.md) — Items 6-10 derived from this run.
- v2.2.5 bundle: [`specs/phases/v2.2.5-bundle-foundation.md`](../../specs/phases/v2.2.5-bundle-foundation.md) — substrate validated here.
- v2.2.5-followups: [`specs/v2.2.5-followups.md`](../../specs/v2.2.5-followups.md) — fixes applied before this run.

### Recommended next steps after this entry

1. Merge v2.2.5-bundle-foundation branch (incl. followups + this validation entry) to main.
2. Schedule v2.2.6 — Items 6-10 are the highest-priority follow-up; without them the next /task run reproduces all five issues observed here.
3. Run 2-3 more /task on different project shapes (UI-heavy, auth-touching, perf-sensitive) BEFORE starting v2.2.6 to validate that Item 7 reviewer-selectivity targets the right reviewer×task-type matrix.
