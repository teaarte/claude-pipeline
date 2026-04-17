# Pipeline: COMPLEX

> **GUARD:** Verify `.claude/pipeline-state.md` exists before proceeding. If missing — STOP and create it from `~/.claude/templates/pipeline-state.md` first. This is non-negotiable.

## STEP 3 — Context Enrichment

**Phase A:** Dependency Auditor was launched in background during Gate 0 (see `task.md` STEP 2).
Collect its result (`.claude/dependency-audit.md`) now. If not yet complete, wait.
If NOT launched (e.g. reclassified from SIMPLE/MEDIUM), spawn now:
Dependency Auditor (model: **sonnet**) → `~/.claude/agents/dependency-auditor.md`

**Phase B** (parallel, after Phase A):
- Code Analyzer (model: **opus**) → `~/.claude/agents/code-analyzer.md` (Input: task + dependency-audit)
- Research Agent (model: **opus**) → `~/.claude/agents/research.md` (if new lib/API/pattern needed)

**Phase C** (after Phase B):
Spawn Architect (model: **opus**) → `~/.claude/agents/architect.md`
Input: task + `.claude/context-doc.md` + `.claude/dependency-audit.md`

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

**4b: Plan Review** — spawn 4 parallel reviewers:
- Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`
- Security Agent (model: **opus**) → `~/.claude/agents/security.md`
- Performance Agent (model: **opus**) → `~/.claude/agents/performance.md`

Any BLOCKER = NEEDS_REVISION. Spawn Planner (model: **opus**) with feedback to revise.
Max 2 revision cycles. If still blocked → escalate to human.

### ⛔ HUMAN GATE 1
Show plan + synthesis note.
If project uses API codegen: ask if API spec has changed.
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

**If independent modules exist** (from `.claude/architecture-decisions.md`):
Spawn parallel Test Agents per module — each creates skeletons + tests for its module only.

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer(s). Restore with `git stash pop` if needed.

**If independent modules exist** (from `.claude/architecture-decisions.md`):
Spawn parallel implementers (model: **opus**), each owning a module with no file overlap.
Each reads `~/.claude/agents/implementer.md` + `.claude/plan.md` + `project_stack` + `tests_mode` + test files for their module (if `tdd`).

**Otherwise:** single Implementer (model: **opus**) with checkpoints every 3-5 steps.
Input: `.claude/plan.md` + `.claude/context-doc.md` + `project_stack` + `tests_mode` + test files list (if `tdd`)

After implementation, run `git diff` to capture all changes. Spawn 2 parallel reviewers, passing the diff output + changed file list:
- Logic Reviewer (model: **opus**) on changed code
- Style Reviewer (model: **sonnet**) on changed code

If BLOCKING → one more iteration per module (max 2 total). Non-blocking → log.

If API/DB/type changes → spawn Migration Agent (model: **opus**) → `~/.claude/agents/migration.md`

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
- Playwright Agent → `~/.claude/agents/playwright.md` (if frontend with E2E setup)
- UI Consistency → `~/.claude/agents/ui-consistency.md` (if UI changed)
- API Contract → `~/.claude/agents/api-contract.md` (if API changed)

FAIL → send to Implementer (max 2 total). Still failing → escalate.
