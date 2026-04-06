# Debug Team — Competing Hypotheses

Use this command when the root cause of a bug is **unclear** and multiple explanations
are plausible. Spawns independent investigators who actively try to disprove each other.

**Bug description:** $ARGUMENTS

---

## Why a team, not a single agent

A single agent finds one plausible explanation and anchors on it.
Multiple independent investigators, each defending a different theory and required to
challenge others, converge on the real root cause faster and more reliably.

---

## Execution

### Step 1: Read context
Read CLAUDE.md and the bug description. Identify:
- What is the observable symptom?
- What areas of the codebase are involved?
- What are 3-5 plausible root cause hypotheses?

### Step 2: Create the investigation team

Spawn an agent team with this prompt to the lead:

> "We have a bug: **[bug description]**
>
> Create an investigation team with one teammate per hypothesis:
> [List 3-5 hypotheses you identified, e.g.:]
> - Hypothesis A teammate: race condition in the async data fetch
> - Hypothesis B teammate: stale cache returning outdated value
> - Hypothesis C teammate: incorrect state initialization on first render
>
> Rules for all teammates:
> 1. Investigate your hypothesis by reading relevant code and tracing the execution path
> 2. Try to find evidence FOR your hypothesis (logs, code paths, data flow)
> 3. Try to find evidence AGAINST the other teammates' hypotheses
> 4. After initial investigation (~10 minutes), share your findings with all teammates
> 5. Based on others' findings, either strengthen your case or concede if evidence is weak
> 6. Write your conclusion to `.claude/debug-hypothesis-[letter].md`
>
> Lead: after all teammates report, synthesize into `.claude/debug-findings.md`:
> - Which hypothesis has the strongest evidence
> - Which were ruled out and why
> - Recommended fix approach
> - Files to change"

### Step 3: Present findings to human

Show the user `.claude/debug-findings.md`.

Ask: *"Investigation complete. Does the root cause analysis look right?
Confirm to proceed with fix, or provide additional context."*

**Wait for confirmation.**

### Step 4: Create fix plan

If human approves findings — spawn subagent → `~/.claude/agents/planner.md`
Input: `.claude/debug-findings.md` + CLAUDE.md

Output: `.claude/plan.md` (focused fix plan)

Then run Plan Review (parallel subagents):
- Logic Reviewer → `~/.claude/agents/logic-reviewer.md`
- Style Reviewer → `~/.claude/agents/style-reviewer.md`

If NEEDS_REVISION → revise plan (max 1 more iteration). Then:

### ⛔ HUMAN GATE 1
Show `.claude/plan.md`. Ask: *"Fix plan ready. Confirm to proceed with implementation?"*
**Wait for approval.**

Then rejoin the main `/task` pipeline: execute **STEP 5** (Implementation), **STEP 6** (Validation), **STEP 7** (Post-Processing), and **STEP 8** (Final Report with Gate 2) from `~/.claude/commands/task.md`. `/debug-team` is an alternative entry point for bugs with unclear root cause — once the fix plan is approved, the rest of the flow is identical to `/task`.

---

## When to use this vs `/task`

Use `/debug-team` when:
- Root cause is unknown and multiple things could be causing it
- The bug is hard to reproduce or intermittent
- Previous fix attempts didn't work

Use `/task` when:
- You already know what's wrong and just need to fix it
- The bug is straightforward (typo, missing null check, wrong condition)
