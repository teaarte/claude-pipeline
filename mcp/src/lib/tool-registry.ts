/**
 * Canonical list of MCP tool names exposed by this server. Single source of
 * truth — server.ts registers from this list, meta.ts advertises from this
 * list, so the two can't drift (M15). The order here matches the server.ts
 * registration order for predictable meta output.
 */
export const PIPELINE_TOOLS = [
  "pipeline_init",
  "pipeline_begin_agent",
  "pipeline_state_get",
  "pipeline_record_agent_run",
  "pipeline_record_nonreview_agent",
  "pipeline_set_phase_status",
  "pipeline_set_gate",
  "pipeline_validate",
  "pipeline_finish",
  "pipeline_log_agent_feedback",
  "pipeline_get_past_misses",
  "pipeline_unlock_writes",
  "pipeline_relock_writes",
  "pipeline_abandon",
  "pipeline_cancel_spawn",
  "pipeline_run_task",
  "pipeline_continue_task",
  "pipeline_set_pattern_confidence",
  "pipeline_meta",
  "pipeline_fix_task_id",
  "pipeline_done_cleanup",
] as const;

export type PipelineToolName = (typeof PIPELINE_TOOLS)[number];
