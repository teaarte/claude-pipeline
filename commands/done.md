# Done — Task Completion

Post-task checklist. Run through all steps.

---

## 1. Validate
Run validation commands from CLAUDE.md (look for "Validation Commands" section). Fix any errors before proceeding.

## 2. Pipeline Metrics (mechanical, no LLM call)
If `.claude/pipeline-state.json` exists (task was run via `/task`), build the metrics line by **JSON-to-JSON transform** and append to `~/.claude/metrics/pipeline.jsonl` (append-only, one JSON object per line).

Do NOT spawn an agent. Pure programmatic transform from state schema → metrics-line schema. LLM is used only for commit-message generation in step 6.

If `.claude/pipeline-state.json` does NOT exist but the session clearly used `/task`, this is a **pipeline violation** — the Orchestrator forgot to initialize it. In this case:
1. Print warning: *"WARNING: `/task` was invoked but `pipeline-state.json` was never created. This is a pipeline bug — metrics are incomplete. Reconstructing from conversation history."*
2. Reconstruct metrics manually from the conversation and save them.
3. Set `pipeline_violation: "missing-state-file"` in the JSONL row.

Metrics line schema (per row in `pipeline.jsonl`):

```jsonl
{
  "schema_version": "1.0",
  "date": "<YYYY-MM-DD from started_at>",
  "task_id": "<from state>",
  "project": "<from CLAUDE.md or directory name>",
  "task_short": "<task description first ~50 chars>",
  "complexity": "<state.complexity>",
  "plan_iters": <state.phases.planning.iterations>,
  "gate1_revisions": <state.phases.planning.gate1_revisions>,
  "impl_iters": <state.phases.implementation.iterations>,
  "blockers_found": <state.blockers_found>,
  "reviewers_with_blockers": [<agent>, ...],
  "reviewer_verdicts": [{"agent": "<>", "verdict": "<>", "blocking_issues": <n>}, ...],
  "reviewer_disagreements": <0|1 — 1 if state.phases.implementation.logic_vs_challenger_disagreement>,
  "plan_drift": {"verdict": "<CONFORMS|DRIFT|PARTIAL|null>", "drift_files": <state.phases.implementation.drift_files_count>},
  "acceptance_first_pass": <state.phases.validation.acceptance_first_pass>,
  "grounding_mismatches": <state.phases.planning.grounding_mismatches>,
  "tests_written": <state.tests_written>,
  "agents_count": <state.agents_count>,
  "reviewer_misses_post_merge": 0,
  "verdict": "<state.verdict>",
  "categories_seen": ["<distinct category from .claude/findings.jsonl>", ...]
}
```

Build from pipeline-state.json:
- **project** — name from CLAUDE.md or directory name
- **plan_iters** — count of "Plan — Iteration N" checked items (planner re-spawns including grounding-check-driven revisions)
- **gate1_revisions** — value of `gate1_revisions:` in pipeline-state (human-driven rewrites at Gate 1, distinct from automated plan iterations)
- **impl_iters** — count of "Implementation — Iteration N" checked items
- **blockers_found** — count of blocking issues across all reviewer verdicts
- **reviewers_with_blockers** — which specific reviewers found blockers, e.g. "Logic,Security" or "none"
- **reviewer_verdicts** — compact summary, e.g. "Logic:APPROVE Challenger:REQUEST_CHANGES Style:APPROVE Security:WARN"
- **reviewer_disagreements** — Logic vs Challenger disagreement count this run (0 if both agreed or Challenger didn't run)
- **plan_drift** — Plan Conformance verdict + drift file count, e.g. "CONFORMS:0", "DRIFT:2", "PARTIAL:1". "n/a" if conformance step skipped.
- **acceptance_first_pass** — `yes` if Acceptance Agent passed without any STEP 6/STEP 7 re-iteration after the first impl, otherwise `no`. Read from pipeline-state.
- **grounding_mismatches** — total mismatches from Plan Grounding Check across all plan iterations (0 if check skipped or always GROUNDED)
- **tests_written** — count of new test files/cases created, or "0" if none, or "skip" if no test framework
- **agents_count** — exact total number of subagents spawned during pipeline (count from pipeline-state.json progress entries, never approximate with `~`)
- **reviewer_misses_post_merge** — set to 0 at write time. `/agent-feedback` increments this for the relevant past row when a miss is logged later (so the column reflects post-hoc accuracy).
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
│ Gate1 Revisions   │ {N}                               │
│ Grounding Misses  │ {N}                               │
│ Impl Iters        │ {N}                               │
│ Blockers          │ {N} ({reviewers_with_blockers})   │
│ Reviewers         │ {Logic:X Challenger:X Style:X ...}│
│ Disagreements     │ {N}                               │
│ Plan Drift        │ {CONFORMS:0 / DRIFT:N / ...}      │
│ Acceptance 1st    │ {yes/no}                          │
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
- Create ADR if an architectural choice was made

### Spec & Backlog Completion Check
After updating the changelog, check if the completed task was the **last remaining phase/item** in a spec or backlog document:

1. **Specs (`specs/*.md`):** If the task was based on a spec file, read it and check its acceptance criteria / phases:
   - If ALL phases/criteria are now complete → move to `specs/done/`
   - If some phases remain → leave in `specs/`, but append an `## Implementation Delta` section (if not already present) noting what was completed and any deviations
   - Print: *"Spec {filename}: {N}/{total} phases complete → {moved to done / stays active}"*

2. **Backlog (`backlog/*.md`):** Scan `backlog/*.md` files — if any item's described work is now fully implemented (cross-reference with changelogs and the current task), move it to `backlog/done/`:
   - Read each backlog item's status/description
   - If the work described is complete → `mv backlog/{file} backlog/done/{file}`
   - If partially done → update its `Status:` field to reflect progress (e.g. `Status: backend-done`, `Status: Phase 1 done`)
   - Print: *"Backlog: {filename} → {moved to done / updated status / no change}"*

3. **Multi-project specs:** If a spec covers multiple repos (e.g. wandr-be + wandr-fe), only move to done when ALL repos' work is complete. If only one side is done, update the spec with a status note instead.

## 4. Persist Discovered Issues
If `.claude/issues-found.md` exists and is non-empty:
1. Read the issues
2. **If CLAUDE.md references a Knowledge Base** → append to `{kb_path}/tech-debt.md` under a `## {project-name}` section
3. **If no KB** → append to `docs/tech-debt.md` in the project root (create if missing)
4. Print to console: *"N issues found during this session → saved to [path]. Run `/sweep` to review and fix."*
5. Delete `.claude/issues-found.md`

If no issues found: skip silently.

## 5. Clean Working Files
- Delete all `.claude/*.md`, `.claude/*.json`, `.claude/*.jsonl`, `.claude/*.txt` files: plan.md, pipeline-state.json, pipeline-state-summary.md, context-doc.md, analyzer-claims.json, dependency-audit.md, architecture-decisions.md, research-report.md, migration-plan.md, plan-*.md, implementation-notes*.md, issues-found.jsonl, diff.txt, caller-context.md, antipattern-candidates.md, past-misses-*.md, refs-to-load.md, findings.jsonl, reviews/ directory
- Keep only `settings.local.json` and `commands/` directory
- Delete `PLANNING.md` in project root if it exists (debug agent artifact)

Also scan `~/.claude/metrics/agent-feedback.jsonl` — if any agent has 3+ confirmed misses on the same `pattern_to_look_for`, remind: *"[Agent] has 3+ confirmed misses on '[pattern]'. Run `/learn` for clustering and prompt-update suggestions."*

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
