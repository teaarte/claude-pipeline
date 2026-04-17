# Pipeline: MEDIUM

> **GUARD:** Verify `.claude/pipeline-state.md` exists before proceeding. If missing — STOP and create it from `~/.claude/templates/pipeline-state.md` first. This is non-negotiable.

## STEP 3 — Context Enrichment
Dependency Auditor and Code Analyzer were launched in background during Gate 0 (see `task.md` STEP 2).
Collect their results now. If not yet complete, wait.

If enrichment was NOT launched (e.g. reclassified from SIMPLE), spawn now in parallel (model: **sonnet**):
- Dependency Auditor → `~/.claude/agents/dependency-auditor.md` (Input: task + complexity)
- Code Analyzer → `~/.claude/agents/code-analyzer.md` (Input: task)

Additionally, if new lib/API/pattern needed:
- Research Agent (model: **opus**) → `~/.claude/agents/research.md`

Wait for all to complete.

## STEP 4 — Planning

**4a:** Spawn Planner (model: **opus**) → `~/.claude/agents/planner.md`
Input: task + `.claude/context-doc.md` + review feedback (if iteration > 1)
Output: `.claude/plan.md`

**4b:** Spawn 2 parallel reviewers:
- Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`

Exit when: both APPROVE — or 2 iterations reached (warn user, ask to proceed).

### ⛔ HUMAN GATE 1
Show plan.
If project uses API codegen (Orval, OpenAPI generator, etc.): ask if API spec has changed.
Otherwise: *"Plan ready. Confirm to proceed?"*

## STEP 5 — Test-First (RED)

> **Guard:** Check `tests_mode` in pipeline-state.md. If `regression-only` → skip to STEP 6.

**Goal:** Write failing tests BEFORE any implementation code exists.

1. Spawn Test Agent (model: **sonnet**) → `~/.claude/agents/test.md`
   Input: `.claude/plan.md` (Test Specifications section) + `.claude/context-doc.md` + `project_stack` + mode: `test-first`
   The Test Agent will:
   - Create skeleton files (empty classes/services with method signatures from plan)
   - Create DTOs with correct decorators
   - Write tests based on plan's test specifications
   - Run tests and verify RED state (all tests fail because logic is missing)

2. **Verify RED:** Orchestrator checks Test Agent output:
   - `<!-- STATUS: RED -->` = proceed
   - `<!-- STATUS: ERROR -->` = fix skeletons/imports, re-run Test Agent (max 1 retry)
   - Any test unexpectedly passes = investigate before continuing

3. Update `.claude/pipeline-state.md`: record test files + skeleton files created + RED verification.

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer. Restore with `git stash pop` if needed.

1. Spawn Implementer (model: **opus**) → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + `.claude/context-doc.md` + `project_stack` + `tests_mode` + test files list (if `tdd`)

   **Checkpoints (5+ step plans):** Implementer pauses every 3-5 steps with interim report.
   If concerns → spawn Logic Reviewer (model: **opus**) on changed files. If BLOCKING → fix before continuing.

2. After implementation, run `git diff` to capture all changes. Spawn 4 parallel reviewers, passing the diff output + changed file list:
   - Logic Reviewer (model: **opus**)
   - Style Reviewer (model: **sonnet**)
   - Security Agent (model: **sonnet**) → `~/.claude/agents/security.md`
   - Performance Agent (model: **sonnet**) → `~/.claude/agents/performance.md`

3. If BLOCKING → one more iteration (max 2 total). Non-blocking → log and proceed.

4. If API/DB/type changes → spawn Migration Agent (model: **opus**) → `~/.claude/agents/migration.md`

## STEP 6b — Test Verification
Run test suite via the test command from `project_stack`.
- **`tdd`:** run all tests (test-first + existing). Test-first tests fail → send back to Implementer.
- **`regression-only`:** run existing tests only. No new tests expected. Do NOT spawn Test Agent.
- All pass → proceed. Regressions → send back to Implementer (counts toward STEP 6 iteration limit).
- If no test framework in project → spawn Test Agent (model: **sonnet**) → `~/.claude/agents/test.md` to set up tests (only when `tests_mode: tdd`).

## STEP 7 — Validation
Run validation commands from CLAUDE.md (look for a "Validation" or "Quality Checks" section).
If not defined, detect from `project_stack` and run appropriate checks for the language.

Spawn in parallel (model: **sonnet**):
- Acceptance Agent → `~/.claude/agents/acceptance.md`
- UI Consistency → `~/.claude/agents/ui-consistency.md` (if UI changed)
- API Contract → `~/.claude/agents/api-contract.md` (if API changed)

FAIL → send to Implementer (max 2 total). Still failing → escalate.
