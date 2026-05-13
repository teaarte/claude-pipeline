import { z } from "zod";
import { agentFeedbackJsonl } from "../lib/paths.js";
import { readJsonl } from "../lib/state-io.js";

export const getPastMissesSchema = {
  agent: z.string().describe("Agent name to filter on, e.g. 'logic-reviewer'"),
  top_n: z.number().int().min(1).max(50).default(10),
  human_confirmed_only: z.boolean().default(true),
};

export async function pipelineGetPastMisses(input: {
  agent: string;
  top_n?: number;
  human_confirmed_only?: boolean;
}): Promise<any> {
  const all = await readJsonl(agentFeedbackJsonl);
  const filtered = all.filter((e) => {
    if (e.agent !== input.agent) return false;
    if ((input.human_confirmed_only ?? true) && !e.human_confirmed) return false;
    return true;
  });
  // last N chronologically (entries are append-only so last == most recent)
  const limit = input.top_n ?? 10;
  const recent = filtered.slice(-limit);
  return {
    agent: input.agent,
    count: recent.length,
    entries: recent,
  };
}
