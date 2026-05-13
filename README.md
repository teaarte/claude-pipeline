# Claude Pipeline

Multi-agent development pipeline for Claude Code. Supports **React, Next.js, NestJS, Python/FastAPI, Flutter/Dart** — and extensible to any stack via reference files.

Project-specific rules live in each project's CLAUDE.md. Platform-specific agent knowledge lives in `agents/references/`.

State integrity is enforced in two layers:
- **MCP server** (`mcp/`) — `.claude/pipeline-state.json` and `.claude/findings.jsonl` mutations only happen through validated tool calls. Schema validation, phase state machine, and 11 invariants (`INV_001`–`INV_011`) are enforced at write time. See [`mcp/README.md`](mcp/README.md).
- **Claude Code hooks** (`hooks/`) — `pipeline-guard.sh` (PreToolUse) blocks any direct `Write`/`Edit`/`Bash` mutation of MCP-owned files; `pipeline-stop.sh` (Stop) blocks session exit while a task is in flight. See [`hooks/README.md`](hooks/README.md).

## Commands (16)

### Core Workflow
| Command | When to use |
|---------|-------------|
| `/task <description>` | Any task — auto-classifies complexity, runs full pipeline |
| `/quick <description>` | Obvious change, 1-3 files, no new patterns |
| `/task-continue` | Resume after session break or Human Gate feedback |
| `/done` | Finish: validate, save metrics, persist issues, clean up |

### Review & Quality
| Command | When to use |
|---------|-------------|
| `/code-review` | 5-agent parallel review on current changes |
| `/sweep [filter]` | Review and fix accumulated tech debt |
| `/validate-pipeline` | Self-test pipeline config integrity |
| `/validate-claudemd` | Audit CLAUDE.md for completeness |

### Feedback & Metrics
| Command | When to use |
|---------|-------------|
| `/metrics-report` | Analyze pipeline effectiveness (human-readable summary, after 10+ tasks) |
| `/agent-feedback` | Log when a reviewer missed a real issue (writes to `agent-feedback.jsonl` with category) |
| `/learn` | Cluster findings × category, detect drift, surface vocab promotion / pattern auto-promotion candidates |

### Design & Debug
| Command | When to use |
|---------|-------------|
| `/brainstorm <topic>` | Design a feature or research a library/approach |
| `/debug-team <bug>` | Competing hypotheses for hard-to-find bugs |

### Project Setup
| Command | When to use |
|---------|-------------|
| `/init-claudemd` | Generate CLAUDE.md for a new project |
| `/init-kb <path>` | Scan repo, create Knowledge Base entries |
| `/init-kb-contracts <path>` | Generate cross-project API contracts |

## Agents (23)

### Enrichment
| Agent | Role |
|-------|------|
| dependency-auditor | Map affected files and consumers |
| code-analyzer | Extract real codebase patterns |
| context-doc-verifier | Spot-checks Code Analyzer's claims (5 random + naming convention) — catches hallucinated patterns before Planner consumes them |
| architect | Design architecture for complex tasks |
| research | Evaluate libraries/approaches |

### Planning & Implementation
| Agent | Role |
|-------|------|
| planner | Create implementation plan with `file:line` citations and executable AAA test specs (3 competing mandates for complex) |
| plan-grounding-check | Verifies every plan citation against the real code; blocks Gate 1 if hallucinated |
| test | Write failing tests BEFORE implementation (translates AAA blocks mechanically) — or after (test-after for bug fixes) |
| implementer | Write production code — fills skeletons when TDD, writes directly when regression-only |
| plan-conformance | Diff vs plan: surfaces files-touched-outside-plan, unsatisfied ACs, in-file overreach |

### Review
| Agent | Role |
|-------|------|
| logic-reviewer | Correctness, bugs, edge cases, race conditions. Loads past-misses block on every spawn. |
| challenger-reviewer | Adversarial counterpart to logic-reviewer (MEDIUM/COMPLEX) — runs probes (concurrency, hostile input, ordering) and flags failure modes. Independent verdict; disagreements escalated to human. |
| style-reviewer | Naming, patterns, duplication, CLAUDE.md compliance. Past-misses-aware. |
| security | Real vulnerabilities for this stack. Past-misses-aware. |
| performance | Perf issues — loads platform checks from `references/perf-{stack}.md`. Past-misses-aware. |

