# Done — Task Completion

Post-task checklist. Run through all steps.

---

## 1. Validate
Run validation commands from CLAUDE.md. Fix any errors before proceeding.

## 2. Pipeline Metrics
If `.claude/pipeline-state.md` exists (task was run via `/task`), extract metrics and append to `~/.claude/metrics/pipeline.md`:

```
| date | project | task (short) | complexity | plan_iters | impl_iters | blockers_found | reviewer_verdicts | verdict |
```

Parse from pipeline-state.md:
- **plan_iters** — count of "Plan — Iteration N" checked items
- **impl_iters** — count of "Implementation — Iteration N" checked items
- **blockers_found** — count of blocking issues across all reviewer verdicts
- **reviewer_verdicts** — compact summary, e.g. "Logic:APPROVE Style:APPROVE Security:WARN"
- **verdict** — Gate 2 result (accepted/rejected)

If `~/.claude/metrics/pipeline.md` doesn't exist, create it with the header row.

## 3. Knowledge Base Updates
If CLAUDE.md references a Knowledge Base:
- Update changelog entry for the work done
- Update sprint status if changed
- Create ADR if an architectural choice was made

## 4. Clean Working Files
- Delete all `.claude/*.md` files (plan.md, pipeline-state.md, context-doc.md, dependency-audit.md, architecture-decisions.md, plan-*.md, review files, implementation-notes*.md)
- Keep only `settings.local.json` and `commands/` directory
- Delete `PLANNING.md` in project root if it exists (debug agent artifact)

## 5. Summary
Show:
- Validation results
- Metrics row added (if pipeline was used)
- KB files updated
- Working files cleaned
