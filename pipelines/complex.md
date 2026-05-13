# Pipeline: COMPLEX

> **GUARD:** Confirm `mcp__claude-pipeline__pipeline_init` was called for this task (STEP 1a of `commands/task.md`). If `.claude/pipeline-state.json` or `.claude/findings.jsonl` is missing — STOP and run `pipeline_init` first. Never hand-create these files.

## State Recording (apply after every agent spawn in this pipeline)

Never write to `.claude/pipeline-state.json` or `.claude/findings.jsonl` directly. After each spawn:

- **Reviewer/validator** (logic, challenger, style, security, performance, acceptance, plan-conformance, plan-grounding-check, context-doc-verifier, test, ui-consistency, api-contract, playwright):
  ```
  mcp__claude-pipeline__pipeline_record_agent_run({
    project_dir,
    phase: "<context|planning|test_first|implementation|validation>",
    agent: "<name>",
    agent_output: "<full text incl. fenced ```json header>"
  })
  ```
- **Non-reviewer** (planner, implementer, architect, code-analyzer, dependency-auditor, research, migration):
  ```
  mcp__claude-pipeline__pipeline_record_nonreview_agent({
    project_dir,
    phase: "<phase>",
    agent: "<name>",
    output_file: "<optional artifact path>",
    iterations: <optional integer>
  })
  ```
- Phase transitions: `mcp__claude-pipeline__pipeline_set_phase_status({project_dir, phase, status, skipped_reason?})`.
- Gate decisions: `mcp__claude-pipeline__pipeline_set_gate({project_dir, gate: "gate1|gate2", decision, feedback})`.

For the team-based planning step below, every teammate's output is recorded the same way — each plan variant is a non-reviewer record (Planner) and each cross-review the team performs is a reviewer record.

## STEP 3 — Context Enrichment

**Phase A:** Dependency Auditor was launched in background during Gate 0 (see `task.md` STEP 2).
Collect its result (`.claude/dependency-audit.md`) now. If not yet complete, wait.
If NOT launched (e.g. reclassified from SIMPLE/MEDIUM), spawn now:
Dependency Auditor (model: **sonnet**) → `~/.claude/agents/dependency-auditor.md`

After it completes → `pipeline_record_nonreview_agent({project_dir, phase: "context", agent: "dependency-auditor", output_file: ".claude/dependency-audit.md"})`.

**Phase B** (parallel, after Phase A):
- Code Analyzer (model: **opus**) → `~/.claude/agents/code-analyzer.md` (Input: task + dependency-audit)
- Research Agent (model: **opus**) → `~/.claude/agents/research.md` (if new lib/API/pattern needed)

After each completes → `pipeline_record_nonreview_agent({project_dir, phase: "context", agent: "<code-analyzer|research>", output_file: "<artifact>"})`.

**Phase B-verify:** Spawn Context-Doc Verifier (model: **haiku**) → `~/.claude/agents/context-doc-verifier.md` (see `commands/task.md` rule #18). Reads `.claude/analyzer-claims.json` (raw claim list dumped by Code Analyzer) instead of re-deriving.

After it completes → `pipeline_record_agent_run({project_dir, phase: "context", agent: "context-doc-verifier", agent_output: "<...>"})`.

- `VERIFIED` → continue to Phase C.
- `WARN` → mismatches are already in `findings.jsonl` via the record call; propagate corrections to Architect/Planner inputs.
- `NEEDS_RERUN` → re-spawn Code Analyzer with mismatches (max 1 retry), then re-verify before Phase C.

**Phase C** (after Phase B-verify):
Spawn Architect (model: **opus**) → `~/.claude/agents/architect.md`
Input: task + `.claude/context-doc.md` + `.claude/dependency-audit.md` + verifier corrections (if WARN)

After Architect completes → `pipeline_record_nonreview_agent({project_dir, phase: "context", agent: "architect", output_file: ".claude/architecture-decisions.md"})`.

When context enrichment ends → `pipeline_set_phase_status({project_dir, phase: "context", status: "completed"})`.

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

After every Planner teammate writes its variant → `pipeline_record_nonreview_agent({project_dir, phase: "planning", agent: "planner", output_file: ".claude/plan-<variant>.md"})` (one call per variant). After the Lead synthesizes → another `pipeline_record_nonreview_agent({project_dir, phase: "planning", agent: "planner", output_file: ".claude/plan.md", iterations: <N>})`.

**4b: Plan Grounding Check.** Spawn Plan Grounding Check (model: **haiku**) → `~/.claude/agents/plan-grounding-check.md` (see `commands/task.md` rule #17). Run BEFORE plan reviewers — no point reviewing logic of a plan whose citations are wrong.

After it completes → `pipeline_record_agent_run({project_dir, phase: "planning", agent: "plan-grounding-check", agent_output: "<...>"})`.

- `GROUNDED` / `NO_CITATIONS` → continue to 4c.
- `NEEDS_REVISION` → re-synthesize via Lead with mismatch table as feedback (do NOT re-run the full team — only the synthesis step). Counts toward the 2-revision limit.

**4c: Plan Review** — spawn 4 parallel reviewers:
- Logic Reviewer (model: **opus**) → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer (model: **sonnet**) → `~/.claude/agents/style-reviewer.md`
- Security Agent (model: **opus**) → `~/.claude/agents/security.md`
- Performance Agent (model: **opus**) → `~/.claude/agents/performance.md`

Each receives its agent-specific past-misses block (rule #15).

After each reviewer completes → `pipeline_record_agent_run({project_dir, phase: "planning", agent: "<name>", agent_output: "<...>"})`.

Any BLOCKER = NEEDS_REVISION. Spawn Planner (model: **opus**) with feedback to revise.
Max 2 revision cycles. If still blocked → escalate to human.

When planning phase wraps → `pipeline_set_phase_status({project_dir, phase: "planning", status: "completed"})`.

### ⛔ HUMAN GATE 1
Show plan + synthesis note + grounding-check verdict.
If project uses API codegen: ask if API spec has changed.
Otherwise: *"Plan ready. Confirm to proceed?"*

Record the decision → `pipeline_set_gate({project_dir, gate: "gate1", decision, feedback})`.

## STEP 5 — Test-First (RED)

> **Guard:** Read `tests_mode` via `pipeline_state_get`. If `regression-only` → call `pipeline_set_phase_status({phase: "test_first", status: "skipped", skipped_reason: "<reason>"})` per rule #29, jump to STEP 6.

**Goal:** Write failing tests BEFORE any implementation code exists.

1. Spawn Test Agent (model: **sonnet**) → `~/.claude/agents/test.md`
   Input: `.claude/plan.md` (Test Specifications section) + `.claude/context-doc.md` + `project_stack` + mode: `test-first`

2. After Test Agent completes → `pipeline_record_agent_run({project_dir, phase: "test_first", agent: "test", agent_output: "<...>"})`.

3. **Verify RED + count match (rule #25c):** Read recorded values via `pipeline_state_get`:
   - `verdict: "RED"` AND `details.totals.failing_expected == phases.test_first.test_spec_count_in_plan` → proceed.
   - Count mismatch → re-spawn Test Agent ONCE with the missing-cases list. Persistent mismatch → STOP, escalate.
   - `verdict: "ERROR"` with `category: "framework-detection-failed"` → STOP (rule #25i, never spawn Implementer).
   - Other `verdict: "ERROR"` → re-run (max 1 retry).
   - `details.totals.passing_unexpected > 0` → investigate before continuing.

4. **Sacred test hashing (rule #25d/e):** sha256 every file in `details.test_files`, then call:
   ```
   pipeline_set_phase_status({
     project_dir,
     phase: "test_first",
     status: "completed",
     test_files_hashes_post_red: { "<path>": "<sha256>", ... }
   })
   ```
   Write the paths list to `.claude/test-files-must-stay-green.json` (working file, plain `Write`).

**If independent modules exist** (from `.claude/architecture-decisions.md`):
Spawn parallel Test Agents per module — each creates skeletons + tests for its module only. Record each one separately via `pipeline_record_agent_run` (different `agent_output` per call). Hash all written files together; pass the merged map into a single `pipeline_set_phase_status` call.

## STEP 6 — Implementation (GREEN)
**Rollback point:** Run `git stash push -m "pre-implementation"` before spawning Implementer(s). Restore with `git stash pop` if needed.

**If independent modules exist** (from `.claude/architecture-decisions.md`):
Spawn parallel implementers (model: **opus**), each owning a module with no file overlap.
Each reads `~/.claude/agents/implementer.md` + `.claude/plan.md` + `project_stack` + `tests_mode` + test files for their module (if `tdd`).

**Otherwise:** single Implementer (model: **opus**) with checkpoints every 3-5 steps.
Input: `.claude/plan.md` + `.claude/context-doc.md` + `project_stack` + `tests_mode` + test files list (if `tdd`)

After each Implementer completes → `pipeline_record_nonreview_agent({project_dir, phase: "implementation", agent: "implementer", iterations: <N>})` (one call per implementer in the parallel-module case).

After implementation, run `git diff > .claude/diff.txt` once. Reviewers Read this file — diff is **never inlined** in reviewer input (rule #10 file-pointer mode).

**Pre-review steps (orchestrator, no LLM):**
- **CLAUDE.md anti-pattern grep** (rule #16) → write `.claude/antipattern-candidates.md`.
- **Caller-context expansion** (rule #19) → write `.claude/caller-context.md` (5-10 lines per call site, capped at 30 sites).

Spawn 5 parallel reviewers. Each receives **file pointers only** (paths to `.claude/diff.txt`, `.claude/caller-context.md`, `.claude/antipattern-candidates.md`, `.claude/past-misses-{agent}.md`):
- Logic Reviewer (model: **opus**) on changed code
- Challenger Reviewer (model: **opus**) — independent verdict on the same input (rule #20)
- Style Reviewer (model: **sonnet**) on changed code (COMPLEX keeps sonnet for cross-module style nuance)
- Security Agent (model: **opus**) on changed code
- Performance Agent (model: **opus**) on changed code

After each reviewer completes → `pipeline_record_agent_run({project_dir, phase: "implementation", agent: "<name>", agent_output: "<...>"})`.

**Reconcile Logic vs Challenger** (rule #20):
- Both APPROVE → proceed.
- Both REQUEST_CHANGES → merge findings, hand to Implementer.
- Disagreement → both verdicts already in `reviewer_verdicts[]` via the record calls; surface side-by-side at Gate 2; do NOT auto-route to Implementer.

If BLOCKING (from any reconciled reviewer) → one more iteration per module (max 2 total). Non-blocking → log.

If API/DB/type changes → spawn Migration Agent (model: **opus**) → `~/.claude/agents/migration.md`. After it completes → `pipeline_record_nonreview_agent({project_dir, phase: "implementation", agent: "migration", output_file: ".claude/migration-plan.md"})`.

When the implementation phase wraps → `pipeline_set_phase_status({project_dir, phase: "implementation", status: "completed"})`.

## STEP 6b-pre — Sacred test verification (TDD only, rule #25f)

If `tests_mode=tdd`: read stored hashes via `pipeline_state_get` (`phases.test_first.test_files_hashes_post_red`), recompute sha256 for each file, diff. Mismatched paths → `pipeline_set_phase_status({phase: "implementation", test_files_modified_by_implementer: [...]})`. Plan-conformance treats each as blocking finding. Human at Gate 2 either rejects or explicitly approves.

## STEP 6c + STEP 7 (parallel)
Spawn in parallel (independent inputs — all read `.claude/diff.txt` and `.claude/plan.md`):
- Plan Conformance (model: **haiku**) → `~/.claude/agents/plan-conformance.md` (rule #21)
- Acceptance Agent (model: **haiku**) → `~/.claude/agents/acceptance.md`
- Playwright Agent (model: **sonnet**) → `~/.claude/agents/playwright.md` (if frontend with E2E setup)
- UI Consistency (model: **sonnet**) → `~/.claude/agents/ui-consistency.md` (if UI changed)
- API Contract (model: **sonnet**) → `~/.claude/agents/api-contract.md` (if API changed)

After each completes → `pipeline_record_agent_run({project_dir, phase: "<implementation|validation>", agent: "<name>", agent_output: "<...>"})`. Plan Conformance is phase `implementation`; the rest are phase `validation`.

Plan Conformance verdicts:
- `CONFORMS` → continue.
- `PARTIAL` → ask Implementer (or relevant module's Implementer if parallel) to finish missing steps. Counts toward STEP 6 iteration limit.
- `DRIFT` → if blocking drift, send back with report. Always surface report at Gate 2.

## STEP 6b — Test Verification
Run test suite via the test command from `project_stack`.
- **`tdd`:** run all tests (test-first + existing). Test-first tests fail → send back to Implementer.
- **`regression-only`:** run existing tests only. No new tests expected. Do NOT spawn Test Agent.
- All pass → proceed. Regressions → send back to Implementer (counts toward STEP 6 iteration limit).
- If no test framework in project → spawn Test Agent (model: **sonnet**) → `~/.claude/agents/test.md` to set up tests (only when `tests_mode: tdd`). COMPLEX keeps sonnet for setup work.

## STEP 7 — Validation
Acceptance / Playwright / UI Consistency / API Contract already spawned and recorded in STEP 6c. Read their verdicts via `pipeline_state_get`.
Run validation commands from CLAUDE.md ("Validation" or "Quality Checks" section). If not defined, detect from `project_stack`.

FAIL → send to Implementer (max 2 total). Still failing → escalate.

When validation phase ends → `pipeline_set_phase_status({project_dir, phase: "validation", status: "completed"})`.
