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
| `/done` | Post-task: validate, update KB, clean working files |

### Utilities
| Command | When to use |
|---------|-------------|
| `/validate` | Run typecheck + build + lint |
| `/new-feature <name>` | Scaffold a feature module (project-specific) |
| `/init-claudemd` | Generate CLAUDE.md for a new project |
| `/validate-claudemd` | Audit existing CLAUDE.md for completeness |
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
  │
  ├─ STEP 0: Brainstorming (if scope unclear)
  ├─ STEP 1: Complexity classification (simple/medium/complex)
  ├─ STEP 2: Gate 0 — human confirms classification
  ├─ STEP 3: Context enrichment (agents read codebase)
  ├─ STEP 4: Planning (competing planners for complex)
  ├─ Gate 1 — human reviews plan
  ├─ STEP 5: Implementation + code review
  ├─ STEP 6: Validation (typecheck, build, lint, acceptance)
  └─ Gate 2 — human accepts result → /done
```

### What runs at each complexity level

| Step | SIMPLE | MEDIUM | COMPLEX |
|------|--------|--------|---------|
| Context | Inline (orchestrator reads files) | Dependency Auditor + Code Analyzer | + Architect |
| Planning | 1 Planner, no review | 1 Planner + 2 reviewers | 3 competing Planners + 4 reviewers |
| Implementation | 1 Implementer, no checkpoints | 1 Implementer + checkpoints | Parallel implementers per module |
| Code Review | Logic + Style | Logic + Style + Security + Perf | Logic + Style + Security + Perf |
| Validation | Acceptance only | + Test + UI/API if changed | + Playwright |
| Post | Skip | Skip | Skip |
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

**Always sonnet (7 agents):** Dependency Auditor, Style Reviewer, Acceptance, Test, UI Consistency, API Contract, Playwright — all checklist/grep/pattern-matching tasks.

**Always opus (6 agents):** Planner, Implementer, Logic Reviewer, Architect, Research, Migration — require deep reasoning.

**Adaptive (3 agents):** Code Analyzer, Security, Performance — sonnet for simple/medium, opus for complex where subtle issues matter.

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

## Project Setup

Each project needs a `CLAUDE.md` with at minimum:

```markdown
## Validation Commands          ← REQUIRED: pipeline reads these
- Typecheck: `npx tsc --noEmit`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`

## Architecture                 ← REQUIRED: agents use this to place files
src/
  modules/
  shared/

## What NOT to Do               ← REQUIRED: prevents repeated mistakes
- Don't use any types
- Don't import across modules
```

Run `/init-claudemd` in any project to auto-generate from project files.
Run `/validate-claudemd` to audit an existing one.

## File Structure

```
claude-pipeline/
  agents/              ← 20 specialized agents with machine-parseable output
  commands/            ← 14 slash commands (workflow + utilities)
  pipelines/           ← complexity-specific flows (simple/medium/complex)
    simple.md          ← 1 Planner, 2 reviewers, no enrichment agents
    medium.md          ← full enrichment, 1 Planner + 2 reviewers, 4 code reviewers
    complex.md         ← competing planners, 4 plan reviewers, parallel implementers
  templates/           ← pipeline-state.md scaffold, output format standards
  CLAUDE.md            ← global instructions (commit format, agent triggers, KB workflow)
  settings.reference.json ← reference settings (permissions, hooks, plugins)
```

## Requirements
- Claude Code CLI
- Recommended plugins: `context7` (library docs), `typescript-lsp` (type diagnostics)
