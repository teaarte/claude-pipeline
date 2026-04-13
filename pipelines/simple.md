# Pipeline: SIMPLE

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

## STEP 5 — Implementation
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer. Restore with `git stash pop` if needed.

1. Spawn subagent (model: **opus**) → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + inline context + `project_stack`
   No checkpoints (plan is ≤5 steps).
   Implementer writes both code AND tests (test steps are part of the plan).

2. After implementation, run `git diff` to capture all changes. Spawn 2-3 parallel subagents, passing the diff output + changed file list:
   - Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
   - Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`
   - Security Agent (model: **sonnet**) → `~/.claude/agents/security.md` — **only if** task touches auth, API routes, user input, or data handling. Skip for pure UI/config changes.

3. If BLOCKING issues → one more iteration (max 2 total). Non-blocking → log and proceed.

## STEP 5b — Test Verification
If Implementer wrote tests → run them via the test command from `project_stack`.
If tests fail due to bugs in implementation → send back to Implementer (counts toward STEP 5 iteration limit).
If no test framework in project → skip, note in pipeline-state.

## STEP 6 — Validation
Run validation commands from CLAUDE.md (look for a "Validation" or "Quality Checks" section).
If not defined, detect from `project_stack` and run appropriate checks for the language.

Spawn (model: **sonnet**): Acceptance Agent → `~/.claude/agents/acceptance.md`

If FAIL → send to Implementer (max 2 total iterations). If still failing → escalate.
