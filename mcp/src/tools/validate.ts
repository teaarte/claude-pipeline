import { z } from "zod";
import { stateFile, findingsFile } from "../lib/paths.js";
import { readStateSafe } from "../lib/state-io.js";
import { runInvariants } from "../lib/invariants.js";

export const validateSchema = {
  project_dir: z.string(),
};

export async function pipelineValidate(input: { project_dir: string }): Promise<any> {
  const file = stateFile(input.project_dir);
  const fjsonl = findingsFile(input.project_dir);
  const state = await readStateSafe(file);
  if (!state) return { ok: false, violations: [{ code: "INV_NO_STATE", message: "pipeline-state.json not found" }] };
  const violations = await runInvariants(state, fjsonl);
  return { ok: violations.length === 0, violations };
}
