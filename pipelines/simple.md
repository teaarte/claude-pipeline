# Pipeline: SIMPLE

> **GUARD:** Verify `.claude/pipeline-state.md` exists before proceeding. If missing — STOP and create it from `~/.claude/templates/pipeline-state.md` first. This is non-negotiable.

## STEP 3 — Context Enrichment
Skip subagents. Orchestrator does inline analysis:
1. Read the target file(s) and their imports
2. Check for existing patterns in nearby files
3. Note reusable code
4. If 5+ files affected or unknown patterns → upgrade to MEDIUM

## STEP 4 — Planning
Spawn subagent (model: **opus**) → `~/.claude/agents/planner.md`
Input: task + inline context from STEP 3
Output: `.claude/plan.md`

**No plan review.** If plan has 6+ steps → upgrade to MEDIUM.

### ⛔ HUMAN GATE 1
Show plan. Ask: *"Plan ready. Confirm to proceed?"*

## STEP 5 — Test-First (RED)

**Goal:** Write failing tests BEFORE any implementation code exists.

1. Spawn Test Agent (model: **sonnet**) → `~/.claude/agents/test.md`
   Input: `.claude/plan.md` (Test Specifications section) + `project_stack` + mode: `test-first`
   The Test Agent will:
   - Create skeleton files (empty classes/services with method signatures from plan)
   - Write tests based on plan's test specifications
   - Run tests and verify RED state (all tests fail because logic is missing)

2. **Verify RED:** Orchestrator checks Test Agent output:
   - `<!-- STATUS: RED -->` = proceed
   - `<!-- STATUS: ERROR -->` = fix skeletons/imports, re-run Test Agent (max 1 retry)
   - Any test unexpectedly passes = investigate before continuing

Update `.claude/pipeline-state.md`: record test files created + RED verification.

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer. Restore with `git stash pop` if needed.

1. Spawn subagent (model: **opus**) → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + inline context + `project_stack` + list of test files from STEP 5
   No checkpoints (plan is ≤5 steps).
   Implementer replaces skeleton stubs with real logic to make tests GREEN.

2. After implementation, run `git diff` to capture all changes. Spawn 2-3 parallel subagents, passing the diff output + changed file list:
   - Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
   - Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`
   - Security Agent (model: **sonnet**) → `~/.claude/agents/security.md` — **only if** task touches auth, API routes, user input, or data handling. Skip for pure UI/config changes.

3. If BLOCKING issues → one more iteration (max 2 total). Non-blocking → log and proceed.

## STEP 6b — Test Verification (GREEN)
Run ALL tests (test-first + existing suite) via the test command from `project_stack`.
- All GREEN → proceed
- Test-first tests fail → send back to Implementer (counts toward STEP 6 iteration limit)
- Existing tests regress → send back to Implementer
- If no test framework in project → skip, note in pipeline-state.

## STEP 7 — Validation
Run validation commands from CLAUDE.md (look for a "Validation" or "Quality Checks" section).
If not defined, detect from `project_stack` and run appropriate checks for the language.

Spawn (model: **sonnet**): Acceptance Agent → `~/.claude/agents/acceptance.md`

If FAIL → send to Implementer (max 2 total iterations). If still failing → escalate.
