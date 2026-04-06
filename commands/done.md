# Done — Task Completion

Post-task checklist. Run through all steps.

---

## 1. Validate
Run validation commands from CLAUDE.md (look for "Validation Commands" section). Fix any errors before proceeding.

## 2. Pipeline Metrics
If `.claude/pipeline-state.md` exists (task was run via `/task`), extract metrics and append to `~/.claude/metrics/pipeline.md`:

```
| date | project | task (short) | complexity | plan_iters | impl_iters | blockers_found | reviewer_verdicts | verdict |
```

Parse from pipeline-state.md:
- **project** — name from CLAUDE.md or directory name
- **plan_iters** — count of "Plan — Iteration N" checked items
- **impl_iters** — count of "Implementation — Iteration N" checked items
- **blockers_found** — count of blocking issues across all reviewer verdicts
- **reviewer_verdicts** — compact summary, e.g. "Logic:APPROVE Style:APPROVE Security:WARN"
- **verdict** — Gate 2 result (accepted/rejected)

If `~/.claude/metrics/pipeline.md` doesn't exist, create it with the header row.

**Print metrics to console after saving:**
```
┌─────────────────────────────────────────────────────┐
│ Pipeline Metrics                                     │
├──────────────┬──────────────────────────────────────┤
│ Project      │ {project}                            │
│ Task         │ {task short description}              │
│ Complexity   │ {simple/medium/complex}               │
│ Plan Iters   │ {N}                                   │
│ Impl Iters   │ {N}                                   │
│ Blockers     │ {N}                                   │
│ Reviewers    │ {Logic:X Style:X Security:X Perf:X}   │
│ Verdict      │ {accepted/rejected}                   │
└──────────────┴──────────────────────────────────────┘
```

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
Print final summary:
```
┌─────────────────────────────────────────────────────┐
│ Task Complete                                        │
├──────────────┬──────────────────────────────────────┤
│ Validation   │ {pass/fail}                           │
│ Metrics      │ {saved / skipped (no pipeline)}       │
│ KB Updated   │ {files list / skipped (no KB)}        │
│ Cleaned      │ {N files removed}                     │
└──────────────┴──────────────────────────────────────┘
```
