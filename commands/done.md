# Done — Task Completion

Post-task checklist. Run through all steps.

---

## 1. Validate
Run validation commands from CLAUDE.md (look for "Validation Commands" section). Fix any errors before proceeding.

## 2. Pipeline Metrics
If `.claude/pipeline-state.md` exists (task was run via `/task`), extract metrics and append to `~/.claude/metrics/pipeline.md`.

If `.claude/pipeline-state.md` does NOT exist but the session clearly used `/task` (check conversation history for `/task` invocation), this is a **pipeline violation** — the Orchestrator forgot to create it. In this case:
1. Print warning: *"WARNING: `/task` was invoked but `pipeline-state.md` was never created. This is a pipeline bug — metrics are incomplete. Reconstructing from conversation history."*
2. Reconstruct metrics manually from the conversation (agent calls, reviewer verdicts, etc.) and save them.
3. Record `pipeline_violation: missing-state-file` in the metrics row as metadata.

Metrics format:

```
| date | project | task (short) | complexity | plan_iters | impl_iters | blockers_found | reviewers_with_blockers | reviewer_verdicts | tests_written | agents_count | verdict |
```

Parse from pipeline-state.md:
- **project** — name from CLAUDE.md or directory name
- **plan_iters** — count of "Plan — Iteration N" checked items
- **impl_iters** — count of "Implementation — Iteration N" checked items
- **blockers_found** — count of blocking issues across all reviewer verdicts
- **reviewers_with_blockers** — which specific reviewers found blockers, e.g. "Logic,Security" or "none"
- **reviewer_verdicts** — compact summary, e.g. "Logic:APPROVE Style:APPROVE Security:WARN"
- **tests_written** — count of new test files/cases created, or "0" if none, or "skip" if no test framework
- **agents_count** — exact total number of subagents spawned during pipeline (count from pipeline-state.md progress entries, never approximate with `~`)
- **verdict** — Gate 2 result (accepted/rejected)

If `~/.claude/metrics/pipeline.md` doesn't exist, create it with the header row.

**Print metrics to console after saving:**
```
┌──────────────────────────────────────────────────────┐
│ Pipeline Metrics                                      │
├───────────────────┬──────────────────────────────────┤
│ Project           │ {project}                        │
│ Task              │ {task short description}          │
│ Complexity        │ {simple/medium/complex}           │
│ Plan Iters        │ {N}                               │
│ Impl Iters        │ {N}                               │
│ Blockers          │ {N} ({reviewers_with_blockers})   │
│ Reviewers         │ {Logic:X Style:X Security:X}      │
│ Tests Written     │ {N files / N cases / skip}         │
│ Agents Spawned    │ {N}                               │
│ Verdict           │ {accepted/rejected}               │
└───────────────────┴──────────────────────────────────┘
```

## 3. Knowledge Base Updates
If CLAUDE.md references a Knowledge Base:
- Update or create changelog entry for the work done
  - File naming: `YYYY-MM-DD-<slug>.md` — date + concise what-was-done (e.g. `2026-04-09-continent-filter.md`, `2026-03-15-auth-pages.md`)
  - Location: `changelog/{project-name}/`
- If the task was based on a spec file in `specs/`, move it to `specs/done/`
- Create ADR if an architectural choice was made

## 4. Persist Discovered Issues
If `.claude/issues-found.md` exists and is non-empty:
1. Read the issues
2. **If CLAUDE.md references a Knowledge Base** → append to `{kb_path}/tech-debt.md` under a `## {project-name}` section
3. **If no KB** → append to `docs/tech-debt.md` in the project root (create if missing)
4. Print to console: *"N issues found during this session → saved to [path]. Run `/sweep` to review and fix."*
5. Delete `.claude/issues-found.md`

If no issues found: skip silently.

## 5. Clean Working Files
- Delete all `.claude/*.md` files (plan.md, pipeline-state.md, context-doc.md, dependency-audit.md, architecture-decisions.md, plan-*.md, review files, implementation-notes*.md, issues-found.md)
- Keep only `settings.local.json` and `commands/` directory
- Delete `PLANNING.md` in project root if it exists (debug agent artifact)

Also check `~/.claude/metrics/agent-feedback.md` — if any agent has 3+ misses, remind: *"[Agent] has 3+ missed issues. Run `/agent-feedback` to review and update its definition."*

## 6. Commit Message
Generate a conventional commit message based on all changes made during this session (`git diff` against the starting state). Follow the project's commit conventions from CLAUDE.md. Print it as plain text so the user can copy it:

```
feat: short description here

Optional body explaining why, not what.
```

## 7. Summary
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
