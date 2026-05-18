# Code bundle — `/done` flow steps

The code-bundle-specific steps in `commands/done.md`. Future bundles ship
their own `done-prompt.md` with domain-specific completion checks.

## Steps (executed in order; stop on first failure)

1. **Validation gate.** Run validation commands from CLAUDE.md
   (typecheck + test + lint). Fix any errors before continuing.

2. **Pipeline validate + finish.** If `.claude/pipeline-state.json` exists:
   - `pipeline_validate({project_dir})` → fix any violations (see Recovery
     section in `commands/done.md`).
   - `pipeline_set_gate({gate:"gate2", ...})` if not already recorded.
   - `pipeline_finish({project_dir, verdict, project_short?, task_short?})`.
   - Print `"Metrics appended for task_id=<id>."`.

3. **Knowledge-base sync.** Changelog entry under
   `changelog/{project}/{date}-{slug}.md`; move closed specs into
   `specs/done/`; move done backlog items into `backlog/done/`.

4. **Tech-debt promotion.** If `.claude/issues-found.md` is non-empty:
   append to `{kb}/tech-debt.md` under `## {project}`, delete the source
   file, print *"Run /sweep."*.

5. **Working-file cleanup.** `pipeline_done_cleanup({project_dir})` removes
   every orchestrator working file in deterministic order
   (mcp-audit.jsonl LAST). Preserves `settings.local.json`. Delete root
   `PLANNING.md` if present.

6. **Recurrence radar.** Scan `~/.claude/metrics/agent-feedback.jsonl`.
   If any agent has 3+ confirmed misses on the same `pattern_to_look_for`,
   remind *"Run /learn."*.

7. **Commit message.** Generate a Conventional Commits message from
   `git diff` against the start state (or hand back diff to user if
   commit is theirs to write).

## Bundle-specific assumptions

- CLAUDE.md format (validation commands, anti-pattern rules) is the
  code-bundle's convention. Other bundles will document their own
  "project conventions" file shape.
- Conventional Commits is code-bundle convention; future bundles may emit
  different commit shapes (e.g. content bundle → "publish" / "draft" /
  "schedule" tags).
- `<kb>/tech-debt.md` flow assumes the project has an Obsidian-style
  knowledge base. Bundles without a KB skip this step.
