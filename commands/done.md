---
mcp_protocol_required: "^2.0"
---

# /done — task completion (≤30 lines)

1. Run validation commands from CLAUDE.md. Fix errors first.
2. If `.claude/pipeline-state.json` exists: `pipeline_validate({project_dir})` → fix any violations (see Recovery below). Then `pipeline_set_gate({gate:"gate2",...})` if not yet recorded, then `pipeline_finish({project_dir, verdict, project_short?, task_short?})`. Print *"Metrics appended for task_id=<id>."*
3. KB: changelog entry `changelog/{project}/{date}-{slug}.md`; move closed `specs/` to `specs/done/`; move done `backlog/` items to `backlog/done/`.
4. If `.claude/issues-found.md` non-empty → append to `{kb}/tech-debt.md` under `## {project}`, delete source, print *"Run /sweep."*
5. Clean `.claude/`: call `pipeline_done_cleanup({project_dir})`. It deletes every orchestrator working file server-side in deterministic order (mcp-audit.jsonl LAST so it isn't regenerated) and preserves `settings.local.json`. No unlock/relock dance needed — MCP-internal IO bypasses the guard hook by design. Delete root `PLANNING.md` if present.
6. Scan `~/.claude/metrics/agent-feedback.jsonl`; if any agent has 3+ confirmed misses on the same `pattern_to_look_for`, remind *"Run /learn."*
7. Generate a Conventional Commits message from `git diff` against the start state.

## Recovery — try A first; B when state is fine but a guard is over-strict; C when state is hopeless.

**A. Fix upstream** — `INV_001` spawn an agent or skip phase with `force=true`; `INV_002` record an agent or skip with reason; `INV_003` re-call with a valid `skipped_reason`; `INV_004` state out of sync → `pipeline_abandon`; `INV_005` complete planning first; `INV_006` complete impl+validation; `INV_007` complete or skip the named phase; `INV_008` hand-fix the bad `findings.jsonl` line via `pipeline_unlock_writes`/`pipeline_relock_writes`; `INV_009` revert or human-approve at gate2 with `"approves sacred-test modification: <path>"`; `INV_010` don't reopen closed phases (or `force=true`); `INV_011` walk context→planning→test_first→implementation→validation→final; `INV_012` `pipeline_record_*` or `pipeline_cancel_spawn` for stuck spawns; `INV_SCHEMA_STATE` on `task_id` → `pipeline_fix_task_id({project_dir, new_task_id: "<sanitized>", reason})` (no unlock dance, no JSON hack); `stale-spawn` record or cancel, or `pipeline_finish({force:true})`.

**B. Force-close** — `force:true` on `set_phase_status` / `finish` records `pipeline_violation` and audits.

**C. Abandon** — `pipeline_abandon({project_dir, reason})` moves state to `abandoned-<ts>.json`. No metrics row.
