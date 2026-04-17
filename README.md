# Claude Pipeline

Multi-agent development pipeline for Claude Code. Supports **React, Next.js, NestJS, Python/FastAPI, Flutter/Dart** — and extensible to any stack via reference files.

Project-specific rules live in each project's CLAUDE.md. Platform-specific agent knowledge lives in `agents/references/`.

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
| `/metrics-report` | Analyze pipeline effectiveness (after 10+ tasks) |
| `/agent-feedback` | Log when a reviewer missed a real issue |

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

## Agents (19)

### Enrichment
| Agent | Role |
|-------|------|
| dependency-auditor | Map affected files and consumers |
| code-analyzer | Extract real codebase patterns |
| architect | Design architecture for complex tasks |
| research | Evaluate libraries/approaches |

### Planning & Implementation
| Agent | Role |
|-------|------|
| planner | Create implementation plan with detailed test specifications (3 competing mandates for complex) |
| test | Write failing tests BEFORE implementation (test-first) or after (test-after for bug fixes) |
| implementer | Write production code — fills skeletons when TDD, writes directly when regression-only |

### Review
| Agent | Role |
|-------|------|
| logic-reviewer | Correctness, bugs, edge cases, race conditions |
| style-reviewer | Naming, patterns, duplication, CLAUDE.md compliance |
| security | Real vulnerabilities for this stack |
| performance | Perf issues — loads platform checks from `references/perf-{stack}.md` |

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
```

**Adding a new platform** (e.g. Go, Kotlin/Android): create `perf-go.md`, `test-go.md`, etc. — no agent files need changing.

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
  +- STEP 4:  Planning (with test specifications when tests_mode: tdd)
  +- Gate 1 — human reviews plan
  +- STEP 5:  Test-First (RED) — only when tests_mode: tdd
  +- STEP 6:  Implementation (GREEN) — rollback stash created first
  +- STEP 6b: Test verification (regression check or full GREEN)
  +- STEP 7:  Validation (lint, typecheck, acceptance)
  +- STEP 8:  Final report (Orchestrator)
  +- Gate 2 — human accepts → /code-review → /done
```

### Tests Mode — Auto-Detection

`tests_mode` is determined once at STEP 1 and stored in `pipeline-state.md`. It controls whether STEP 5 (Test-First) runs and how STEP 6b (verification) behaves.

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
| Context | Inline (orchestrator) | Dep Auditor + Code Analyzer | + Architect |
| Planning | 1 Planner, no review | 1 Planner + 2 reviewers | Planner Team (3 competing + cross-review) + 4 reviewers |
| Test-First | 1 Test Agent (if tdd) | Same | Parallel Test Agents per module (if tdd) |
| Implementation | 1 Implementer | 1 Implementer + checkpoints | Parallel per module |
| Code Review | Logic + Style + Security* | Logic + Style + Security + Perf | Same |
| Validation | Acceptance | + UI/API if changed | + E2E |
| Human Gates | Gate 1 + Gate 2 | Gate 0 + Gate 1 + Gate 2 | Same |

*Security runs in SIMPLE only when task touches auth/input/API.

## Key Features

### Multi-Platform Support
Orchestrator detects `project_stack` from CLAUDE.md and passes it to all agents. Agents load platform-specific checks from `references/`. Supported: React, Next.js, NestJS, Python/FastAPI, Flutter/Dart.

### Smart Test Mode
`tests_mode` auto-detected from project type. Frontend apps skip TDD (regression-only), backend and libraries get full TDD. Override with `--with-tests` or `--no-tests`. Single field in `pipeline-state.md` — all pipeline steps read from it, no scattered conditionals.

### Issue Collection
Agents find out-of-scope issues → `.claude/issues-found.md` → `/done` persists to `tech-debt.md` → `/sweep` reviews and fixes.

### Self-Improvement Loop
1. `/done` records metrics (complexity, iterations, blockers, tests, reviewer verdicts)
2. `/metrics-report` calculates reviewer effectiveness, detects over-classification
3. `/agent-feedback` logs missed issues, suggests agent definition updates

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
cp metrics/*.md ~/.claude/metrics/

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
  agents/              19 agent definitions (thin — role + detect + output)
    references/        14 platform-specific knowledge files
  commands/            16 slash commands
  pipelines/           3 complexity flows (simple/medium/complex)
  templates/           pipeline-state scaffold, output format standards
  metrics/             pipeline.md (task metrics), agent-feedback.md
  settings.reference.json
```

## Requirements
- Claude Code CLI
- Recommended: [RTK](https://github.com/rtk-ai/rtk) (60-90% CLI token savings)
- Recommended plugins: `context7` (library docs)