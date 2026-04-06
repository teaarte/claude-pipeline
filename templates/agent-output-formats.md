# Agent Output Format Standards

All reviewer/validator agents MUST start output with a status comment for machine parsing:

```
<!-- STATUS: [value] -->
```

## Valid Statuses

| Agent | Valid Statuses |
|-------|---------------|
| Logic Reviewer | APPROVE, REQUEST_CHANGES |
| Style Reviewer | APPROVE, REQUEST_CHANGES |
| Security Agent | APPROVE, REQUEST_CHANGES, WARN |
| Performance Agent | APPROVE, REQUEST_CHANGES, WARN |
| Acceptance Agent | PASS, FAIL, PASS_WITH_WARNINGS |
| Test Agent | PASS, FAIL |
| API Contract Agent | APPROVE, REQUEST_CHANGES |
| Playwright Agent | PASS, FAIL |
| UI Consistency Agent | APPROVE, REQUEST_CHANGES |

## Agents Without Status Lines

These produce data documents, not verdicts:

| Agent | Output |
|-------|--------|
| Dependency Auditor | `.claude/dependency-audit.md` |
| Code Analyzer | `.claude/context-doc.md` |
| Architect | `.claude/architecture-decisions.md` |
| Planner | `.claude/plan.md` |
| Implementer | Inline completion report |
| Research | Inline research results |
| Migration | Inline migration plan |

## Parsing Rules

1. Read FIRST line of agent output
2. Extract: `<!-- STATUS: (.+) -->`
3. REQUEST_CHANGES or FAIL → check "## Blocking Issues" section
4. APPROVE/PASS/WARN → proceed
5. Non-blocking issues → log in pipeline-state.md
