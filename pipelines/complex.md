# Pipeline: COMPLEX

## STEP 3 — Context Enrichment

**Phase A** (sequential):
Spawn Dependency Auditor (model: **sonnet**) → `~/.claude/agents/dependency-auditor.md`
Wait for `.claude/dependency-audit.md`.

**Phase B** (parallel, after Phase A):
- Code Analyzer (model: **sonnet**) → `~/.claude/agents/code-analyzer.md` (Input: task + dependency-audit)
- Research Agent (model: **opus**) → `~/.claude/agents/research.md` (if new lib/API/pattern needed)

**Phase C** (after Phase B):
Spawn Architect (model: **opus**) → `~/.claude/agents/architect.md`
Input: task + `.claude/context-doc.md` + `.claude/dependency-audit.md`

## STEP 4 — Planning

**4a: Competing Planners** — spawn 3 parallel subagents (model: **opus**), each reading `~/.claude/agents/planner.md`:

- **Minimalist**: simplest plan satisfying all criteria. Prefer existing patterns, reuse everything.
- **Robust**: most reliable plan. Prioritize error handling, edge cases, resilience.
- **Reuse**: maximize reuse of existing code. Every step references existing hooks/utils/components.

All read: task + `.claude/context-doc.md` + `.claude/dependency-audit.md`.
Each writes to `.claude/plan-[minimalist|robust|reuse].md`.

**Orchestrator synthesizes** into `.claude/plan.md`:
- Structure from clearest plan
- Error handling from robust plan
- Reuse opportunities from reuse plan
- Synthesis note at top

**4b: Plan Review** — spawn 4 parallel reviewers:
- Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`
- Security Agent (model: **sonnet**) → `~/.claude/agents/security.md`
- Performance Agent (model: **sonnet**) → `~/.claude/agents/performance.md`

Any BLOCKER = NEEDS_REVISION. Spawn Planner (model: **opus**) with feedback to revise.
Max 2 revision cycles. If still blocked → escalate to human.

### ⛔ HUMAN GATE 1
Show plan + synthesis note.
If project uses API codegen: ask if API spec has changed.
Otherwise: *"Plan ready. Confirm to proceed?"*

## STEP 5 — Implementation

**If independent modules exist** (from `.claude/architecture-decisions.md`):
Spawn parallel implementers (model: **opus**), each owning a module with no file overlap.
Each reads `~/.claude/agents/implementer.md` + `.claude/plan.md`.

**Otherwise:** single Implementer (model: **opus**) with checkpoints every 3-5 steps.

After implementation, spawn 2 parallel reviewers:
- Logic Reviewer (model: **opus**) on all changed code
- Style Reviewer (model: **sonnet**) on all changed code

If BLOCKING → one more iteration per module (max 2 total). Non-blocking → log.

If API/DB/type changes → spawn Migration Agent (model: **opus**) → `~/.claude/agents/migration.md`

## STEP 6 — Validation
Run validation commands from CLAUDE.md (look for a "Validation" or "Quality Checks" section).
If not defined, detect from project and run: typecheck → build → lint.

Spawn in parallel (model: **sonnet**):
- Acceptance Agent → `~/.claude/agents/acceptance.md`
- Test Agent → `~/.claude/agents/test.md`
- Playwright Agent → `~/.claude/agents/playwright.md`
- UI Consistency → `~/.claude/agents/ui-consistency.md` (if UI changed)
- API Contract → `~/.claude/agents/api-contract.md` (if API changed)

FAIL → send to Implementer (max 2 total). Still failing → escalate.
