# Pipeline: COMPLEX

> **GUARD:** Verify `.claude/pipeline-state.json` exists and validates against `templates/schemas/pipeline-state.schema.json`. Verify `.claude/findings.jsonl` exists. If missing — STOP and initialize from templates first. This is non-negotiable.

## STEP 3 — Context Enrichment

**Phase A:** Dependency Auditor was launched in background during Gate 0 (see `task.md` STEP 2).
Collect its result (`.claude/dependency-audit.md`) now. If not yet complete, wait.
If NOT launched (e.g. reclassified from SIMPLE/MEDIUM), spawn now:
Dependency Auditor (model: **sonnet**) → `~/.claude/agents/dependency-auditor.md`

**Phase B** (parallel, after Phase A):
- Code Analyzer (model: **opus**) → `~/.claude/agents/code-analyzer.md` (Input: task + dependency-audit)
- Research Agent (model: **opus**) → `~/.claude/agents/research.md` (if new lib/API/pattern needed)

**Phase B-verify:** Spawn Context-Doc Verifier (model: **haiku**) → `~/.claude/agents/context-doc-verifier.md` (see `commands/task.md` rule #18). Reads `.claude/analyzer-claims.json` (raw claim list dumped by Code Analyzer) instead of re-deriving.
- `VERIFIED` → continue to Phase C.
- `WARN` → record mismatches in pipeline-state, propagate corrections to Architect/Planner inputs.
- `NEEDS_RERUN` → re-spawn Code Analyzer with mismatches (max 1 retry), then re-verify before Phase C.

**Phase C** (after Phase B-verify):
Spawn Architect (model: **opus**) → `~/.claude/agents/architect.md`
Input: task + `.claude/context-doc.md` + `.claude/dependency-audit.md` + verifier corrections (if WARN)

## STEP 4 — Planning

**4a: Competing Planners (Agent Team)** — spawn a planning team using `TeamCreate`:

Create a team with a **Lead (Synthesizer)** and 3 teammates:

> "We need an implementation plan for: **[task description]**
>
> Context files: `.claude/context-doc.md`, `.claude/dependency-audit.md`, `.claude/architecture-decisions.md` (if exists).
> Each planner reads `~/.claude/agents/planner.md` for output format.
>
> Create 3 teammates with competing mandates:
> - **Minimalist**: simplest plan satisfying all criteria. Prefer existing patterns, reuse everything.
> - **Robust**: most reliable plan. Prioritize error handling, edge cases, resilience.
> - **Reuse**: maximize reuse of existing code. Every step references existing hooks/utils/components.
>
> Rules:
> 1. Each teammate writes their plan to `.claude/plan-[minimalist|robust|reuse].md`
> 2. After all plans are written, teammates review each other's plans: challenge weak spots, flag missed edge cases, point out existing code the others missed
> 3. Lead synthesizes into `.claude/plan.md` taking:
>    - Structure from the clearest plan
>    - Error handling from the robust plan
>    - Reuse opportunities from the reuse plan
>    - Add a synthesis note at top explaining what was taken from each"

**Fallback:** If team spawning fails, fall back to 3 parallel independent planners + orchestrator synthesizes (same mandates, no cross-review).

**4b: Plan Grounding Check.** Spawn Plan Grounding Check (model: **haiku**) → `~/.claude/agents/plan-grounding-check.md` (see `commands/task.md` rule #17). Run BEFORE plan reviewers — no point reviewing logic of a plan whose citations are wrong.
- `GROUNDED` / `NO_CITATIONS` → continue to 4c.
- `NEEDS_REVISION` → re-synthesize via Lead with mismatch table as feedback (do NOT re-run the full team — only the synthesis step). Counts toward the 2-revision limit.

**4c: Plan Review** — spawn 4 parallel reviewers:
- Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`
- Security Agent (model: **opus**) → `~/.claude/agents/security.md`
- Performance Agent (model: **opus**) → `~/.claude/agents/performance.md`

Each receives its agent-specific past-misses block (rule #15).

Any BLOCKER = NEEDS_REVISION. Spawn Planner (model: **opus**) with feedback to revise.
Max 2 revision cycles. If still blocked → escalate to human.

### ⛔ HUMAN GATE 1
Show plan + synthesis note + grounding-check verdict.
If project uses API codegen: ask if API spec has changed.
Otherwise: *"Plan ready. Confirm to proceed?"*

## STEP 5 — Test-First (RED)

> **Guard:** Check `tests_mode` in pipeline-state.json. If `regression-only` → set `phases.test_first.status="skipped"` + `skipped_reason` per rule #29, jump to STEP 6.

**Goal:** Write failing tests BEFORE any implementation code exists.

1. Spawn Test Agent (model: **sonnet**) → `~/.claude/agents/test.md`
   Input: `.claude/plan.md` (Test Specifications section) + `.claude/context-doc.md` + `project_stack` + mode: `test-first`

2. **Verify RED + count match (rule #25c):**
   - `verdict: "RED"` AND `details.totals.failing_expected == phases.test_first.test_spec_count_in_plan` → proceed.
   - Count mismatch → re-spawn Test Agent ONCE with the missing-cases list. Persistent mismatch → STOP, escalate.
   - `verdict: "ERROR"` with `category: "framework-detection-failed"` → STOP (rule #25i, never spawn Implementer).
   - Other `verdict: "ERROR"` → re-run (max 1 retry).
   - `details.totals.passing_unexpected > 0` → investigate before continuing.

3. **Sacred test hashing (rule #25d/e):** sha256 every file in `details.test_files`; store in `phases.test_first.test_files_hashes_post_red`. Write paths list to `.claude/test-files-must-stay-green.json`.

4. Update `.claude/pipeline-state.json` with test files + skeleton files + RED verification + counts + hashes.

**If independent modules exist** (from `.claude/architecture-decisions.md`):
Spawn parallel Test Agents per module — each creates skeletons + tests for its module only. Hash all written files together into one `test-files-must-stay-green.json`.

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer(s). Restore with `git stash pop` if needed.

**If independent modules exist** (from `.claude/architecture-decisions.md`):
Spawn parallel implementers (model: **opus**), each owning a module with no file overlap.
Each reads `~/.claude/agents/implementer.md` + `.claude/plan.md` + `project_stack` + `tests_mode` + test files for their module (if `tdd`).

**Otherwise:** single Implementer (model: **opus**) with checkpoints every 3-5 steps.
Input: `.claude/plan.md` + `.claude/context-doc.md` + `project_stack` + `tests_mode` + test files list (if `tdd`)

After implementation, run `git diff > .claude/diff.txt` once. Reviewers Read this file — diff is **never inlined** in reviewer input (rule #10 file-pointer mode).

**Pre-review steps (orchestrator, no LLM):**
- **CLAUDE.md anti-pattern grep** (rule #16) → write `.claude/antipattern-candidates.md`.
- **Caller-context expansion** (rule #19) → write `.claude/caller-context.md` (5-10 lines per call site, capped at 30 sites).

Spawn 5 parallel reviewers. Each receives **file pointers only** (paths to `.claude/diff.txt`, `.claude/caller-context.md`, `.claude/antipattern-candidates.md`, `.claude/past-misses-{agent}.md`):
- Logic Reviewer (model: **opus**) on changed code
- Challenger Reviewer (model: **opus**) — independent verdict on the same input (rule #20)
- Style Reviewer (model: **sonnet**) on changed code (COMPLEX keeps sonnet for cross-module style nuance)
- Security Agent (model: **opus**) on changed code
- Performance Agent (model: **opus**) on changed code

**Reconcile Logic vs Challenger** (rule #20):
- Both APPROVE → proceed.
- Both REQUEST_CHANGES → merge findings, hand to Implementer.
- Disagreement → record in pipeline-state with `disagreement: yes`, surface side-by-side at Gate 2; do NOT auto-route to Implementer.

If BLOCKING (from any reconciled reviewer) → one more iteration per module (max 2 total). Non-blocking → log.

If API/DB/type changes → spawn Migration Agent (model: **opus**) → `~/.claude/agents/migration.md`

## STEP 6b-pre — Sacred test verification (TDD only, rule #25f)

If `tests_mode=tdd`: recompute sha256 for every file in `phases.test_first.test_files_hashes_post_red`. Diff vs stored hashes. Mismatched paths → `phases.implementation.test_files_modified_by_implementer`. Plan-conformance treats each as blocking finding. Human at Gate 2 either rejects or explicitly approves.

## STEP 6c + STEP 7 (parallel)
Spawn in parallel (independent inputs — all read `.claude/diff.txt` and `.claude/plan.md`):
- Plan Conformance (model: **haiku**) → `~/.claude/agents/plan-conformance.md` (rule #21)
- Acceptance Agent (model: **haiku**) → `~/.claude/agents/acceptance.md`
- Playwright Agent (model: **sonnet**) → `~/.claude/agents/playwright.md` (if frontend with E2E setup)
- UI Consistency (model: **sonnet**) → `~/.claude/agents/ui-consistency.md` (if UI changed)
- API Contract (model: **sonnet**) → `~/.claude/agents/api-contract.md` (if API changed)

Plan Conformance verdicts:
- `CONFORMS` → continue.
- `PARTIAL` → ask Implementer (or relevant module's Implementer if parallel) to finish missing steps. Counts toward STEP 6 iteration limit.
- `DRIFT` → if blocking drift, send back with report. Always surface report at Gate 2.

## STEP 6b — Test Verification
Run test suite via the test command from `project_stack`.
- **`tdd`:** run all tests (test-first + existing). Test-first tests fail → send back to Implementer.
- **`regression-only`:** run existing tests only. No new tests expected. Do NOT spawn Test Agent.
- All pass → proceed. Regressions → send back to Implementer (counts toward STEP 6 iteration limit).
- If no test framework in project → spawn Test Agent (model: **sonnet**) → `~/.claude/agents/test.md` to set up tests (only when `tests_mode: tdd`). COMPLEX keeps sonnet for setup work.

## STEP 7 — Validation
Acceptance / Playwright / UI Consistency / API Contract already spawned in STEP 6c (parallel with Plan Conformance). Collect results.
Run validation commands from CLAUDE.md ("Validation" or "Quality Checks" section). If not defined, detect from `project_stack`.

FAIL → send to Implementer (max 2 total). Still failing → escalate.
