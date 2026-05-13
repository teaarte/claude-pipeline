# Done — Task Completion

Post-task checklist. Run all steps.

## 1. Validate code
Run validation commands from CLAUDE.md ("Validation Commands" section). Fix errors first.

## 2. Pipeline finish (MCP)
If `.claude/pipeline-state.json` exists:
1. `mcp__claude-pipeline__pipeline_validate({project_dir})` — fix any reported invariant violations before continuing. **Do NOT bypass with manual writes** — find the missing upstream call. If you're stuck, see Recovery section below.
2. If Gate 2 was not yet recorded, ask the user for the verdict and call `pipeline_set_gate({project_dir, gate: "gate2", decision, feedback})`.
3. `mcp__claude-pipeline__pipeline_finish({project_dir, verdict: "<accepted|rejected>", project_short?, task_short?})` — appends a mechanical metrics row to `~/.claude/metrics/pipeline.jsonl`. Refuses on any invariant violation.

Print: *"Metrics row appended for task_id=<id>, verdict=<verdict>."*

If `pipeline-state.json` is missing but the session clearly used `/task` → print: *"WARNING: `/task` was invoked but `pipeline_init` was never called — metrics missing for this task."* Do **not** reconstruct manually. If the session never used `/task` (e.g. `/quick`) → skip step 2 silently.

### Recovery — when `pipeline_validate` or `pipeline_finish` refuses

Three escalating responses. Always try **A** first.

**A. Fix upstream (preferred).** Most violations have a precise upstream cause; the fix is to make the call you skipped.

| Code | Root cause | Fix |
|------|------------|-----|
| `INV_001` | medium/complex run finished with `agents_count=0` | You didn't run any agents. Spawn at least one before `pipeline_finish`. If the task truly needed none, run `pipeline_set_phase_status({phase, status:"skipped", skipped_reason})` with `force=true`. |
| `INV_002` | phase set to `completed` with empty `agents[]` | Record at least one agent via `pipeline_record_agent_run` / `pipeline_record_nonreview_agent`, or skip the phase with a reason. |
| `INV_003` | `skipped` phase missing `skipped_reason` | Re-call `pipeline_set_phase_status` with a valid reason from the schema (test_first only). |
| `INV_004` | `reviewer_verdicts > agents_count` | State got out of sync — usually means you called `pipeline_record_agent_run` directly into JSONL. Inspect and use `pipeline_abandon` if mismatched. |
| `INV_005` | `gate1=approved` but planning not done | Run `pipeline_set_phase_status({phase:"planning", status:"completed"})` first. |
| `INV_006` | `gate2=approved` but implementation/validation not done | Complete those phases first. |
| `INV_007` | `verdict` set but a required phase is pending | Complete or skip the named phase. |
| `INV_008` | bad line in `findings.jsonl` | The schema-version field is wrong or a category is invalid. Hand-fix the bad line (use `pipeline_unlock_writes` to authorize, then `pipeline_relock_writes`). |
| `INV_009` | implementer modified a sacred test file | Either revert the test file, or get human approval at gate2 with the verbatim string `"approves sacred-test modification: <path>"`. |
| `INV_010` | invalid status transition (e.g. completed → in_progress) | Don't reopen closed phases. If you must, pass `force:true` (records `pipeline_violation`). |
| `INV_011` | prereq phase not completed/skipped | Walk the phase chain: context → planning → test_first → implementation → validation → final. |
| `INV_012` | phase has open spawns | Each `pipeline_begin_agent` must be paired with `pipeline_record_*` OR `pipeline_cancel_spawn`. Use `pipeline_cancel_spawn({phase, agent_run_id, reason})` for stuck spawns. |
| `stale-spawn` | open spawn older than 30 min | Same fix — record the agent if it completed, or cancel it. `pipeline_finish({force:true})` bypasses with `pipeline_violation`. |

**B. Force-close.** When you've decided the violation is acceptable: pass `force:true` to `pipeline_set_phase_status` or `pipeline_finish`. The bypass is recorded in `state.pipeline_violation` and the audit log. Use this when the underlying state is fine but a guard is over-strict (e.g. legitimate test_first skip with no_framework reason).

**C. Abandon.** When state is hopeless (mid-pipeline rebase, corrupted, contradictory): `pipeline_abandon({project_dir, reason})` moves `pipeline-state.json` to `abandoned-<ts>.json`. No metrics row is written. Start fresh with `pipeline_init` afterwards. Findings and summary stay in place for post-mortem.

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
