import { z } from "zod";
import { PLUGIN_API_VERSION } from "../driver/types/plugin.js";

export const PROTOCOL_VERSION = "2.0";

export const metaSchema = {};

const TOOLS = [
  "pipeline_init",
  "pipeline_state_get",
  "pipeline_begin_agent",
  "pipeline_record_agent_run",
  "pipeline_record_nonreview_agent",
  "pipeline_set_phase_status",
  "pipeline_set_gate",
  "pipeline_validate",
  "pipeline_finish",
  "pipeline_log_agent_feedback",
  "pipeline_get_past_misses",
  "pipeline_set_pattern_confidence",
  "pipeline_unlock_writes",
  "pipeline_relock_writes",
  "pipeline_abandon",
  "pipeline_cancel_spawn",
  "pipeline_run_task",
  "pipeline_continue_task",
  "pipeline_meta",
  "pipeline_fix_task_id",
  "pipeline_done_cleanup",
];

export async function pipelineMeta(_input: Record<string, never>): Promise<{
  protocol_version: string;
  plugin_api_version: string;
  schema_versions: Record<string, string>;
  tools: string[];
}> {
  return {
    protocol_version: PROTOCOL_VERSION,
    plugin_api_version: PLUGIN_API_VERSION,
    schema_versions: {
      "pipeline-state": "1.0",
      "finding": "1.0",
      "reviewer-output": "1.0",
      "validator-output": "1.0",
      "agent-feedback": "1.0",
    },
    tools: TOOLS,
  };
}
