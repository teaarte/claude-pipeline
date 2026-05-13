import { z } from "zod";
import { stateFile } from "../lib/paths.js";
import { readStateSafe } from "../lib/state-io.js";

export const stateGetSchema = {
  project_dir: z.string(),
};

export async function pipelineStateGet(input: { project_dir: string }): Promise<any> {
  const file = stateFile(input.project_dir);
  const state = await readStateSafe(file);
  if (!state) {
    return { exists: false };
  }
  return { exists: true, state };
}
