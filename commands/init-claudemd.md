# Init CLAUDE.md

Generate a CLAUDE.md for the current project. Read project files to auto-detect what you can, then present the template with filled-in values and ask the user to confirm before writing.

## Process

1. **Auto-detect** by reading project files:
   - Language/framework: `package.json`, `pyproject.toml`, `pubspec.yaml`, `Cargo.toml`, `Gemfile`, etc.
   - Source directory: `src/`, `app/`, `lib/`, etc.
   - Validation commands: scripts in `package.json`, `Makefile`, `pyproject.toml [tool.ruff]`, etc.
   - Test framework: jest/vitest/pytest/flutter test config
   - Linter: eslint/ruff/golangci-lint config
   - Architecture: directory structure patterns
   - Git: check recent commits for conventional commit style

2. **Present** the filled template to the user. Mark anything you couldn't detect with `[TODO: ...]`.

3. **Ask** the user to review and confirm. Make edits based on feedback.

4. **Write** to `CLAUDE.md` in project root.

---

## Template

The 3 **critical** sections are: Validation Commands, Architecture, What NOT to Do. Without these, pipeline agents guess and produce low-quality output. Never leave these empty or with generic placeholders.

```markdown
# [project-name] — Instructions

## Stack
[Language, framework, major libraries — one line each]

## Validation Commands
[CRITICAL — pipeline reads these to run checks. Must have real, working commands.]
```
Lint: [exact command, e.g. `ruff check` or `npx eslint .`]
Format: [exact command, e.g. `ruff format --check` or `npx prettier --check .`]
Test: [exact command, e.g. `uv run pytest tests/ -v` or `npm test`]
Typecheck: [exact command or N/A, e.g. `npx tsc --noEmit`]
Build: [exact command or N/A]
```

## Architecture
[CRITICAL — Code Analyzer and Planner use this to place files correctly.]
[Describe the actual directory structure, layering, module boundaries.]
```
[directory tree, 1–2 levels deep, with brief descriptions]
```

## Import / Module Rules
[What can import from what. Cross-module boundaries. Barrel exports or not.]

## Key Patterns
[How things are done in this codebase — data fetching, state management, error handling, etc. 2-5 bullet points of the most important patterns. Include code examples for non-obvious patterns.]

## What NOT to Do
[CRITICAL — prevents the most common agent mistakes. Be specific, not generic.]
[5-10 bullet points. Each should describe a concrete mistake + why it's wrong.]
[Example: "Do NOT use `any` for API responses — use generated types from Orval"]
[Example: "Do NOT put business logic in route handlers — use service layer"]
```

---

## Sections Guide

### Required for pipeline (without these, agents guess and produce bad output):
- **Validation Commands** — Must contain real, runnable commands (not placeholders). Verify each command works before writing. Pipeline's Acceptance Agent, Implementer, and `/done` all read these.
- **Architecture** — Must include actual directory tree + description of what each directory contains. Code Analyzer and Planner use this to place files and understand module boundaries.
- **What NOT to Do** — Must contain project-specific anti-patterns (not generic advice like "don't write bad code"). Each rule should describe a concrete mistake. This is the highest-value section — agents follow patterns well but don't know your project's anti-patterns.

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
