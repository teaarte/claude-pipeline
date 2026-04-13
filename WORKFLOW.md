# Workflow Guide

## Choosing the Right Command

```
Question or discussion?
  → Just chat. No command needed.

1-line change? (typo, rename, config value)
  → Just say it in chat.

Small change? (1-3 files, existing patterns)
  → /quick

Feature, refactor, or multi-file change?
  → /task (auto-classifies complexity)

New idea without clear requirements?
  → /brainstorm → then /task

Need to pick a library or approach?
  → /brainstorm (has built-in research mode)

Bug with unknown root cause?
  → /debug-team (or just /task with the error)

Bug with clear root cause?
  → /task or /quick depending on scope
```

## Daily Workflow

```
Start working:
  cd project/
  claude

Feature work:
  /task <description with context>
  → review plan at Gate 1 (spend 2 min here — plan determines 90% of quality)
  → review result at Gate 2
  → /done

Quick fix:
  /quick <description>
  or just say it in chat

Bug report:
  Paste the error → runtime-debug-agent auto-triggers
  → creates PLANNING.md → implement fix → /done

End of session:
  /done (saves metrics, persists issues, cleans up)

Periodic:
  /sweep              — fix accumulated tech debt
  /metrics-report     — review pipeline effectiveness (after 10+ tasks)
  /validate-claudemd  — keep CLAUDE.md current
```

## Token-Saving Tips

### 1. Provide context upfront
Bad: `/task improve the settings page`
Good: `/task add password change to settings — PATCH /users/me endpoint exists, need form + validation`

More context = fewer clarifying questions = fewer tokens on Gate 0.

### 2. Don't restart — continue
Session broke mid-pipeline? Use `/task-continue`, not a new `/task`. It reads pipeline-state.md and resumes from the exact point.

### 3. Bundle related changes
Bad: 3 separate `/task` runs for 3 related fixes.
Good: `/task fix settings page — 1) name validation, 2) email readonly, 3) success notification`

One pipeline run is cheaper than three.

### 4. Use /quick aggressively
If the change follows an existing pattern and fits in one sentence — `/quick` is enough. ~70% cheaper than `/task` SIMPLE.

### 5. Answer gates fast and specifically
- Gate 0: "yes" or "reclassify to simple"
- Gate 1: "approved" or "change step 3 to use hook X"
- Gate 2: "accepted" or "fix button padding, should be md not sm"

Vague feedback = extra iteration = extra tokens.

### 6. Use RTK
Install [RTK](https://github.com/rtk-ai/rtk) — 60-90% savings on CLI output. Zero config after `rtk init -g`.

## Quality Tips

### 1. Always have a CLAUDE.md
Run `/init-claudemd` on every project. Without it, agents guess your conventions wrong.

### 2. "What NOT to Do" is the most important section
Agents follow patterns well. They don't know your project's anti-patterns. "Don't use axiosInstance directly" prevents more bugs than any positive rule.

### 3. Review the plan, not just the code
The plan at Gate 1 determines the code quality. Wrong architecture in the plan = no amount of code review will fix it.

### 4. Run /done after every task
Not just cleanup — it saves metrics and persists issues found by agents. Without `/done`, discovered tech debt is lost.

### 5. Use /agent-feedback when reviewers miss bugs
Found a bug that Security Agent should have caught? `/agent-feedback Security missed XSS in user input`. After 3+ misses, the command updates the agent definition.

### 6. Keep CLAUDE.md under 150 lines
Every line loads on every message. Move tables and endpoint lists to `docs/`. Keep only rules, patterns, and anti-patterns.

## How Issues Flow Through the Pipeline

```
Agent finds out-of-scope issue during implementation/review
  ↓
Appended to .claude/issues-found.md (severity, file:line, description)
  ↓
/done persists to KB tech-debt.md or docs/tech-debt.md
  ↓
/sweep reads, categorizes (high/medium/low), auto-detects resolved
  ↓
Fix simple issues directly, defer complex ones to /task
```

No TODO comments in code. Issues live in a structured file, not scattered across the codebase.

## Anti-Patterns

- **Don't fight the pipeline.** If you want to skip reviews — use `/quick`, not `/task` with complaints.
- **Don't re-run /task for the same thing.** Use `/task-continue` with specific feedback.
- **Don't write CLAUDE.md once and forget.** Run `/validate-claudemd` periodically.
- **Don't keep stale working files.** If `.claude/` has plan.md from a previous session — run `/done` to clean up.
- **Don't use /task for exploration.** "What would it take to add X?" → `/brainstorm`. `/task` will try to implement.
