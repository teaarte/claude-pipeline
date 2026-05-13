# Pipeline: SIMPLE

> **GUARD:** Confirm `mcp__claude-pipeline__pipeline_init` was called for this task (STEP 1a of `commands/task.md`). If `.claude/pipeline-state.json` or `.claude/findings.jsonl` is missing — STOP and run `pipeline_init` first. Never hand-create these files.

## State Recording (apply after every agent spawn in this pipeline)

The orchestrator records every agent completion via the MCP server. Never write to `.claude/pipeline-state.json` or `.claude/findings.jsonl` directly.

- After a **reviewer/validator** agent (logic-reviewer, style-reviewer, security, performance, acceptance, plan-conformance, plan-grounding-check, test, ui-consistency, api-contract, playwright) completes:
  ```
  mcp__claude-pipeline__pipeline_record_agent_run({
    project_dir,
    phase: "<context|planning|test_first|implementation|validation>",
    agent: "<agent name>",
    agent_output: "<entire agent text output incl. fenced ```json header>"
  })
  ```
- After a **non-reviewer** agent (planner, implementer) completes:
  ```
  mcp__claude-pipeline__pipeline_record_nonreview_agent({
    project_dir,
    phase: "<phase>",
    agent: "<agent name>",
    output_file: "<optional artifact path>",
    iterations: <optional integer>
  })
  ```
- When a phase transitions:
  ```
  mcp__claude-pipeline__pipeline_set_phase_status({project_dir, phase, status, skipped_reason?})
  ```
- After a Human Gate decision:
  ```
  mcp__claude-pipeline__pipeline_set_gate({project_dir, gate: "gate1|gate2", decision, feedback})
  ```

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

After the Planner completes → `pipeline_record_nonreview_agent({project_dir, phase: "planning", agent: "planner", output_file: ".claude/plan.md", iterations: <N>})`.

**No plan review.** If plan has 6+ steps → upgrade to MEDIUM.

**Plan Grounding Check** (model: **haiku**) → `~/.claude/agents/plan-grounding-check.md`. Run if plan has any `path:line` citation. `NEEDS_REVISION` → re-spawn Planner once with mismatch table, then proceed.

After the check completes → `pipeline_record_agent_run({project_dir, phase: "planning", agent: "plan-grounding-check", agent_output: "<...>"})`.

When the planning phase ends → `pipeline_set_phase_status({project_dir, phase: "planning", status: "completed"})`.

### ⛔ HUMAN GATE 1
Show plan. Ask: *"Plan ready. Confirm to proceed?"*

Record the decision → `pipeline_set_gate({project_dir, gate: "gate1", decision, feedback})`.

## STEP 5 — Test-First (RED)

> **Guard:** Read `tests_mode` via `pipeline_state_get`. If `regression-only` → call `pipeline_set_phase_status({phase: "test_first", status: "skipped", skipped_reason: "<regression-only|user-override-no-tests|no-test-framework-tdd-blocked>"})` per rule #29, then jump to STEP 6.

**Goal:** Write failing tests BEFORE any implementation code exists.

1. Spawn Test Agent (model: **haiku**) → `~/.claude/agents/test.md`
   Input: `.claude/plan.md` (Test Specifications section) + `project_stack` + mode: `test-first`

2. After Test Agent completes → `pipeline_record_agent_run({project_dir, phase: "test_first", agent: "test", agent_output: "<...>"})`.

3. **Verify RED + count match (rule #25c):** Read the recorded values via `pipeline_state_get`:
   - `verdict: "RED"` AND `details.totals.failing_expected == phases.test_first.test_spec_count_in_plan` → proceed.
   - Count mismatch → re-spawn Test Agent ONCE with missing-cases list. Persistent mismatch → STOP.
   - `verdict: "ERROR"` with `category: "framework-detection-failed"` → STOP (rule #25i).
   - Other `verdict: "ERROR"` → re-run (max 1 retry).
   - `details.totals.passing_unexpected > 0` → investigate.

4. **Sacred test hashing (rule #25d/e):** sha256 every file in `details.test_files`, then call `pipeline_set_phase_status({phase: "test_first", status: "completed", test_files_hashes_post_red: {...}})` to persist them. Write the paths list to `.claude/test-files-must-stay-green.json` (working file, plain `Write` is fine).

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer. Restore with `git stash pop` if needed.

1. Spawn subagent (model: **opus**) → `~/.claude/agents/implementer.md`
   Input: `.claude/plan.md` + inline context + `project_stack` + `tests_mode` + test files list (if `tdd`)
   No checkpoints (plan is ≤5 steps).

   After Implementer completes → `pipeline_record_nonreview_agent({project_dir, phase: "implementation", agent: "implementer", iterations: <N>})`.

2. After implementation, run `git diff > .claude/diff.txt` to capture all changes.

   **Pre-review (orchestrator, no LLM):** Run CLAUDE.md anti-pattern grep (rule #16) → `.claude/antipattern-candidates.md`. Skip caller-context expansion and challenger reviewer (cost not justified at SIMPLE).

   Spawn 2-3 parallel subagents. Each receives **file pointers** (not inlined): `.claude/diff.txt`, `.claude/antipattern-candidates.md`, `.claude/past-misses-{agent}.md` (per rule #15-cached):
   - Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
   - Style Reviewer (model: **haiku**) → `~/.claude/agents/style-reviewer.md`
   - Security Agent (model: **sonnet**) → `~/.claude/agents/security.md` — **only if** task touches auth, API routes, user input, or data handling. Skip for pure UI/config changes.

   After each reviewer completes → `pipeline_record_agent_run({project_dir, phase: "implementation", agent: "<logic-reviewer|style-reviewer|security>", agent_output: "<...>"})`.

3. If BLOCKING issues → one more iteration (max 2 total). Non-blocking → log and proceed. When implementation phase wraps → `pipeline_set_phase_status({project_dir, phase: "implementation", status: "completed"})`.

## STEP 6b-pre — Sacred test verification (TDD only, rule #25f)

If `tests_mode=tdd`: read stored hashes via `pipeline_state_get` (`phases.test_first.test_files_hashes_post_red`), recompute sha256 for each file, diff. Mismatched paths → `pipeline_set_phase_status({phase: "implementation", test_files_modified_by_implementer: [...]})`. Plan-conformance treats each as blocking finding. Human at Gate 2 either rejects or explicitly approves.

## STEP 6c + STEP 7 (parallel)
Spawn in parallel (independent inputs):
- Plan Conformance (model: **haiku**) → `~/.claude/agents/plan-conformance.md` (rule #21)
- Acceptance Agent (model: **haiku**) → `~/.claude/agents/acceptance.md`

After each completes → `pipeline_record_agent_run({project_dir, phase: "<implementation|validation>", agent: "<plan-conformance|acceptance>", agent_output: "<...>"})`. Plan Conformance is phase `implementation`; Acceptance is phase `validation`.

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
Acceptance Agent already spawned and recorded in STEP 6c. Collect its result via `pipeline_state_get` (look at the latest `reviewer_verdicts[]` entry for agent `acceptance`).
Run validation commands from CLAUDE.md ("Validation" or "Quality Checks" section). If not defined, detect from `project_stack`.

If Acceptance FAIL → send to Implementer (max 2 total iterations). If still failing → escalate.

When validation phase ends → `pipeline_set_phase_status({project_dir, phase: "validation", status: "completed"})`.
