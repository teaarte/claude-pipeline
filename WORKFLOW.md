# Workflow Guide — Getting Best Results

## Golden Rule

**Pipeline = framework. CLAUDE.md = config. Chat = conversation.**

Use the right tool for the scale of the task. Don't run a 20-agent pipeline for a typo fix. Don't freestyle a complex feature in chat.

---

## Choosing the Right Command

```
Is it a question or discussion?
  → Just chat. No command needed.

Is it a 1-line change? (typo, rename, delete unused)
  → Just say it in chat. No command needed.

Is it a small change? (1-3 files, existing patterns)
  → /quick

Is it a feature, refactor, or multi-file change?
  → /task (auto-classifies complexity)

Is it a new idea without clear requirements?
  → /brainstorm → then /task

Is it a tech decision? (pick a library, choose an approach)
  → /research

Is it a bug with unknown root cause?
  → /debug-team

Is it a bug with clear root cause?
  → /task or /quick depending on scope
```

## Token-Saving Rules

### 1. Don't over-classify
If you know the task is simple — say so. `/task fix the button color` will auto-classify as SIMPLE, but if the orchestrator hesitates, tell it: "this is simple, fast-track it."

### 2. Skip pipeline for trivial changes
Not everything needs `/task`. These are fine in plain chat:
- Fix a typo
- Update a translation string
- Change a color value
- Delete unused code
- Rename a variable

### 3. Provide context upfront
Bad: `/task improve the settings page`
Good: `/task add password change to settings page — backend endpoint PATCH /users/me with password field already exists`

More context in the prompt = fewer clarifying questions = fewer tokens on Gate 0.

### 4. Don't restart — continue
If Claude session breaks mid-pipeline, don't re-run `/task`. Use `/task-continue` — it reads pipeline-state.md and resumes from where it stopped.

### 5. Bundle related changes
Bad: three separate `/task` runs for three related UI fixes.
Good: `/task fix settings page — 1) name field validation, 2) email should be readonly, 3) add success notification`

One pipeline run with 3 items in the plan is cheaper than 3 separate runs.

### 6. Use /quick aggressively
If the change follows an existing pattern and you can describe it in one sentence — `/quick` is enough. It skips enrichment agents, plan review, and most validators. ~70% cheaper than `/task` SIMPLE.

### 7. Answer gates fast and specifically
At Gate 0: "yes" or "reclassify to X" — don't elaborate.
At Gate 1: "approved" or "change step 3 to use hook X instead" — be specific.
At Gate 2: "accepted" or "fix the button padding, it should be md not sm" — point to the exact issue.

Vague feedback = extra iteration = extra tokens.

## Quality-Maximizing Rules

### 1. Always have a CLAUDE.md
Run `/init-claudemd` on every project. Run `/validate-claudemd` periodically. Without CLAUDE.md, agents guess your conventions — and guess wrong.

### 2. The "What NOT to Do" section is the most important
Agents are good at following patterns. They're bad at knowing your project's specific anti-patterns. "Don't use axiosInstance directly" prevents more bugs than "Use generated hooks" tells them to.

### 3. Review the plan at Gate 1, not just the code at Gate 2
The plan determines 90% of the code quality. If the plan has wrong architecture, no amount of code review will fix it. Spend 2 minutes reading the plan and pushing back if needed.

### 4. Use /agent-feedback when you find bugs
Found a bug that Security Agent should have caught? Run `/agent-feedback Security missed XSS in user input`. After 3+ misses, the command suggests updating the agent definition. Agents get better over time.

### 5. Run /done after every task
Not just for cleanup — it saves metrics. After 10-20 tasks, you'll see which reviewers find blockers and which are just burning tokens.

### 6. Keep CLAUDE.md under 150 lines
Every line is loaded on every message. Move reference tables and endpoint lists to `docs/`. Keep only rules, patterns, and anti-patterns in CLAUDE.md.

### 7. Keep MEMORY.md minimal
Only gotchas not covered by CLAUDE.md. No duplication. Should be under 20 lines.

## Daily Workflow

```
Morning:
  cd project/
  claude

Working on feature:
  /task <description>
  → review plan at Gate 1
  → review result at Gate 2
  → /done

Quick fix:
  /quick <description>
  or just say it in chat

Found a bug in existing code:
  Describe the error → runtime-debug-agent triggers automatically
  → implement fix → /done

End of day / end of feature:
  /done (if not run yet)
  Verify KB is updated
```

## Anti-Patterns to Avoid

**Don't fight the pipeline.** If you find yourself saying "just do it, skip the review" — use `/quick` instead of `/task`. The pipeline exists for quality, not ceremony.

**Don't re-run /task on the same thing.** If the first run didn't produce what you wanted, use `/task-continue` with specific feedback. Each `/task` re-run burns tokens on classification, enrichment, and planning from scratch.

**Don't write CLAUDE.md once and forget it.** Projects evolve. Run `/validate-claudemd` monthly. Remove patterns that no longer apply. Add new anti-patterns you've discovered.

**Don't keep stale working files.** If `.claude/` has plan.md, pipeline-state.md, etc. from a previous session — delete them or run `/done`. Stale files confuse the pipeline.

**Don't use /task for exploration.** "What would it take to add feature X?" is a `/brainstorm` question, not a `/task`. `/task` will try to plan and implement. `/brainstorm` will explore and discuss.
