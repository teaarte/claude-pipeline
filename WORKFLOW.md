# Workflow Guide

> ⚠️ **This repository is archived.** The idea evolved into **Loom**, where active development now continues. What remains here is a historical snapshot of Claude Pipeline (v2.2.7) — it is no longer maintained.
>
> Daily-usage patterns + command-choice flowchart. For overview + install, see [`README.md`](README.md).
>
> **Current state (v2.2.7):** classifier-agent auto-spawns in the context phase and populates LLM-derived decisions (`refs_to_load` / `security_needed` / `task_short` / `antipattern_rules_applicable` / `stack` / `change_kind`). Reviewer fan-out (logic + challenger + style + security + performance) now consults each reviewer's `relevant_for_change_kinds` — style + performance skip type-only / docs-only / config-only diffs (~10K tokens saved per task on the wrong shape). Planning-phase reviewers (plan-grounding + logic-reviewer) fan out in parallel for MEDIUM + COMPLEX flows (~30-60s saved/task). Gate-1 auto-derives a "Suggested revision" block from planning-phase reviewer findings — one keypress (`1/a/auto-apply`) replans with the auto-derived feedback. Opt-in capped auto-replan loop on REQUEST_CHANGES (`auto_replan_on_blocking_max: 0|1|2`). INV_013 refuses `acceptance: PASS` when impl-phase reviewers still have open blockers. Gate-2 reject distinguishes `revise` vs `abandon`; FINALIZE throws when verdict is null. Runner-agnostic `SpawnRequest` shape (`runner_hint`) unbinds pipeline core from Claude Code Task-tool names. `CLAUDE_PIPELINE_PROJECT_SUBDIR` env var lets non-CC users rename `.claude/`. Bundle abstraction first-class (v2.2.5); stack-classifier candidate registry (v2.2.6). 10 real-task runs across s3-panel + wandr-be + frontend-core.

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
  → /task --no-tests (force skip TDD; driver confirms when business logic is touched)
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
- `--no-tests` on a backend project — driver REQUIRES explicit confirmation when the task touches auth, payments, data persistence, or API endpoints.
- `--with-tests` on a frontend-only project (shared component library with contract tests).

**TDD enforcement** (when `tests_mode=tdd`):
- Plan MUST include Test Specifications with executable AAA blocks; "tests not applicable" escape clause is removed.
- Test Agent's `failing_expected` count MUST match plan's T-case count (driver verifies; mismatch → ERROR).
- Test files are SACRED post-RED — driver hashes them; any modification by implementer is blocking unless human approves.
- Acceptance fails (BLOCKING, not warning) on missing test coverage.

`tests_mode` is stored in `pipeline-state.json` and read by all pipeline steps — single source of truth.

## How the Pipeline Detects Your Stack

As of **v2.2.6**, stack detection is **table-driven** via `templates/stack-candidates.yaml`. The YAML enumerates languages, package managers, default test/lint/build commands, and project-type heuristics. `mcp/src/driver/bundles/code/decisions/stack-detect.ts` is two pure-ish functions — `gatherStackSignals()` reads the project root + `CLAUDE.md` + `package.json`; `resolveStack()` walks the YAML to pick `{language, package_manager, test_command, lint_command, build_command, project_type}`. Zero per-language conditional branches in TypeScript.

Out of the box, 9 ecosystems work: TypeScript, JavaScript, Python, Rust, Go, C#, Svelte, Elixir, Dart.

CLAUDE.md can override the deterministic defaults via the preferred marker convention (language-agnostic):

```markdown
<!-- validation-commands -->
- test: pnpm -r test
- lint: pnpm -r lint
- build: pnpm build
<!-- /validation-commands -->
```

The deprecated `## Validation Commands` English-header form still works as a fallback. As of v2.2.7, the classifier-agent auto-spawns in the context phase and overrides the deterministic baseline with LLM picks when its `stack` block validates against `classifier-output.schema.json`; on validation failure the YAML resolver's deterministic pick stays authoritative (audit `error_class: "llm-classification-needed"`).

**Senior-pattern references** in `agents/references/` self-describe via YAML frontmatter (`tags`, `agent_hints`, `summary`, `when_to_load`). The classifier-agent picks up to 5 relevant ones from the catalog at v2.2.7 auto-spawn; `state.decisions.refs_to_load` is populated by the `extract-classifier-output` after-agent-result hook. They cover architecture patterns, db/redis/caching, React 19, API design, concurrency, observability, error handling, security, optimization, Next.js App Router, and test strategy. The list lands in `.claude/refs-to-load.md`.

## Adding a New Platform

Two complementary paths:

**1. New language/ecosystem** — edit `templates/stack-candidates.yaml`:

```yaml
languages:
  - name: kotlin
    signal_files: ["build.gradle.kts", "settings.gradle.kts"]
    extensions: [".kt", ".kts"]

package_managers:
  - name: gradle
    languages: [kotlin]
    signal_files: ["gradlew", "build.gradle.kts"]

default_commands:
  - language: kotlin
    package_manager: gradle
    test: "./gradlew test"
    lint: "./gradlew ktlintCheck"
    build: "./gradlew assemble"
```

No TypeScript change. The Zod loader cross-references your entry and fails fast at process start on typos.

**2. New senior-pattern references** — drop new markdown files into `agents/references/`:

