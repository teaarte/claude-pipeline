# Quick Pipeline

You are running a **simplified pipeline** for a straightforward task.

**Task:** $ARGUMENTS

This pipeline skips enrichment agents and runs a streamlined flow.

**When to use `/quick` vs `/task`:**
- `/quick` — change is obvious, touches 1-3 files max, no new patterns, no architectural decisions.
- `/task` — everything else. When in doubt, use `/task`.

If you realize the task is more complex than quick — **stop and tell the human to use `/task` instead**.

---

## Execution

### Step 1: Quick Analysis
Read the relevant file(s). Understand what needs to change.

### Step 2: Plan
Brief plan (no formal document):
- What files change
- What exactly changes
- Any reusable code to use

### Step 3: Confirm with Human
Present your understanding + plan (2-5 sentences) + files that will change.
**Ask:** "Proceed?"

### Step 4: Implement
Make the changes. Follow existing patterns in the codebase.

### Step 5: Self-review
- No type errors
- No lint issues
- No debug statements left
- Clean imports

### Step 6: Run checks
Run validation commands from CLAUDE.md. If not defined, detect and run standard checks for the project's language (typecheck, lint, build, test).

### Step 7: Report completion
- What was changed (file + 1-line description)
- Validation results

If all pass: **Task complete.** If any fail: fix and re-run.

---

**Rule:** If anything unexpected comes up — stop, explain, ask. Do not invent solutions.
