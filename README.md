# Claude Pipeline

Multi-agent development pipeline for Claude Code. Language-agnostic framework — project-specific rules live in each project's CLAUDE.md.

## Commands

### Workflow
| Command | When to use |
|---------|-------------|
| `/task <description>` | Any task — auto-classifies complexity (simple/medium/complex), runs full pipeline |
| `/quick <description>` | Obvious change, 1-3 files, no new patterns |
| `/brainstorm <idea>` | Explore an idea before writing code |
| `/research <topic>` | Evaluate libraries/approaches for the project's stack |
| `/debug-team <bug>` | Bug with unclear root cause — competing hypotheses investigation |
| `/task-continue` | Resume a paused pipeline (after Human Gate feedback) |
| `/task-status` | Show current pipeline state |
| `/code-review` | Multi-agent code review (Logic + Style + Performance + Dependency) |
| `/done` | Post-task: validate, update KB, clean working files |

### Project Bootstrap
| Command | When to use |
|---------|-------------|
| `/init-claudemd` | Generate CLAUDE.md for a new project |
| `/validate-claudemd` | Audit existing CLAUDE.md for completeness |
| `/init-kb <path>` | Scan current repo, generate Knowledge Base entries (project card, tech debt) |
| `/init-kb-contracts <path>` | Generate cross-project contracts from all project cards in KB |

### Utilities
| Command | When to use |
|---------|-------------|
| `/validate` | Run typecheck + build + lint |
| `/new-feature <name>` | Scaffold a feature module (project-specific) |
| `/check-translations` | Verify i18n locale files have same keys |
| `/check-imports` | Check for import boundary violations |

## Agents (20)


### Enrichment
- **cost-estimator** — classify task complexity
- **dependency-auditor** — map affected files
- **code-analyzer** — extract real codebase patterns
- **architect** — design architecture for complex tasks
- **research** — evaluate libraries/approaches

### Planning
- **planner** — create implementation plan (3 competing mandates for complex tasks: minimalist, robust, reuse)

### Review
- **logic-reviewer** — correctness, bugs, edge cases
- **style-reviewer** — naming, patterns, duplication
- **security** — vulnerabilities relevant to the stack
- **performance** — real perf issues, no premature optimization

### Implementation
- **implementer** — write code following the plan exactly

### Validation
- **acceptance** — verify acceptance criteria + mechanical checks
- **test** — write and run tests for the task
- **playwright** — E2E tests
- **ui-consistency** — design system compliance
- **api-contract** — frontend/backend contract sync

### Standalone triggers
- **runtime-debug-agent** — auto-triggers on error reports
- **test-all-agent** — fix all failing tests
- **fe-test-all-agent** — fix all failing frontend tests

### Other
- **migration** — handle breaking changes safely

## Pipeline Flow

```
/task "add user settings page"
  |
  +- STEP 0: Brainstorming (if scope unclear)
  +- STEP 1: Complexity classification (simple/medium/complex)
  +- STEP 2: Gate 0 — human confirms classification
  +- STEP 3: Context enrichment (agents read codebase)
  +- STEP 4: Planning (competing planners for complex)
  +- Gate 1 — human reviews plan
  +- STEP 5: Implementation + code review
  +- STEP 6: Validation (typecheck, build, lint, acceptance)
  +- Gate 2 — human accepts result -> /code-review -> /done
```

### What runs at each complexity level

| Step | SIMPLE | MEDIUM | COMPLEX |
|------|--------|--------|---------|
| Context | Inline (orchestrator reads files) | Dependency Auditor + Code Analyzer | + Architect |
| Planning | 1 Planner, no review | 1 Planner + 2 reviewers | 3 competing Planners + 4 reviewers |
| Implementation | 1 Implementer, no checkpoints | 1 Implementer + checkpoints | Parallel implementers per module |
| Code Review | Logic + Style | Logic + Style + Security + Perf | Logic + Style + Security + Perf |
| Validation | Acceptance only | + Test + UI/API if changed | + Playwright |
| Human Gates | Gate 1 + Gate 2 | Gate 0 + Gate 1 + Gate 2 | Gate 0 + Gate 1 + Gate 2 |

