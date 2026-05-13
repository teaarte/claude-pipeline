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

async function main() {
  const server = new McpServer({
    name: "claude-pipeline",
    version: "0.1.0",
  });

  server.tool(
    "pipeline_init",
    "Initialize .claude/pipeline-state.json + findings.jsonl + summary.md for a new task. Refuses to overwrite if a finished task is present.",
    initSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineInit(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_state_get",
    "Read the current .claude/pipeline-state.json. Returns {exists, state?}.",
    stateGetSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineStateGet(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_record_agent_run",
    "Parse a reviewer/validator agent's fenced ```json header, validate against schemas, append findings to .claude/findings.jsonl, append reviewer_verdicts entry, increment agents_count, rebuild summary.",
    recordAgentRunSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineRecordAgentRun(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_record_nonreview_agent",
    "Record a non-reviewer agent (planner, implementer, architect, code-analyzer, dependency-auditor, research, migration). Adds the agent to phases[phase].agents and bumps agents_count.",
    recordNonreviewSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineRecordNonreviewAgent(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_set_phase_status",
    "Update phases[phase].status. Rejects status='completed' when agents[] is empty unless force=true (records pipeline_violation). Requires skipped_reason when status='skipped' for test_first/context.",
    setPhaseStatusSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineSetPhaseStatus(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_set_gate",
    "Update gates.gate0/1/2 and optional feedback. Used after human approval/rejection at Gate 0/1/2.",
    setGateSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineSetGate(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_validate",
    "Run all coherence invariants against the current pipeline-state + findings.jsonl. Returns {ok, violations[]}.",
    validateSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineValidate(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_finish",
    "Set verdict (accepted|rejected), run invariants, and on success append a metrics row to ~/.claude/metrics/pipeline.jsonl. Refuses on any violation.",
    finishSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineFinish(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_log_agent_feedback",
    "Append a human-confirmed missed-issue entry to ~/.claude/metrics/agent-feedback.jsonl. Used by /agent-feedback.",
    logAgentFeedbackSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineLogAgentFeedback(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  server.tool(
    "pipeline_get_past_misses",
    "Read the last N human-confirmed entries for a given agent from ~/.claude/metrics/agent-feedback.jsonl. Used at pipeline start (rule #15) to build .claude/past-misses-{agent}.md.",
    getPastMissesSchema,
    async (args) => {
      try {
        return toolResponse(await pipelineGetPastMisses(args));
      } catch (e) {
        return errorResponse(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Use stderr — stdout is reserved for MCP protocol frames.
  console.error("[claude-pipeline-mcp] fatal:", err);
  process.exit(1);
});
