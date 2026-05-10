# Pipeline: SIMPLE

> **GUARD:** Verify `.claude/pipeline-state.json` exists and validates against `templates/schemas/pipeline-state.schema.json`. Verify `.claude/findings.jsonl` exists (may be empty). If missing — STOP and initialize from `~/.claude/templates/pipeline-state.json` + `templates/pipeline-state-summary.md` first. This is non-negotiable.

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

**Plan Grounding Check** (model: **haiku**) → `~/.claude/agents/plan-grounding-check.md`. Run if plan has any `path:line` citation. `NEEDS_REVISION` → re-spawn Planner once with mismatch table, then proceed.

### ⛔ HUMAN GATE 1
Show plan. Ask: *"Plan ready. Confirm to proceed?"*

## STEP 5 — Test-First (RED)

> **Guard:** Check `tests_mode` in pipeline-state.json. If `regression-only` → set `phases.test_first.status="skipped"` + `skipped_reason` per rule #29, jump to STEP 6.

**Goal:** Write failing tests BEFORE any implementation code exists.

1. Spawn Test Agent (model: **haiku**) → `~/.claude/agents/test.md`
   Input: `.claude/plan.md` (Test Specifications section) + `project_stack` + mode: `test-first`

2. **Verify RED + count match (rule #25c):**
   - `verdict: "RED"` AND `details.totals.failing_expected == phases.test_first.test_spec_count_in_plan` → proceed.
   - Count mismatch → re-spawn Test Agent ONCE with missing-cases list. Persistent mismatch → STOP.
   - `verdict: "ERROR"` with `category: "framework-detection-failed"` → STOP (rule #25i).
   - Other `verdict: "ERROR"` → re-run (max 1 retry).
   - `details.totals.passing_unexpected > 0` → investigate.

3. **Sacred test hashing (rule #25d/e):** sha256 every file in `details.test_files`; store in `phases.test_first.test_files_hashes_post_red`. Write paths list to `.claude/test-files-must-stay-green.json`.

Update `.claude/pipeline-state.json`: record test files created + RED verification + counts + hashes.

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer. Restore with `git stash pop` if needed.

1. Spawn subagent (model: **opus**) → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + inline context + `project_stack` + `tests_mode` + test files list (if `tdd`)
   No checkpoints (plan is ≤5 steps).

2. After implementation, run `git diff` to capture all changes.

   **Pre-review (orchestrator, no LLM):** Run CLAUDE.md anti-pattern grep (rule #16) → `.claude/antipattern-candidates.md`. Skip caller-context expansion and challenger reviewer (cost not justified at SIMPLE).

   Spawn 2-3 parallel subagents. Each receives **file pointers** (not inlined): `.claude/diff.txt`, `.claude/antipattern-candidates.md`, `.claude/past-misses-{agent}.md` (per rule #15-cached):
   - Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
   - Style Reviewer (model: **haiku**) → `~/.claude/agents/style-reviewer.md`
   - Security Agent (model: **sonnet**) → `~/.claude/agents/security.md` — **only if** task touches auth, API routes, user input, or data handling. Skip for pure UI/config changes.

3. If BLOCKING issues → one more iteration (max 2 total). Non-blocking → log and proceed.

## STEP 6b-pre — Sacred test verification (TDD only, rule #25f)

If `tests_mode=tdd`: recompute sha256 for every file in `phases.test_first.test_files_hashes_post_red`. Diff vs stored hashes. Mismatched paths → `phases.implementation.test_files_modified_by_implementer`. Plan-conformance treats each as blocking finding. Human at Gate 2 either rejects or explicitly approves.

## STEP 6c + STEP 7 (parallel)
Spawn in parallel (independent inputs):
- Plan Conformance (model: **haiku**) → `~/.claude/agents/plan-conformance.md` (rule #21)
- Acceptance Agent (model: **haiku**) → `~/.claude/agents/acceptance.md`

Plan Conformance verdicts:
- `CONFORMS` → continue.
- `PARTIAL` → ask Implementer to finish missing steps (counts toward STEP 6 iteration limit).
- `DRIFT` → blocking drift sends back to Implementer; always show report at Gate 2.

Acceptance handled in STEP 7 below — runs concurrently here, not sequentially.

## STEP 6b — Test Verification
Run test suite via the test command from `project_stack`.
- **`tdd`:** run all tests (test-first + existing). Test-first tests fail → send back to Implementer.
- **`regression-only`:** run existing tests only. No new tests expected.
- All pass → proceed. Regressions → send back to Implementer (counts toward STEP 6 iteration limit).
- If no test framework in project → skip, note in pipeline-state.

## STEP 7 — Validation
Acceptance Agent already spawned in STEP 6c (parallel). Collect its result.
Run validation commands from CLAUDE.md ("Validation" or "Quality Checks" section). If not defined, detect from `project_stack`.

If Acceptance FAIL → send to Implementer (max 2 total iterations). If still failing → escalate.
