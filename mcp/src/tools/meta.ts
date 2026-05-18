import { PLUGIN_API_VERSION } from "../driver/types/plugin.js";
import { PIPELINE_TOOLS } from "../lib/tool-registry.js";

export const PROTOCOL_VERSION = "2.0";

export const metaSchema = {};

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
      "pipeline-state": "1.1",
      "finding": "1.0",
      "reviewer-output": "1.0",
      "validator-output": "1.0",
      "agent-feedback": "1.0",
    },
    tools: [...PIPELINE_TOOLS],
  };
}