### Validation
| Agent | Role |
|-------|------|
| acceptance | Acceptance criteria + mechanical checks + test coverage |
| e2e (playwright) | E2E tests — loads from `references/e2e-{platform}.md` |
| ui-consistency | Design system compliance — loads from `references/ui-{platform}.md` |
| api-contract | Frontend/backend/cross-repo contract sync |
| migration | Handle breaking changes (API, DB, proto, alembic, types) |

### Standalone (auto-trigger)
| Agent | Role |
|-------|------|
| runtime-debug-agent | Auto-triggers on error reports — investigates, creates fix plan |
| test-all-agent | Fix or remove failing tests to reach 100% passing (any stack) |
| fe-test-all-agent | Same but locates frontend directory first |

## Platform Reference Files

Agents are thin (role + detect stack + output format). Platform-specific knowledge lives in `agents/references/`:

```
agents/references/
  # Platform-specific (loaded by stack)
  perf-react.md         React/Next.js performance checks
  perf-flutter.md       Widget rebuilds, lists, images, state, dispose
  perf-python.md        FastAPI/asyncio checks
  perf-nestjs.md        NestJS DB, API, architecture, memory

  ui-web.md             Web accessibility, responsive
  ui-flutter.md         Material/Cupertino, SafeArea, navigation, a11y

  test-react.md         Vitest/Jest, component testing, MSW
  test-flutter.md       flutter_test, widget tests, mocktail/Riverpod
  test-python.md        pytest, fixtures, AsyncMock
  test-nestjs.md        Jest, TestingModule, overrideProvider

  e2e-playwright.md     Playwright process and rules
  e2e-flutter.md        integration_test process and rules

  # Senior-pattern references (Tier 1, 2, 3 — conditionally loaded by orchestrator)
  arch-patterns.md          T1: sync/async boundaries, abstractions, idempotency, failure modes
  db-postgres.md            T1: indexes, EXPLAIN, isolation, migration safety, N+1, pagination
  redis.md                  T1: primitives, persistence, eviction, locks, pipelining, hot keys
  react19.md                T1: Server Components, Actions, use(), useOptimistic, Suspense
  caching.md                T1: layer choice, invalidation strategies, stampede, TTL discipline
  api-design.md             T2: REST/GraphQL/gRPC, idempotency, pagination, versioning, error envelope
  concurrency.md            T2: async patterns, locks, retries, backpressure, single-writer principle
  test-strategy.md          T2: test pyramid, mocking, contract tests, property-based, flake mitigation
  observability.md          T2: structured logs, traces, metrics (RED/USE), SLO, alerting hygiene
  error-handling.md         T2: error categorization, retry policy, circuit breakers, DLQ, error envelope
  security-backend.md       T3: auth, JWT pitfalls, SQL/NoSQL injection, secrets, CSRF, SSRF, mass assignment
  optimization-strategy.md  T3: profile-first, latency vs throughput, big-O at scale, when NOT to optimize
  next-app-router.md        T3: Server/Client boundary, caching layers, Server Actions, Suspense, middleware
```

**Adding a new platform** (e.g. Go, Kotlin/Android): create `perf-go.md`, `test-go.md`, etc. — no agent files need changing.

