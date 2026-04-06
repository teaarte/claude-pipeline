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
1. Spawn subagent (model: **opus**) → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + inline context
   No checkpoints (plan is ≤5 steps).

2. After implementation, spawn 2 parallel subagents:
   - Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
   - Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`

3. If BLOCKING issues → one more iteration (max 2 total). Non-blocking → log and proceed.

## STEP 6 — Validation
Run validation commands from CLAUDE.md (look for a "Validation" or "Quality Checks" section).
If not defined, detect from project: check `package.json` for npm scripts, `pyproject.toml`/`setup.py` for Python, `Makefile` for make targets.

Spawn (model: **sonnet**): Acceptance Agent → `~/.claude/agents/acceptance.md`

If FAIL → send to Implementer (max 2 total iterations). If still failing → escalate.