```bash
agents/references/perf-kotlin.md      # Performance checks
agents/references/test-kotlin.md      # Test framework detection + patterns
agents/references/ui-android.md       # Material Design compliance
agents/references/e2e-android.md      # Espresso / UI Automator rules
```

Each ref has YAML frontmatter (tags + agent_hints + summary + when_to_load) so the classifier-agent picks them automatically when the task signal matches.

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

## Under the Hood (v2 plugin framework + bundles)

`/task` is a ≤30-line shuttle in `commands/task.md`. It hands off to `mcp__claude-pipeline__pipeline_run_task` which runs a TypeScript FSM driver in `mcp/src/driver/`. As of v2.2.5, the driver loads plugins through **bundles** — `mcp/src/driver/bundles/code/` is the only bundle today; the `_template/` skeleton shows the shape for future bundles (content, research, VFX, …). There are 7 plugin contracts in `types/plugin.ts` + a `BundleManifest` contract in `types/bundle.ts`:

| Contract | What it controls | Where code-bundle plugins live |
|----------|------------------|----------------------|
| `StepPlugin` | One FSM step (classify, plan, review, finalize, classify-agent, …) | `bundles/code/steps/` (24) |
| `AgentPlugin` | One LLM role wrapping an `agents/*.md` template | `bundles/code/agents/` (21) |
| `FlowPlugin` | Ordered list of steps per complexity | `bundles/code/flows/` (3) |
| `GatePlugin` | A human gate (gate-0/1/2 or custom) | `bundles/code/gates/` (3) |
| `DecisionPlugin<T>` | Pure decision (complexity, tests_mode, stack-detect, …) | `bundles/code/decisions/` (8) |
| `HookPlugin` | Cross-cutting side effect (past-misses load, anti-pattern grep, classifier-output parse, tech-debt auto-capture, …) | `bundles/code/hooks/` (6) |
| `SpawnProviderPlugin` | Agent spawn mechanism (Shuttle today; SDK / Anthropic-SDK / Ollama later — v2.2.7 D4's runner-agnostic `SpawnRequest` decouples this from any specific harness) | `bundles/code/spawn/` (1) |
| `BundleManifest` | Bundle-level catalog of supported plugins + default flow + state-extension schema | `bundles/code/bundle.ts` |

Core driver in `driver/core/` references these types only — never specific plugin names. Adding a new reviewer = new `AgentPlugin` + 1 line in `bundle.ts` `supported_agents`, **zero changes** to core. Adding a different LLM provider = new `SpawnProviderPlugin`, swap in registry. Adding a non-code bundle (content / research / VFX) = new directory under `bundles/`, mirror the `_template/` skeleton, set `state.bundle: <name>`.

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

**State integrity (MCP + hooks enforced):** every mutation to `pipeline-state.json`, `findings.jsonl`, `driver-state.json`, and `mcp-audit.jsonl` goes through `mcp__claude-pipeline__*` tools. The MCP server refuses incoherent transitions (terminal-state reopen, completed/skipped phase with open spawns, agent recorded before prereqs are done — see invariants `INV_001`–`INV_012` in `mcp/README.md`) and `pipeline_finish` refuses to write metrics on any invariant violation. On top of that, the `pipeline-guard.sh` PreToolUse hook mechanically denies any `Write`/`Edit`/`Bash` that would touch these files outside the MCP — even if the driver tries (20 evasion patterns blocked, including `bash -c`, command substitution, `find -delete`, Python/Node/Deno/Perl/Ruby file ops, `dd of=`, `gzip` in-place). Escape hatch: call `pipeline_unlock_writes({ttl_seconds, reason})` for a TTL-bounded, audit-logged, forgery-resistant marker. See `hooks/README.md` and `mcp/README.md`.

```
Reviewer misses a real bug (caught later in prod / by human / by test)
  ↓
/agent-feedback → metrics/agent-feedback.jsonl (with category + pattern_to_look_for + human_confirmed)
  ↓
Next pipeline run: driver caches per-agent past-misses files; reviewers Read on every spawn
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
- **Don't Write/Edit `.claude/pipeline-state.json`, `.claude/findings.jsonl`, `.claude/driver-state.json`, or any MCP-managed file directly.** Use the `mcp__claude-pipeline__*` tools. The `pipeline-guard.sh` PreToolUse hook mechanically denies direct edits — including via `bash -c`, command substitution, `find -delete`, embedded `python/node/perl/ruby` write-ops, and `gzip` in-place compression. If you genuinely need a one-shot bypass for debugging, call `pipeline_unlock_writes({ttl_seconds: 300, reason: "..."})`; `/done` and `pipeline_relock_writes` re-lock. Don't try to forge a bypass marker — it carries `issued_at` and the guard rejects anything where `expires_at - issued_at > 3600s`.

## See also

- [`README.md`](README.md) — overview + install + architecture diagram + docs index
- [`mcp/README.md`](mcp/README.md) — MCP tool reference (21 tools) + invariants INV_001-013
- [`hooks/README.md`](hooks/README.md) — guard hook + Stop hook mechanics + bypass
- [`validation-log.md`](validation-log.md) — validation workflow + cross-cutting observations
- [`validation/closed-tasks/`](validation/closed-tasks/) — per-task validation entries (10 real-task runs across s3-panel + wandr-be + frontend-core)