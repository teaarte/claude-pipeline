# Workflow Guide

## Choosing the Right Command

```
Question or discussion?
  → Just chat. No command needed.

1-line change? (typo, rename, config value)
  → Just say it in chat. Pipeline auto-detects trivial tasks too.

Small change? (1-3 files, existing patterns)
  → /quick

Feature, refactor, or multi-file change?
  → /task (auto-classifies complexity and tests_mode)
  → /task --no-tests (force skip TDD on backend)
  → /task --with-tests (force TDD on frontend)

New idea or need to pick a library?
  → /brainstorm (has built-in research mode)

Bug with unknown root cause?
  → /debug-team (or just /task with the error)

Bug with clear root cause?
  → /task or /quick depending on scope

Accumulated tech debt?
  → /sweep
```

## Daily Workflow

```
Start working:
  cd project/
  claude

Feature work:
  /task <description with context>
  → review plan at Gate 1 (spend 2 min here — plan determines 90% of quality)
  → backend: tests written first (RED), then implementation (GREEN)
  → frontend: implementation directly, existing tests checked for regressions
  → review result at Gate 2
  → /done

Quick fix:
  /quick <description>
  or just say it in chat

Bug report:
  Paste the error → runtime-debug-agent auto-triggers
  → creates PLANNING.md → implement fix → /done

End of session:
  /done (saves metrics, persists discovered issues, cleans up)

Periodic:
  /sweep              — fix accumulated tech debt
  /metrics-report     — review pipeline effectiveness (after 10+ tasks)
  /validate-claudemd  — keep CLAUDE.md current
  /validate-pipeline  — verify pipeline config integrity after changes
```

## Tests Mode — How It Works

The pipeline auto-detects `tests_mode` at STEP 1 based on project type:

| Project type | tests_mode | Behavior |
|-------------|-----------|----------|
| Frontend app (Next.js, React, Vue, Svelte, Angular) | `regression-only` | No TDD. Implementer writes code directly. Existing tests checked for regressions. |
| Backend (NestJS, Express, FastAPI, Django) | `tdd` | Full TDD. Test Agent writes skeletons + failing tests. Implementer makes them GREEN. |
| Shared library / package | `tdd` | Full TDD. Libraries need contract tests. |

**Why?** TDD on frontend mostly produces "renders without errors" + API mock tests that don't catch real bugs. Backend business logic benefits from test-first because edge cases are caught before implementation.

**Override when needed:**
- `--no-tests` on a backend project (quick prototype, spike)
- `--with-tests` on a frontend project (shared component library with contract tests)

`tests_mode` is stored in `pipeline-state.md` and read by all pipeline steps — single source of truth.

## How the Pipeline Detects Your Stack

STEP 1 of `/task` reads CLAUDE.md "Validation Commands" section and project files:

```
pubspec.yaml      → Flutter/Dart    → loads references/perf-flutter.md, ui-flutter.md, etc.
package.json      → React/Next.js   → loads references/perf-react.md, ui-web.md, etc.
@nestjs imports   → NestJS          → loads references/perf-nestjs.md, test-nestjs.md
pyproject.toml    → Python/FastAPI  → loads references/perf-python.md, test-python.md
```

All agents receive `project_stack` and load the correct reference files. You never need to tell agents what language you're using.

## Adding a New Platform

Create reference files in `agents/references/`:

```bash
# Example: adding Kotlin/Android support
agents/references/perf-kotlin.md      # Performance checks
agents/references/test-kotlin.md      # Test framework detection + patterns
agents/references/ui-android.md       # Material Design compliance
agents/references/e2e-android.md      # Espresso / UI Automator rules
```

No agent files need changing — they auto-detect and load references by stack.

## Token-Saving Tips

### 1. Provide context upfront
Bad: `/task improve the settings page`
Good: `/task add password change to settings — PATCH /users/me endpoint exists, need form + validation`

### 2. Don't restart — continue
Session broke mid-pipeline? Use `/task-continue`. Pipeline state is saved after every agent completion.

### 3. Bundle related changes
One pipeline run with 3 items in the plan is cheaper than 3 separate runs.

### 4. Use /quick aggressively
If the change follows an existing pattern and fits in one sentence — `/quick` is enough. ~70% cheaper than `/task` SIMPLE.

### 5. Answer gates fast and specifically
- Gate 0: "yes" or "reclassify to simple"
- Gate 1: "approved" or "change step 3 to use hook X"
- Gate 2: "accepted" or "fix button padding, should be md not sm"

### 6. Use RTK
[RTK](https://github.com/rtk-ai/rtk) — 60-90% savings on CLI output. Zero config after `rtk init -g`.

## Quality Tips

### 1. Always have a CLAUDE.md
Run `/init-claudemd` on every project. Without it, agents guess conventions wrong.

### 2. "What NOT to Do" is the most important section
Agents follow patterns well but don't know your anti-patterns. Negative rules prevent more bugs than positive ones.

### 3. Review the plan, not just the code
The plan at Gate 1 determines code quality. Wrong architecture in the plan = no amount of code review will fix it.

### 4. Run /done after every task
Not just cleanup — it saves metrics and persists issues found by agents. Without `/done`, discovered tech debt is lost.

### 5. Use /agent-feedback when reviewers miss bugs
`/agent-feedback Security missed XSS in user input`. After 3+ misses, the command suggests updating the agent definition.

### 6. Keep CLAUDE.md under 150 lines
Every line loads on every message. Move reference tables to `docs/`.

## How Issues Flow

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

- **Don't fight the pipeline.** Want to skip reviews? Use `/quick`, not `/task` with complaints.
- **Don't re-run /task for the same thing.** Use `/task-continue` with specific feedback.
- **Don't write CLAUDE.md once and forget.** Run `/validate-claudemd` periodically.
- **Don't keep stale working files.** `.claude/` has plan.md from a previous session? Run `/done` to clean up.
- **Don't use /task for exploration.** "What would it take to add X?" → `/brainstorm`.