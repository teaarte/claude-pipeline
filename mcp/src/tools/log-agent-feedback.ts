import { z } from "zod";
import { agentFeedbackJsonl } from "../lib/paths.js";
import { appendJsonl } from "../lib/state-io.js";
import { validate } from "../lib/schemas.js";
import { makeFeedbackId } from "../lib/ids.js";

export const logAgentFeedbackSchema = {
  agent: z.enum([
    "logic-reviewer",
    "challenger-reviewer",
    "style-reviewer",
    "security",
    "performance",
    "acceptance",
    "plan-conformance",
    "plan-grounding-check",
    "context-doc-verifier",
    "ui-consistency",
    "api-contract",
    "playwright",
    "test",
    "implementer",
  ]),
  category: z.string().describe("Category from category-vocab.json or 'other'"),
  pattern_to_look_for: z.string().max(200).describe("Grep-friendly pattern reviewers should hunt"),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  found_by: z
    .enum(["prod-incident", "human-review", "another-agent", "test", "other"])
    .default("human-review"),
  human_confirmed: z.boolean().default(true),
  task_id: z.string().nullable().optional(),
  proposed_new_category: z.string().max(60).optional(),
  missed_issue_summary: z.string().max(300).optional(),
  example_file_line: z.string().nullable().optional(),
  action_taken: z.enum(["vocab-added", "agent-prompt-updated", "logged-only"]).nullable().optional(),
};

export async function pipelineLogAgentFeedback(input: any): Promise<any> {
  const today = new Date();
  const entry: Record<string, unknown> = {
    schema_version: "1.0",
    feedback_id: makeFeedbackId(today),
    date: today.toISOString().slice(0, 10),
    agent: input.agent,
    category: input.category,
    pattern_to_look_for: input.pattern_to_look_for,
    severity: input.severity ?? "medium",
    found_by: input.found_by ?? "human-review",
    human_confirmed: input.human_confirmed ?? true,
  };
  if (input.task_id !== undefined) entry.task_id = input.task_id;
  if (input.proposed_new_category !== undefined) entry.proposed_new_category = input.proposed_new_category;
  if (input.missed_issue_summary !== undefined) entry.missed_issue_summary = input.missed_issue_summary;
  if (input.example_file_line !== undefined) entry.example_file_line = input.example_file_line;
  if (input.action_taken !== undefined) entry.action_taken = input.action_taken;

  const check = await validate("agent-feedback.schema.json", entry);
  if (!check.ok) {
    throw new Error(
      `agent-feedback entry failed schema validation:\n${check.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`,
    );
  }
  await appendJsonl(agentFeedbackJsonl, entry);
  return { written: true, file: agentFeedbackJsonl, entry };
}
