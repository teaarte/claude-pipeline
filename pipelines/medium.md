# Pipeline: MEDIUM

## STEP 3 — Context Enrichment
Spawn in parallel:
- Dependency Auditor → `~/.claude/agents/dependency-auditor.md` (Input: task + complexity)
- Code Analyzer → `~/.claude/agents/code-analyzer.md` (Input: task)
- Research Agent → `~/.claude/agents/research.md` (only if new lib/API/pattern needed)

Wait for all to complete.

## STEP 4 — Planning

**4a:** Spawn Planner → `~/.claude/agents/planner.md`
Input: task + `.claude/context-doc.md` + review feedback (if iteration > 1)
Output: `.claude/plan.md`

**4b:** Spawn 2 parallel reviewers:
- Logic Reviewer → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer → `~/.claude/agents/style-reviewer.md`

Exit when: both APPROVE — or 3 iterations reached (warn user, ask to proceed).

### ⛔ HUMAN GATE 1
Show plan.
If project uses API codegen (Orval, OpenAPI generator, etc.): ask if API spec has changed.
Otherwise: *"Plan ready. Confirm to proceed?"*

## STEP 5 — Implementation

1. Spawn Implementer → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + `.claude/context-doc.md`

   **Checkpoints (5+ step plans):** Implementer pauses every 3-5 steps with interim report.
   If concerns → spawn Logic Reviewer on changed files. If BLOCKING → fix before continuing.

2. After implementation, spawn 4 parallel reviewers:
   - Logic Reviewer (on code)
   - Style Reviewer (on code)
   - Security Agent → `~/.claude/agents/security.md`
   - Performance Agent → `~/.claude/agents/performance.md`

3. If BLOCKING → one more iteration (max 2 total). Non-blocking → log and proceed.

4. If API/DB/type changes → spawn Migration Agent → `~/.claude/agents/migration.md`

## STEP 6 — Validation
Run validation commands from CLAUDE.md (look for a "Validation" or "Quality Checks" section).
If not defined, detect from project and run: typecheck → build → lint.

Spawn in parallel:
- Acceptance Agent → `~/.claude/agents/acceptance.md`
- Test Agent → `~/.claude/agents/test.md`
- UI Consistency → `~/.claude/agents/ui-consistency.md` (if UI changed)
- API Contract → `~/.claude/agents/api-contract.md` (if API changed)

FAIL → send to Implementer (max 2 total). Still failing → escalate.
