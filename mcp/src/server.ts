#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { pipelineInit, initSchema } from "./tools/init.js";
import { pipelineStateGet, stateGetSchema } from "./tools/state-get.js";
import { pipelineRecordAgentRun, recordAgentRunSchema } from "./tools/record-agent-run.js";
import { pipelineRecordNonreviewAgent, recordNonreviewSchema } from "./tools/record-nonreview-agent.js";
import { pipelineSetPhaseStatus, setPhaseStatusSchema } from "./tools/set-phase-status.js";
import { pipelineSetGate, setGateSchema } from "./tools/set-gate.js";
import { pipelineValidate, validateSchema } from "./tools/validate.js";
import { pipelineFinish, finishSchema } from "./tools/finish.js";
import { pipelineLogAgentFeedback, logAgentFeedbackSchema } from "./tools/log-agent-feedback.js";
import { pipelineGetPastMisses, getPastMissesSchema } from "./tools/get-past-misses.js";
import { pipelineBeginAgent, beginAgentSchema } from "./tools/begin-agent.js";
import {
  pipelineUnlockWrites,
  unlockWritesSchema,
  pipelineRelockWrites,
  relockWritesSchema,
} from "./tools/unlock-writes.js";
import { withAudit } from "./lib/audit.js";

function toolResponse(value: unknown): { content: { type: "text"; text: string }[] } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResponse(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: msg }],
    isError: true,
  };
}

type ToolImpl<I, O> = (args: I) => Promise<O>;

function register<I, O>(
  server: McpServer,
  name: string,
  desc: string,
  schema: any,
  impl: ToolImpl<I, O>,
): void {
  const wrapped = withAudit(name, impl);
  server.tool(name, desc, schema, async (args: any) => {
    try {
      return toolResponse(await wrapped(args));
    } catch (e) {
      return errorResponse(e);
    }
  });
}

async function main() {
  const server = new McpServer({
    name: "claude-pipeline",
    version: "0.1.0",
  });

  register(server, "pipeline_init", "Initialize .claude/pipeline-state.json + findings.jsonl + summary.md for a new task. Refuses to overwrite if a finished task is present.", initSchema, pipelineInit);
  register(server, "pipeline_begin_agent", "Reserve an agent_run_id and append an open_spawn entry to the given phase. Must be called BEFORE the agent is spawned; the returned agent_run_id is required by pipeline_record_agent_run / pipeline_record_nonreview_agent.", beginAgentSchema, pipelineBeginAgent);
  register(server, "pipeline_state_get", "Read the current .claude/pipeline-state.json. Returns {exists, state?}.", stateGetSchema, pipelineStateGet);
  register(server, "pipeline_record_agent_run", "Parse a reviewer/validator agent's fenced ```json header, validate against schemas, append findings to .claude/findings.jsonl, append reviewer_verdicts entry, increment agents_count, rebuild summary.", recordAgentRunSchema, pipelineRecordAgentRun);
  register(server, "pipeline_record_nonreview_agent", "Record a non-reviewer agent (planner, implementer, architect, code-analyzer, dependency-auditor, research, migration). Adds the agent to phases[phase].agents and bumps agents_count.", recordNonreviewSchema, pipelineRecordNonreviewAgent);
  register(server, "pipeline_set_phase_status", "Update phases[phase].status. Rejects status='completed' when agents[] is empty unless force=true (records pipeline_violation). Requires skipped_reason when status='skipped' for test_first/context.", setPhaseStatusSchema, pipelineSetPhaseStatus);
  register(server, "pipeline_set_gate", "Update gates.gate0/1/2 and optional feedback. Used after human approval/rejection at Gate 0/1/2.", setGateSchema, pipelineSetGate);
  register(server, "pipeline_validate", "Run all coherence invariants against the current pipeline-state + findings.jsonl. Returns {ok, violations[]}.", validateSchema, pipelineValidate);
  register(server, "pipeline_finish", "Set verdict (accepted|rejected), run invariants, and on success append a metrics row to ~/.claude/metrics/pipeline.jsonl. Refuses on any violation.", finishSchema, pipelineFinish);
  register(server, "pipeline_log_agent_feedback", "Append a human-confirmed missed-issue entry to ~/.claude/metrics/agent-feedback.jsonl. Used by /agent-feedback.", logAgentFeedbackSchema, pipelineLogAgentFeedback);
  register(server, "pipeline_get_past_misses", "Read the last N human-confirmed entries for a given agent from ~/.claude/metrics/agent-feedback.jsonl. Used at pipeline start (rule #15) to build .claude/past-misses-{agent}.md.", getPastMissesSchema, pipelineGetPastMisses);
  register(server, "pipeline_unlock_writes", "Temporarily allow direct writes to MCP-managed files for the given project. Creates <project>/.claude/.mcp-bypass-allowed with an expires_at timestamp. Default TTL 300s, max 3600s. Required reason logged in audit. Honored by hooks/pipeline-guard.sh.", unlockWritesSchema, pipelineUnlockWrites);
  register(server, "pipeline_relock_writes", "Remove the bypass marker, immediately restoring guard enforcement. Idempotent.", relockWritesSchema, pipelineRelockWrites);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Use stderr — stdout is reserved for MCP protocol frames.
  console.error("[claude-pipeline-mcp] fatal:", err);
  process.exit(1);
});
