# Claude Pipeline

Multi-agent development pipeline for Claude Code. Language-agnostic framework — project-specific rules live in each project's CLAUDE.md.

## Commands

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
| `/validate` | Run typecheck + build + lint |
| `/new-feature <name>` | Scaffold a feature module (project-specific) |
| `/init-claudemd` | Generate CLAUDE.md for a new project |
| `/validate-claudemd` | Audit existing CLAUDE.md for completeness |
| `/check-translations` | Verify i18n locale files have same keys |
| `/check-imports` | Check for import boundary violations |

## Agents (22)

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
  ├─ STEP 1: Complexity classification (simple/medium/complex)
  ├─ STEP 2: Gate 0 — human confirms classification
  ├─ STEP 3: Context enrichment (agents read codebase)
  ├─ STEP 4: Planning (competing planners for complex)
  ├─ Gate 1 — human reviews plan
  ├─ STEP 5: Implementation + code review
  ├─ STEP 6: Validation (typecheck, build, lint, acceptance)
  └─ Gate 2 — human accepts result → /done
```

## Setup

```bash
# Clone
git clone git@github.com:teaarte/claude-pipeline.git

# Symlink into ~/.claude/
ln -sf $(pwd)/claude-pipeline/agents ~/.claude/agents
ln -sf $(pwd)/claude-pipeline/commands ~/.claude/commands
ln -sf $(pwd)/claude-pipeline/pipelines ~/.claude/pipelines
ln -sf $(pwd)/claude-pipeline/templates ~/.claude/templates
cp claude-pipeline/CLAUDE.md ~/.claude/CLAUDE.md
```

## Project Setup

Each project needs a `CLAUDE.md` with at minimum:
- **Validation Commands** — what to run for typecheck/build/lint/test
- **Architecture** — directory structure and patterns
- **What NOT to Do** — project-specific anti-patterns

Run `/init-claudemd` in any project to generate one automatically.

## Requirements
- Claude Code CLI
- `context7` and `typescript-lsp` plugins (recommended)