**Senior-pattern references** are loaded conditionally by the orchestrator at STEP 1 (rule #24): stack-trigger (e.g. `react@>=19` → `react19.md`), diff/dependency-audit-trigger (e.g. `*.sql` → `db-postgres.md`), or task-trigger (e.g. "cache" mention → `caching.md`). Capped at 4 senior-pattern files per agent per task to avoid prompt bloat. Loaded list lands in `.claude/refs-to-load.md`.

**Each reference file follows a fixed template:** When this applies → Default Stance → Patterns → Anti-Patterns (with prod failure modes) → Decision Framework → Cost Model → Red Flags in Diff. Reviewers turn the **Red Flags in Diff** sections into additional hunt targets.

## Pipeline Flow

```
/task "add user settings page"
  |
  +- STEP -1: Trivial detection (skip pipeline for rename/typo/config)
  +- STEP 0:  Brainstorming (if scope unclear)
  +- STEP 1:  Stack detection + complexity + tests_mode
  +- STEP 2:  Gate 0 — human confirms (skipped for SIMPLE)
  |           + enrichment agents launched in background for MEDIUM/COMPLEX
  +- STEP 3:  Context enrichment (collect background results + remaining agents)
  |  +- 3b:   Context-Doc Verifier (MEDIUM/COMPLEX)
  +- STEP 4:  Planning (with file:line citations + executable AAA test specs)
  |  +- 4b:   Plan Grounding Check (MEDIUM/COMPLEX) — citations verified
  |  +- 4c:   Plan reviewers
  +- Gate 1 — human reviews plan
  +- STEP 5:  Test-First (RED) — only when tests_mode: tdd
  +- STEP 6:  Implementation (GREEN) — rollback stash created first
  |  +- pre:  CLAUDE.md anti-pattern grep + Caller-context expansion (MEDIUM/COMPLEX)
  |  +-       Code review (Logic ‖ Challenger MEDIUM/COMPLEX ‖ Style ‖ Security ‖ Perf)
  |  +-       Logic vs Challenger reconciliation — disagreement escalates to Gate 2
  +- STEP 6b: Test verification (regression check or full GREEN)
  +- STEP 6c: Plan Conformance — drift / unfinished / AC coverage
  +- STEP 7:  Validation (lint, typecheck, acceptance)
  +- STEP 8:  Final report (Orchestrator)
  +- Gate 2 — human accepts → /code-review → /done
```

### Tests Mode — Auto-Detection

`tests_mode` is determined once at STEP 1 and stored in `pipeline-state.json`. It controls whether STEP 5 (Test-First) runs and how STEP 6b (verification) behaves.

| Project type | tests_mode | What happens |
|-------------|-----------|-------------|
| Frontend app (Next.js, React, Vue, Svelte, Angular) | `regression-only` | STEP 5 skipped, existing tests checked for regressions |
| Backend (NestJS, Express, FastAPI, Django) | `tdd` | Full TDD: skeletons → failing tests → implementation → GREEN |
| Shared library / package | `tdd` | Full TDD |

**Override flags:**
- `--no-tests` → force `regression-only` on any project
- `--with-tests` → force `tdd` on any project (e.g. frontend lib with contract tests)

### TDD flow (when tests_mode: tdd)

```
Planner                    Test Agent                  Implementer
   |                           |                           |
   +-- Plan with Test Specs    |                           |
   |   (inputs, expected       |                           |
   |    outputs, what each     |                           |
   |    test proves)           |                           |
   +-------------------------->|                           |
                               +-- Create skeletons        |
                               |   (empty classes, DTOs,   |
                               |    method signatures)     |
                               +-- Write failing tests     |
                               +-- Verify RED state        |
                               +-------------------------->|
                                                           +-- Replace stubs
                                                           |   with real logic
                                                           +-- Run tests after
                                                           |   each major step
                                                           +-- All GREEN ✓
```

### Regression-only flow (when tests_mode: regression-only)

```
Planner                    Implementer
   |                           |
   +-- Plan (no test specs)    |
   +-------------------------->|
                               +-- Write production code
                               |   directly from plan
                               +-- Existing tests checked
                               |   for regressions
                               +-- Validation ✓
```

### What runs at each complexity level

| Step | SIMPLE | MEDIUM | COMPLEX |
|------|--------|--------|---------|
| Context | Inline (orchestrator) | Dep Auditor + Code Analyzer + **Context-Doc Verifier** | + Architect |
| Planning | 1 Planner, no review | 1 Planner + **Grounding Check** + 2 reviewers | Planner Team (3 competing + cross-review) + **Grounding Check** + 4 reviewers |
| Test-First | 1 Test Agent (if tdd) | Same | Parallel Test Agents per module (if tdd) |
| Implementation | 1 Implementer | 1 Implementer + checkpoints | Parallel per module |
| Pre-Review | **Anti-pattern grep** | + **Caller-context expansion** | Same as MEDIUM |
| Code Review | Logic + Style + Security* | Logic + **Challenger** + Style + Security + Perf | Same as MEDIUM |
| Post-Impl | **Plan Conformance** | Same | Same |
| Validation | Acceptance | + UI/API if changed | + E2E |
| Human Gates | Gate 1 + Gate 2 | Gate 0 + Gate 1 + Gate 2 | Same |

*Security runs in SIMPLE only when task touches auth/input/API.

### Accuracy mechanisms (cross-cutting)

- **`file:line` citations** in every plan — verified by `plan-grounding-check` before Gate 1.
- **Executable AAA test specs** in every plan — `test` agent translates mechanically, no interpretation.
- **Past-misses injection** — orchestrator caches per-agent past-misses files at pipeline start from `metrics/agent-feedback.jsonl` (filtered by agent + `human_confirmed=true`, last 10). Reviewers read their `.claude/past-misses-{agent}.md`. Closes the loop between `/agent-feedback` logging and future runs.
- **CLAUDE.md anti-pattern grep** before code review — mechanical, free of LLM cost.
- **Caller-context expansion** (1-hop) for changed function signatures, attached to all reviewers (MEDIUM/COMPLEX).
- **Logic vs Challenger reviewer pair** with independent verdicts. Disagreements never auto-route to Implementer — surfaced to human at Gate 2.
- **Plan Conformance** after implementation: drift, unfinished steps, AC coverage all measured.
- **Accuracy metrics** in `metrics/pipeline.jsonl` (append-only, one JSON object per task): `plan_drift`, `gate1_revisions`, `acceptance_first_pass`, `grounding_mismatches`, `reviewer_disagreements`, `reviewer_misses_post_merge`, `categories_seen`. Run `/learn` for clustering and drift analysis; `/metrics-report` for human-readable summary.

## Key Features

### Multi-Platform Support
Orchestrator detects `project_stack` from CLAUDE.md and passes it to all agents. Agents load platform-specific checks from `references/`. Supported: React, Next.js, NestJS, Python/FastAPI, Flutter/Dart.

### Smart Test Mode
`tests_mode` auto-detected from project type. Frontend apps skip TDD (regression-only), backend and libraries get full TDD. Override with `--with-tests` or `--no-tests`. Single field in `pipeline-state.json` — all pipeline steps read from it, no scattered conditionals.

### Issue Collection
Agents find out-of-scope issues → `.claude/issues-found.md` → `/done` persists to `tech-debt.md` → `/sweep` reviews and fixes.

### Self-Improvement Loop (structured, schema-driven)
1. **Findings are first-class structured data.** Every reviewer/validator emits a fenced ```json header validated against `templates/schemas/{reviewer,validator}-output.schema.json`. Each finding has `severity`, `category` (controlled vocab in `templates/schemas/category-vocab.json`), `pattern_id`, `summary`, `evidence_excerpt`, `suggested_fix`, `ref_rule_id`. Findings stream to `.claude/findings.jsonl` **via `mcp__claude-pipeline__pipeline_record_agent_run` — orchestrator no longer writes the file manually.**
2. `/done` writes one JSON object per task to `~/.claude/metrics/pipeline.jsonl` via `mcp__claude-pipeline__pipeline_finish` — mechanical JSON-to-JSON transform from `pipeline-state.json`, refused if invariants fail. Includes plan_drift, gate1_revisions, acceptance_first_pass, grounding_mismatches, reviewer_disagreements, categories_seen.
3. `/agent-feedback` logs missed issues to `~/.claude/metrics/agent-feedback.jsonl` via `mcp__claude-pipeline__pipeline_log_agent_feedback` with required `category` + `pattern_to_look_for` + `human_confirmed`. Increments `reviewer_misses_post_merge` on the linked `pipeline.jsonl` row.
4. **Future runs auto-load each agent's last 10 confirmed patterns** as a `## Past Misses` block on every spawn (orchestrator rule #15). Diff-aware filtering optionally re-ranks by relevant category.
5. `/learn` clusters categories × agent, computes effectiveness ratios, detects drift trends, surfaces vocab promotion candidates and pattern auto-promotion candidates. Mostly mechanical; final step optionally suggests prompt edits for human review.
6. `/metrics-report` retains its role for human-readable narrative summary of recent performance.

### Background Enrichment
MEDIUM/COMPLEX tasks launch enrichment agents in the background during Gate 0 — they work while you review the classification. By the time you confirm, context is already gathered.

### Agent Teams for COMPLEX Planning
COMPLEX tasks use agent teams (not independent parallel agents) for competing planners. Three planners with different mandates (minimalist/robust/reuse) see each other's work, challenge weak spots, and the lead synthesizes the final plan. Better than orchestrator synthesis because planners cross-review before the plan is finalized.

### Cross-Session Recovery
Pipeline state saved after every agent completion. `/task-continue` resumes from exact point.

## Model Routing

Canonical table is in `commands/task.md`. Simplified view:

| Agent | simple/medium | complex |
|-------|:------------:|:-------:|
| Planner, Implementer, Logic Reviewer | opus | opus |
| Architect, Research, Migration | opus | opus |
| Code Analyzer, Security, Performance | sonnet | **opus** |
| All others | sonnet | sonnet |

## Setup

```bash
git clone <repo-url>
cd claude-pipeline

# Symlink into ~/.claude/
ln -sf "$(pwd)/agents" ~/.claude/agents
ln -sf "$(pwd)/commands" ~/.claude/commands
ln -sf "$(pwd)/pipelines" ~/.claude/pipelines
ln -sf "$(pwd)/templates" ~/.claude/templates

# Copy metrics (don't symlink — they're per-machine)
mkdir -p ~/.claude/metrics
cp metrics/*.jsonl ~/.claude/metrics/ 2>/dev/null || true

# Build and register the MCP enforcement server
cd mcp && pnpm install && pnpm build && cd ..
claude mcp add --scope user claude-pipeline -- node "$(pwd)/mcp/dist/server.js"

# Install the Claude Code hooks (mechanical guardrails on top of the MCP)
mkdir -p ~/.claude/hooks
ln -sfn "$(pwd)/hooks/pipeline-guard.sh" ~/.claude/hooks/pipeline-guard.sh
ln -sfn "$(pwd)/hooks/pipeline-stop.sh"  ~/.claude/hooks/pipeline-stop.sh
# then merge the PreToolUse and Stop fragments from settings.reference.json
# into your ~/.claude/settings.json — see hooks/README.md for details

# Install RTK (recommended — 60-90% token savings)
brew install rtk-ai/tap/rtk && rtk init -g
```

### New Project Setup

```bash
cd your-project/
/init-claudemd          # Generate CLAUDE.md (auto-detects stack)
/validate-claudemd      # Verify it's complete

# Multi-repo Knowledge Base (optional)
/init-kb /path/to/kb    # Scan each repo
/init-kb-contracts /path/to/kb  # Generate contracts
```

## File Structure

```
claude-pipeline/
  agents/              20 agent prompt templates (role + checklist + JSON output schema).
    references/        platform-specific + senior-pattern knowledge files loaded by agents.
  commands/            slash commands (task is a pure ≤30-line shuttle; orchestration lives in mcp/driver).
  templates/
    schemas/           JSON Schemas — finding, reviewer-output, validator-output, pipeline-state, agent-feedback, category-vocab.
    pipeline-state.json (machine state), pipeline-state-summary.md (human glance).
    agent-output-formats.md
  mcp/                 MCP enforcement server (TypeScript, stdio transport).
    src/tools/         17 MCP tool implementations.
    src/driver/        v2 plugin framework — types, core FSM (plugin-name-free),
                       built-in plugins (steps, agents, flows, gates, decisions,
                       hooks, spawn), loaders, and the two MCP driver tools
                       (pipeline_run_task, pipeline_continue_task).
    README.md          tool reference + invariants.
  hooks/
    pipeline-guard.sh  PreToolUse hook — denies direct Write/Edit/Bash that mutates MCP-managed files (item 4: marker-scoped, Python/Node/Deno/Perl/Ruby/dd coverage, bypass via pipeline_unlock_writes).
    pipeline-stop.sh   Stop hook — blocks session-stop on in-flight pipeline.
    README.md          install instructions + escape hatches.
  metrics/
    pipeline.jsonl     append-only structured per-task metrics.
    agent-feedback.jsonl  append-only structured misses with category.
    mcp-audit.jsonl    append-only audit of every MCP tool call (item 2; FIFO-capped at 10k).
  settings.reference.json
```

The v2 plugin framework lives in `mcp/src/driver/`. The core FSM
(`driver/core/fsm.ts`) is generic — every plugin-specific name lives in
`driver/builtin/` and is registered exclusively in `driver/loaders/builtins.ts`.
A `grep -rEi "planner|implementer|logic-reviewer|gate-[012]" mcp/src/driver/core/`
must return zero matches. To extend the pipeline, add a new plugin file and a
single registry line — no core changes.

## Requirements
- Claude Code CLI
- Node 20+ and pnpm (for the MCP server in `mcp/`)
- Recommended: [RTK](https://github.com/rtk-ai/rtk) (60-90% CLI token savings)
- Recommended plugins: `context7` (library docs)