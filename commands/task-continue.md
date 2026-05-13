# Task Continue

Resume a paused pipeline.

**User input:** $ARGUMENTS

---

## Process

### 1. Read Pipeline State
Read `.claude/pipeline-state.json` to determine current step, what's completed, what feedback is pending.

If no pipeline-state.json: *"No active task found. Start one with `/task <description>`"*

### 2. Inspect the driver state
The v2 driver persists its FSM state to `.claude/driver-state.json`. Read it to know which flow is active (`flow_name`), the current step (`step_index`), what spawns are in flight (`pending_spawns`), and whether the driver is awaiting a user answer (`pending_user_answer`).

### 3. Determine Resume Point

**Gate 0 (Classification):**
- User confirms → proceed to STEP 3
- User corrects classification → update pipeline-state.json, re-announce
- User answers questions → incorporate, proceed to STEP 3

**Gate 1 (Plan Review):**
- User approves → proceed to STEP 5 (Test-First / RED), then STEP 6 (Implementation / GREEN)
- User gives feedback → spawn Planner with feedback to revise, re-run review, present Gate 1 again
- User rejects entirely → re-run from STEP 3

**Gate 2 (Final Acceptance):**
- User accepts → task complete, suggest `/done`
- User rejects with specific fixes → send to Implementer, re-validate, present Gate 2 again
- User rejects broadly → clarify if approach or implementation issue

**Implementation Checkpoint:**
- Concerns → address, tell Implementer to continue or adjust

**Complex Planning (competing planners):**
- Synthesize when all planners done → review → Gate 1

**Parallel Implementation:**
- Wait for remaining modules → spawn reviewers when all done
- One module failed → retry that module (max 2 iterations)

**Agent failure escalation:**
- Ask user: retry, skip, provide manually, or abort

### 4. Resume
Re-enter the driver by calling `pipeline_continue_task({project_dir, driver_state_id, input})` with the appropriate shuttle event (`agent-result`, `agents-results`, `user-answer`, or `recovery`). The driver picks up from `step_index` and walks forward.

---

## Rules
- Always read pipeline-state.json before acting
- If ambiguous → ask, don't guess
- Never skip Human Gates on resume