## Model Routing

Adaptive routing: cheaper model for mechanical work, expensive model for reasoning. Complex tasks upgrade borderline agents.

| Agent | simple/medium | complex |
|-------|:------------:|:-------:|
| Planner, Implementer, Logic Reviewer | opus | opus |
| Architect, Research, Migration | opus | opus |
| Code Analyzer | sonnet | **opus** |
| Security Agent | sonnet | **opus** |
| Performance Agent | sonnet | **opus** |
| Dependency Auditor | sonnet | sonnet |
| Style Reviewer | sonnet | sonnet |
| Acceptance Agent | sonnet | sonnet |
| Test, Playwright, UI, API Contract | sonnet | sonnet |

**Always sonnet (7):** Dependency Auditor, Style Reviewer, Acceptance, Test, UI Consistency, API Contract, Playwright — checklist/grep/pattern-matching tasks.

**Always opus (6):** Planner, Implementer, Logic Reviewer, Architect, Research, Migration — require deep reasoning.

**Adaptive (3):** Code Analyzer, Security, Performance — sonnet for simple/medium, opus for complex.

## Setup

```bash
git clone git@github.com:teaarte/claude-pipeline.git
cd claude-pipeline

# Symlink into ~/.claude/
ln -sf "$(pwd)/agents" ~/.claude/agents
ln -sf "$(pwd)/commands" ~/.claude/commands
ln -sf "$(pwd)/pipelines" ~/.claude/pipelines
ln -sf "$(pwd)/templates" ~/.claude/templates
cp CLAUDE.md ~/.claude/CLAUDE.md
```

## New Project Setup

### 1. Generate CLAUDE.md
```
cd your-project/
/init-claudemd
```
Creates project-specific CLAUDE.md with validation commands, architecture, anti-patterns. Each project needs one — pipeline reads it to know what to run.

**Required sections** (without these, agents guess):
- **Validation Commands** — typecheck, build, lint, test commands
- **Architecture** — directory structure and patterns
- **What NOT to Do** — project-specific anti-patterns

### 2. Set up Knowledge Base (for multi-repo projects)
```bash
# In each repo — scan and create project card + tech debt
cd repo-1/
/init-kb /path/to/knowledge-base

cd repo-2/
/init-kb /path/to/knowledge-base

cd repo-3/
/init-kb /path/to/knowledge-base

# In any repo — generate cross-project contracts
/init-kb-contracts /path/to/knowledge-base
```

Creates:
```
knowledge-base/
  HOME.md                       <- system diagram + links
  cross-project-contracts.md    <- API contracts between services
  tech-debt.md                  <- issues across all projects
  projects/
    repo-1.md                   <- project card
    repo-2.md
    repo-3.md
  backlog/                      <- feature ideas and tasks
  specs/                        <- active task specs
    done/                       <- completed specs (moved by /done)
  decisions/                    <- ADRs (suggested during scan)
  changelog/                    <- YYYY-MM-DD-slug.md (filled via /done)
```

### 3. Validate
```
/validate-claudemd    # audit CLAUDE.md for completeness
/validate             # run typecheck + build + lint
```

## File Structure

```
claude-pipeline/
  agents/              <- 20 specialized agents with machine-parseable output
  commands/            <- 19 slash commands (workflow + bootstrap + utilities)
  pipelines/           <- complexity-specific flows
    simple.md          <- 1 Planner, 2 reviewers, no enrichment agents
    medium.md          <- full enrichment, 1 Planner + 2 reviewers, 4 code reviewers
    complex.md         <- competing planners, 4 plan reviewers, parallel implementers
  templates/           <- pipeline-state.md scaffold, output format standards
  CLAUDE.md            <- global instructions (commit format, agent triggers, KB workflow)
  settings.reference.json <- reference settings (permissions, hooks, plugins)
```

## Requirements
- Claude Code CLI
- Recommended plugins: `context7` (library docs), `typescript-lsp` (type diagnostics)
