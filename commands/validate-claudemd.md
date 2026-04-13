# Validate CLAUDE.md

Audit the current project's CLAUDE.md for completeness, correctness, and token efficiency.

## Process

### 1. Check file exists
Read `CLAUDE.md` in project root. If missing: *"No CLAUDE.md found. Run `/init-claudemd` to create one."*

### 2. Required sections check
Verify these sections exist and are non-empty:

| Section | Why required |
|---------|-------------|
| **Validation Commands** | Pipeline reads these to run typecheck/build/lint/test |
| **Architecture** (or directory structure) | Code Analyzer and Planner need this to place files correctly |
| **What NOT to Do** | Prevents repeated mistakes |

Mark each: PRESENT / MISSING / EMPTY.

### 3. Recommended sections check
| Section | Why recommended |
|---------|---------------|
| **Stack** | Helps agents choose correct patterns |
| **Import / Module Rules** | Style Reviewer checks these |
| **Key Patterns** | Implementer follows these |

Mark each: PRESENT / MISSING.

### 4. Validation Commands verification
Check that the "Validation Commands" section has at least 2 commands defined.

Common keys (not all required — depends on language):
- **Lint:** — required for all projects
- **Test:** — recommended (Test Agent needs this)
- **Typecheck/Build:** — required for compiled languages (TS, Go), optional for Python
- **Format:** — recommended

For each command found:
- Try running it (dry-run if possible, or just check the command/binary exists)
- Verify it matches actual project setup (e.g. `npx tsc` but no `typescript` in deps = broken; `ruff check` but no `ruff` in dev deps = broken)

### 5. Accuracy check
Cross-reference CLAUDE.md claims against actual project:
- Stack listed matches `package.json` / `pyproject.toml` / etc.
- Architecture described matches actual directory structure (`ls src/` or equivalent)
- Import rules match what's actually in the code
- Any references to files/paths that don't exist

### 6. Token efficiency check
- Total line count (target: 80-150 lines)
- Flag sections that could be moved to docs/ (API tables, lookup tables, full endpoint lists)
- Flag duplication with MEMORY.md if it exists
- Flag information that's rarely needed during coding

### 7. Staleness check
- Any references to features/files/patterns that no longer exist
- Any TODO/placeholder text left in
- References to removed KB sections (e.g. `status/sprints.md`)

---

## Output

```
# CLAUDE.md Audit

## Required Sections
| Section | Status |
|---------|--------|
| Validation Commands | PRESENT/MISSING/EMPTY |
| Architecture | PRESENT/MISSING/EMPTY |
| What NOT to Do | PRESENT/MISSING/EMPTY |

## Recommended Sections
| Section | Status |
|---------|--------|
| Stack | PRESENT/MISSING |
| Import Rules | PRESENT/MISSING |
| Key Patterns | PRESENT/MISSING |

## Validation Commands
| Command | Exists | Works |
|---------|--------|-------|
| [command] | yes/no | yes/no/untested |

## Issues Found
- [issue + fix suggestion]

## Token Efficiency
- Lines: [count] (target: 80-150)
- [suggestions to slim down if over 150]

## Verdict: GOOD / NEEDS FIXES / INCOMPLETE
```
