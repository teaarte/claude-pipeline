import { z } from "zod";
import { stateFile, summaryFile } from "../lib/paths.js";
import { withStateLock, writeText } from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";

const VALID_GATES = ["gate0", "gate1", "gate2"] as const;
const VALID_STATUS = ["pending", "approved", "rejected", "skipped"] as const;

export const setGateSchema = {
  project_dir: z.string(),
  gate: z.enum(VALID_GATES),
  status: z.enum(VALID_STATUS),
  feedback: z.string().nullable().optional(),
};

export async function pipelineSetGate(input: {
  project_dir: string;
  gate: (typeof VALID_GATES)[number];
  status: (typeof VALID_STATUS)[number];
  feedback?: string | null;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  return withStateLock(file, async (state) => {
    if (!state) throw new Error(`pipeline-state.json not found at ${file}`);
    state.gates = state.gates ?? { gate0: "pending", gate1: "pending", gate2: "pending" };
    state.gates[input.gate] = input.status;
    if (input.gate === "gate1" && input.feedback !== undefined) {
      state.gates.gate1_feedback = input.feedback;
    }
    if (input.gate === "gate2" && input.feedback !== undefined) {
      state.gates.gate2_feedback = input.feedback;
    }
    // Q47 + Q48 (item 11): persist gate revision counters on pipeline-state
    // so the finish.ts metrics row can read them without crossing into
    // driver-state. Each rejected gate bumps the corresponding counter on
    // the gate's owning phase.
    if (input.status === "rejected") {
      if (input.gate === "gate1") {
        state.phases = state.phases ?? {};
        state.phases.planning = state.phases.planning ?? { status: "pending" };
        state.phases.planning.gate1_revisions =
          (state.phases.planning.gate1_revisions ?? 0) + 1;
      } else if (input.gate === "gate2") {
        state.phases = state.phases ?? {};
        state.phases.implementation = state.phases.implementation ?? { status: "pending" };
        state.phases.implementation.gate2_revisions =
          (state.phases.implementation.gate2_revisions ?? 0) + 1;
      }
    }

    await writeText(summary, await buildSummary(state));

    return {
      state,
      result: { gate: input.gate, status: input.status },
    };
  });
}
