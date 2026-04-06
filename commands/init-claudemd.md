# Init CLAUDE.md

Generate a CLAUDE.md for the current project. Read project files to auto-detect what you can, then present the template with filled-in values and ask the user to confirm before writing.

## Process

1. **Auto-detect** by reading project files:
   - Language/framework: `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, etc.
   - Source directory: `src/`, `app/`, `lib/`, etc.
   - Validation commands: scripts in `package.json`, `Makefile`, `pyproject.toml [tool.ruff]`, etc.
   - Test framework: jest/vitest/pytest/go test config
   - Linter: eslint/ruff/golangci-lint config
   - Architecture: directory structure patterns
   - Git: check recent commits for conventional commit style

2. **Present** the filled template to the user. Mark anything you couldn't detect with `[TODO: ...]`.

3. **Ask** the user to review and confirm. Make edits based on feedback.

4. **Write** to `CLAUDE.md` in project root.

---

## Template

```markdown
# [project-name] — Instructions

## Stack
[Language, framework, major libraries — one line each]

## Validation Commands
[REQUIRED — pipeline reads these to know what to run]
- Typecheck: `[command or "N/A"]`
- Build: `[command or "N/A"]`
- Lint: `[command]`
- Test: `[command or "No tests yet"]`
- Format: `[command or "handled by lint"]`

## Architecture
[How the project is structured — directories, key patterns]
```
[directory tree, 1 level deep]
```

## Import / Module Rules
[What can import from what. Cross-module boundaries. Barrel exports or not.]

## Key Patterns
[How things are done in this codebase — data fetching, state management, error handling, etc. 2-5 bullet points of the most important patterns.]

## What NOT to Do
[Anti-patterns specific to this project. Things Claude should avoid. 5-10 bullet points.]
```

---

## Sections Guide

### Required for pipeline (without these, agents guess):
- **Validation Commands** — Acceptance Agent and pipeline validation step read these
- **Architecture** — Code Analyzer and Planner use this to place files correctly
- **What NOT to Do** — prevents the most common mistakes

### Recommended (improves quality significantly):
- **Stack** — helps agents choose correct patterns and libraries
- **Import / Module Rules** — Style Reviewer checks these
- **Key Patterns** — Implementer follows these instead of inventing new ones

### Recommended for projects with tests:
- **Testing** section in CLAUDE.md. Include:
  - Framework name
  - Test file location convention (`colocated`, `__tests__/`, `tests/`)
  - Test naming convention (`*.test.ts`, `*.spec.ts`, `test_*.py`)
  - Mocking approach (MSW, jest.mock, pytest fixtures, unittest.mock)
  - What to test and what not to test

### Optional (add when relevant):
- **API / Backend** — base URL, auth pattern, codegen setup
- **i18n** — if the project uses internationalization
- **Performance** — specific targets or constraints
- **Deployment** — how code reaches production

### Keep out of CLAUDE.md (too detailed, read on demand):
- Full API endpoint tables → put in `docs/api-reference.md`
- Sprint specs → put in `docs/`
- UX specs → separate file
- Lookup tables (color maps, enum mappings) → only if used frequently during coding

### Size target:
- **80-150 lines** is the sweet spot
- Every line is loaded into context on every message
- If a section is rarely needed, move it to a docs/ file and link to it
