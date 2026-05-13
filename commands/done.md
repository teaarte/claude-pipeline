# Done — Task Completion

Post-task checklist. Run all steps.

## 1. Validate code
Run validation commands from CLAUDE.md ("Validation Commands" section). Fix errors first.

## 2. Pipeline finish (MCP)
If `.claude/pipeline-state.json` exists:
1. `mcp__claude-pipeline__pipeline_validate({project_dir})` — fix any reported invariant violations before continuing. **Do NOT bypass with manual writes** — find the missing upstream call.
2. If Gate 2 was not yet recorded, ask the user for the verdict and call `pipeline_set_gate({project_dir, gate: "gate2", decision, feedback})`.
3. `mcp__claude-pipeline__pipeline_finish({project_dir, verdict: "<accepted|rejected>", project_short?, task_short?})` — appends a mechanical metrics row to `~/.claude/metrics/pipeline.jsonl`. Refuses on any invariant violation.

Print: *"Metrics row appended for task_id=<id>, verdict=<verdict>."*

If `pipeline-state.json` is missing but the session clearly used `/task` → print: *"WARNING: `/task` was invoked but `pipeline_init` was never called — metrics missing for this task."* Do **not** reconstruct manually. If the session never used `/task` (e.g. `/quick`) → skip step 2 silently.

## 3. KB updates
If CLAUDE.md references a Knowledge Base:
- Add changelog entry `changelog/{project}/{YYYY-MM-DD}-{slug}.md`. Write an ADR if an architectural choice was made.
- **Specs:** if the task closed a spec in `specs/`, move it to `specs/done/` when all phases are complete; otherwise append an `## Implementation Delta` section.
- **Backlog:** if the task fully implements a `backlog/*.md` item, move it to `backlog/done/`; otherwise update its `Status:` field.
- **Multi-project specs:** only move to done when every repo's work is complete.

## 4. Persist discovered issues
If `.claude/issues-found.md` is non-empty: append to `{kb}/tech-debt.md` (or `docs/tech-debt.md` if no KB) under `## {project}`, delete the source, print *"N issues → saved to <path>. Run `/sweep`."* Otherwise skip silently.

## 5. Clean working files
Delete every file the orchestrator wrote under `.claude/`: `plan.md`, `pipeline-state.json`, `pipeline-state-summary.md`, `context-doc.md`, `analyzer-claims.json`, `dependency-audit.md`, `architecture-decisions.md`, `research-report.md`, `migration-plan.md`, `plan-*.md`, `implementation-notes*.md`, `diff.txt`, `caller-context.md`, `antipattern-candidates.md`, `past-misses-*.md`, `refs-to-load.md`, `findings.jsonl`, `test-files-must-stay-green.json`, `reviews/`. Keep `settings.local.json` and `commands/`. Delete `PLANNING.md` from the project root if present.

Scan `~/.claude/metrics/agent-feedback.jsonl` — if any agent has 3+ confirmed misses on the same `pattern_to_look_for`, remind: *"[Agent] has 3+ confirmed misses on '[pattern]'. Run `/learn`."*

## 6. Commit message
Generate a conventional commit message from `git diff` against the starting state. Follow CLAUDE.md commit conventions. Print as plain text:

```
feat: short description

Optional body explaining why, not what.
```

## 7. Summary
```
┌─────────────────────────────────────────────────────┐
│ Task Complete                                        │
├──────────────┬──────────────────────────────────────┤
│ Validation   │ {pass/fail}                           │
│ Metrics      │ {appended (task_id) / skipped}        │
│ KB Updated   │ {files list / skipped}                │
│ Cleaned      │ {N files removed}                     │
└──────────────┴──────────────────────────────────────┘
```
