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
  → /task --no-tests (force skip TDD; orchestrator confirms when business logic is touched)
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
  /metrics-report     — human-readable pipeline summary (after 10+ tasks)
  /learn              — cluster categories × agent, drift detection, vocab promotion (run before editing any agent prompt)
  /validate-claudemd  — keep CLAUDE.md current
  /validate-pipeline  — verify pipeline config integrity after changes

When a reviewer misses a bug:
  /agent-feedback     — log structured miss with category + pattern_to_look_for. Auto-injected into future runs via past-misses.
```

## Tests Mode — How It Works

The pipeline auto-detects `tests_mode` at STEP 1 based on project type:

| Project type | tests_mode | Behavior |
|-------------|-----------|----------|
| Frontend app **without** server-side logic in scope | `regression-only` | No TDD. Implementer writes code directly. Existing tests checked for regressions. |
| Frontend app **with** API routes / Server Actions / `+server.ts` in scope | `tdd` | Server-side logic needs TDD even in frontend repos. Orchestrator scans for `app/api/**`, `'use server'`, `server/api/**`, `+server.ts` and upgrades. |
| Backend (NestJS, Express, FastAPI, Django) | `tdd` | Full TDD. Test Agent writes skeletons + failing tests. Implementer makes them GREEN. |
| Shared library / package | `tdd` | Full TDD. Libraries need contract tests. |

**Why?** TDD on frontend UI mostly produces "renders without errors" + API mock tests that don't catch real bugs. Backend business logic AND server-side surfaces in frontend repos benefit from test-first because edge cases are caught before implementation.

**Override when needed:**
- `--no-tests` on a backend project — orchestrator REQUIRES explicit confirmation when the task touches auth, payments, data persistence, or API endpoints.
- `--with-tests` on a frontend-only project (shared component library with contract tests).

**TDD enforcement** (when `tests_mode=tdd`):
- Plan MUST include Test Specifications with executable AAA blocks; "tests not applicable" escape clause is removed.
- Test Agent's `failing_expected` count MUST match plan's T-case count (orchestrator verifies; mismatch → ERROR).
- Test files are SACRED post-RED — orchestrator hashes them; any modification by implementer is blocking unless human approves.
- Acceptance fails (BLOCKING, not warning) on missing test coverage.

`tests_mode` is stored in `pipeline-state.json` and read by all pipeline steps — single source of truth.

## How the Pipeline Detects Your Stack

STEP 1 of `/task` reads CLAUDE.md "Validation Commands" section and project files:

```
pubspec.yaml      → Flutter/Dart    → loads references/perf-flutter.md, ui-flutter.md, etc.
package.json      → React/Next.js   → loads references/perf-react.md, ui-web.md, etc.
@nestjs imports   → NestJS          → loads references/perf-nestjs.md, test-nestjs.md
pyproject.toml    → Python/FastAPI  → loads references/perf-python.md, test-python.md
```

All agents receive `project_stack` and load the correct platform reference files. You never need to tell agents what language you're using.

**Senior-pattern references** (Tier 1/2/3) are conditionally loaded by the orchestrator at STEP 1 based on stack + diff content + task keywords. They cover architecture patterns, db/redis/caching, React 19, API design, concurrency, observability, error handling, security, optimization, Next.js App Router, and test strategy. Capped at 5 senior-pattern files per agent per task to avoid prompt bloat. The list lands in `.claude/refs-to-load.md`.

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
`/agent-feedback Security missed XSS in user input`. Logs a structured entry to `metrics/agent-feedback.jsonl` with `category` (from controlled vocab) and `pattern_to_look_for`. Reviewers auto-load the last 10 confirmed entries on every spawn — no manual prompt edit needed for the rolling window. Run `/learn` to see vocab-promotion candidates and pattern auto-promotion suggestions when the same miss accumulates.

### 6. Keep CLAUDE.md under 150 lines
Every line loads on every message. Move reference tables to `docs/`.

## How Issues Flow

```
Reviewer/validator finds issue → emits JSON header with findings[]
  ↓
Orchestrator calls mcp__claude-pipeline__pipeline_record_agent_run with agent output text
  ↓
MCP parses fenced ```json, validates against reviewer-output / validator-output schema
  ↓
Each finding validated against finding.schema.json + category-vocab and appended to .claude/findings.jsonl
  ↓
reviewer_verdicts[] entry written, agents_count++, summary.md rebuilt
  ↓
Out-of-scope findings collected; /done → mcp__claude-pipeline__pipeline_finish → metrics/pipeline.jsonl
  ↓
/sweep reads, categorizes by severity, auto-detects resolved
  ↓
Fix simple issues directly, defer complex ones to /task
```

**State integrity (MCP + hooks enforced):** every mutation to `pipeline-state.json` and `findings.jsonl` goes through `mcp__claude-pipeline__*` tools. The MCP server refuses incoherent transitions (terminal-state reopen, completed phase with no agents, agent recorded before prereqs are done — see invariants `INV_001`–`INV_011` in `mcp/README.md`) and `pipeline_finish` refuses to write metrics on any invariant violation. On top of that, the `pipeline-guard.sh` PreToolUse hook mechanically denies any `Write`/`Edit`/`Bash` that would touch these files outside the MCP — even if the orchestrator tries. Escape hatch: `PIPELINE_ALLOW_RAW=1` (debugging only). See `hooks/README.md`.

```
Reviewer misses a real bug (caught later in prod / by human / by test)
  ↓
/agent-feedback → metrics/agent-feedback.jsonl (with category + pattern_to_look_for + human_confirmed)
  ↓
Next pipeline run: orchestrator caches per-agent past-misses files; reviewers Read on every spawn
  ↓
Reviewer flags matching diff patterns automatically going forward
  ↓
/learn → suggests vocab promotion AND/OR permanent agent prompt update when ≥3 confirmed
```

No TODO comments in code. Issues live in structured streams, not scattered across the codebase.

## Anti-Patterns

- **Don't fight the pipeline.** Want to skip reviews? Use `/quick`, not `/task` with complaints.
- **Don't re-run /task for the same thing.** Use `/task-continue` with specific feedback.
- **Don't write CLAUDE.md once and forget.** Run `/validate-claudemd` periodically.
- **Don't keep stale working files.** `.claude/` has plan.md from a previous session? Run `/done` to clean up.
- **Don't use /task for exploration.** "What would it take to add X?" → `/brainstorm`.
- **Don't Write/Edit `.claude/pipeline-state.json` or `.claude/findings.jsonl` directly.** Use the `mcp__claude-pipeline__*` tools. The `pipeline-guard.sh` PreToolUse hook will mechanically deny direct edits anyway — but design for the rule, not the catch. If the MCP server is unavailable, fix the server; don't reach for `PIPELINE_ALLOW_RAW=1`.