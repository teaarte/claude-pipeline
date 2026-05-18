---
mcp_protocol_required: "^2.0"
---

# /done — task completion (≤30 lines)

> **Bundle resolution:** read `<project>/.claude/pipeline.config.json` if
> present; default `bundle: "code"`. Execute the steps in
> `mcp/src/driver/bundles/<bundle>/done-prompt.md` for the bundle's
> domain-specific completion flow. Recovery rules below are universal —
> they apply to every bundle's pipeline-state schema.

## Recovery — try A first; B when state is fine but a guard is over-strict; C when state is hopeless.

**A. Fix upstream** — `INV_001` spawn an agent or skip phase with `force=true`; `INV_002` record an agent or skip with reason; `INV_003` re-call with a valid `skipped_reason`; `INV_004` state out of sync → `pipeline_abandon`; `INV_005` complete planning first; `INV_006` complete impl+validation; `INV_007` complete or skip the named phase; `INV_008` hand-fix the bad `findings.jsonl` line via `pipeline_unlock_writes`/`pipeline_relock_writes`; `INV_009` revert or human-approve at gate2 with `"approves sacred-test modification: <path>"`; `INV_010` don't reopen closed phases (or `force=true`); `INV_011` walk the bundle's declared phase ordering in `flow.phases[]`; `INV_012` `pipeline_record_*` or `pipeline_cancel_spawn` for stuck spawns; `INV_SCHEMA_STATE` on `task_id` → `pipeline_fix_task_id({project_dir, new_task_id: "<sanitized>", reason})` (no unlock dance, no JSON hack); `stale-spawn` record or cancel, or `pipeline_finish({force:true})`.

**B. Force-close** — `force:true` on `set_phase_status` / `finish` records `pipeline_violation` and audits.

**C. Abandon** — `pipeline_abandon({project_dir, reason})` moves state to `abandoned-<ts>.json`. No metrics row.
