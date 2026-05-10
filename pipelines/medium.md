# Pipeline: MEDIUM

> **GUARD:** Verify `.claude/pipeline-state.json` exists and validates against `templates/schemas/pipeline-state.schema.json`. Verify `.claude/findings.jsonl` exists. If missing — STOP and initialize from templates first. This is non-negotiable.

## STEP 3 — Context Enrichment
Dependency Auditor and Code Analyzer were launched in background during Gate 0 (see `task.md` STEP 2).
Collect their results now. If not yet complete, wait.

If enrichment was NOT launched (e.g. reclassified from SIMPLE), spawn now in parallel:
- Dependency Auditor (model: **haiku**) → `~/.claude/agents/dependency-auditor.md` (Input: task + complexity)
- Code Analyzer (model: **sonnet**) → `~/.claude/agents/code-analyzer.md` (Input: task)

Additionally, if new lib/API/pattern needed:
- Research Agent (model: **opus**) → `~/.claude/agents/research.md`

Wait for all to complete.

**3b: Context-Doc Verification.** Spawn Context-Doc Verifier (model: **haiku**) → `~/.claude/agents/context-doc-verifier.md` (see `commands/task.md` rule #18). Reads `.claude/analyzer-claims.json` (raw claim list dumped by Code Analyzer) instead of re-deriving from source files.
- `VERIFIED` → continue.
- `WARN` → record mismatches in pipeline-state, inject them into Planner input as corrections.
- `NEEDS_RERUN` → re-spawn Code Analyzer with mismatches as feedback (max 1 retry), then re-verify.

## STEP 4 — Planning

**4a:** Spawn Planner (model: **opus**) → `~/.claude/agents/planner.md`
Input: task + `.claude/context-doc.md` + review feedback (if iteration > 1) + verifier corrections (if WARN at STEP 3b)
Output: `.claude/plan.md`

**4b: Plan Grounding Check.** Spawn Plan Grounding Check (model: **haiku**) → `~/.claude/agents/plan-grounding-check.md` (see `commands/task.md` rule #17).
- `GROUNDED` / `NO_CITATIONS` → continue to 4c.
- `NEEDS_REVISION` → re-spawn Planner with mismatch table as feedback. Counts toward the 2-iteration plan-revision limit.

**4c:** Spawn 2 parallel reviewers:
- Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer (model: **haiku**) → `~/.claude/agents/style-reviewer.md` (haiku-conditional: if CLAUDE.md style section is sparse, upgrade to sonnet — see routing table)

Both reviewers receive `.claude/past-misses-{agent}.md` (cached once per pipeline run, not re-derived per spawn).

Exit when: both APPROVE — or 2 iterations reached (warn user, ask to proceed).

### ⛔ HUMAN GATE 1
Show plan + grounding-check verdict.
If project uses API codegen (Orval, OpenAPI generator, etc.): ask if API spec has changed.
Otherwise: *"Plan ready. Confirm to proceed?"*

## STEP 5 — Test-First (RED)

> **Guard:** Check `tests_mode` in pipeline-state.json. If `regression-only` → set `phases.test_first.status="skipped"` and `phases.test_first.skipped_reason` per rule #29, then jump to STEP 6.

**Goal:** Write failing tests BEFORE any implementation code exists.

1. Spawn Test Agent (model: **haiku**) → `~/.claude/agents/test.md`
   Input: `.claude/plan.md` (Test Specifications section) + `.claude/context-doc.md` + `project_stack` + mode: `test-first`
   The Test Agent will:
   - Create skeleton files (empty classes/services with method signatures from plan)
   - Create DTOs with correct decorators
   - Write tests based on plan's test specifications (mechanical AAA translation)
   - Run tests and verify RED state (all tests fail because logic is missing)

2. **Verify RED:** Orchestrator parses Test Agent's JSON header:
   - `verdict: "RED"` AND `details.totals.failing_expected == phases.test_first.test_spec_count_in_plan` → proceed.
   - `verdict: "RED"` but count mismatch → re-spawn Test Agent ONCE with missing-cases list (rule #25c). If still mismatched → STOP.
   - `verdict: "ERROR"` with `category: "framework-detection-failed"` → STOP (rule #25i).
   - `verdict: "ERROR"` (other) = fix skeletons/imports, re-run Test Agent (max 1 retry).
   - `details.totals.passing_unexpected > 0` = investigate before continuing.

3. **Sacred test hashing (rule #25d/e):** for every file in `details.test_files`, sha256 it; store in `phases.test_first.test_files_hashes_post_red`. Write the file paths list to `.claude/test-files-must-stay-green.json`.

4. Update `.claude/pipeline-state.json`: record test files + skeleton files + RED verification + counts + hashes.

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer. Restore with `git stash pop` if needed.

1. Spawn Implementer (model: **opus**) → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + `.claude/context-doc.md` + `project_stack` + `tests_mode` + test files list (if `tdd`)

   **Checkpoints (5+ step plans):** Implementer pauses every 3-5 steps with interim report.
   If concerns → spawn Logic Reviewer (model: **opus**) on changed files. If BLOCKING → fix before continuing.

2. After implementation, run `git diff > .claude/diff.txt` once. Reviewers Read this file — diff is **never inlined** in reviewer input (rule #10 file-pointer mode).

   **Pre-review steps (orchestrator, no LLM):**
   - **CLAUDE.md anti-pattern grep** (rule #16) → write `.claude/antipattern-candidates.md`.
   - **Caller-context expansion** (rule #19) → write `.claude/caller-context.md` (5-10 lines per call site, capped at 30 sites).

3. Spawn 5 parallel reviewers. Each receives **file pointers only** (paths to `.claude/diff.txt`, `.claude/caller-context.md`, `.claude/antipattern-candidates.md`, `.claude/past-misses-{agent}.md`):
   - Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
   - Challenger Reviewer (model: **opus**) → `~/.claude/agents/challenger-reviewer.md` (rule #20 — runs alongside Logic, independent verdict)
   - Style Reviewer (model: **haiku**) — conditional: sonnet if CLAUDE.md style section sparse
   - Security Agent (model: **sonnet**) → `~/.claude/agents/security.md`
   - Performance Agent (model: **sonnet**) → `~/.claude/agents/performance.md`

4. **Reconcile Logic vs Challenger** (rule #20):
   - Both APPROVE → proceed.
   - Both REQUEST_CHANGES → merge findings, hand to Implementer.
   - Disagreement → record in pipeline-state, surface at Gate 2; do NOT auto-route to Implementer on disagreement.

5. If BLOCKING (from any reconciled reviewer) → one more iteration (max 2 total). Non-blocking → log and proceed.

6. If API/DB/type changes → spawn Migration Agent (model: **opus**) → `~/.claude/agents/migration.md`

## STEP 6b-pre — Sacred test verification (TDD only, rule #25f)

If `tests_mode=tdd`: recompute sha256 for every file in `phases.test_first.test_files_hashes_post_red`. Diff vs stored hashes. Mismatched paths → write to `phases.implementation.test_files_modified_by_implementer`. Plan-conformance will treat each as blocking finding `category: "test-file-modified-by-implementer"`. Surface to human at Gate 2 — they can either reject or explicitly approve the modification.

## STEP 6c + STEP 7 (parallel)
Spawn in parallel (independent inputs — both read `.claude/diff.txt` and `.claude/plan.md`):
- Plan Conformance (model: **haiku**) → `~/.claude/agents/plan-conformance.md` (rule #21; reads `phases.implementation.test_files_modified_by_implementer` for sacred-test check)
- Acceptance Agent (model: **haiku**) → `~/.claude/agents/acceptance.md` (BLOCKING on missing test coverage when tdd, per rule #8 fix)
- UI Consistency (model: **haiku**) → `~/.claude/agents/ui-consistency.md` (if UI changed)
- API Contract (model: **haiku**) → `~/.claude/agents/api-contract.md` (if API changed)

Plan Conformance verdicts:
- `CONFORMS` → proceed to STEP 6b.
- `PARTIAL` → ask Implementer to finish missing steps (counts toward STEP 6 iteration limit).
- `DRIFT` → if blocking drift, send back to Implementer with the report. Always show report at Gate 2.

## STEP 6b — Test Verification
Run test suite via the test command from `project_stack`.
- **`tdd`:** run all tests (test-first + existing). Test-first tests fail → send back to Implementer.
- **`regression-only`:** run existing tests only. No new tests expected. Do NOT spawn Test Agent.
- All pass → proceed. Regressions → send back to Implementer (counts toward STEP 6 iteration limit).
- If no test framework in project → spawn Test Agent (model: **haiku**) → `~/.claude/agents/test.md` to set up tests (only when `tests_mode: tdd`).

## STEP 7 — Validation
Acceptance / UI Consistency / API Contract already spawned in STEP 6c (parallel with Plan Conformance). Collect results.
Run validation commands from CLAUDE.md ("Validation" or "Quality Checks" section). If not defined, detect from `project_stack`.

FAIL → send to Implementer (max 2 total). Still failing → escalate.
