import { readFile } from "node:fs/promises";
import { z } from "zod";
import { join } from "node:path";
import { templatesDir } from "../lib/paths.js";
import { stateFile, findingsFile, summaryFile } from "../lib/paths.js";
import {
  withStateLock,
  ensureEmptyJsonl,
  writeText,
} from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";

export const initSchema = {
  project_dir: z.string().describe("Absolute path to the project root (contains .claude/)"),
  task: z.string().describe("One-line task description"),
  task_id: z
    .string()
    .regex(/^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}$/)
    .describe("t-YYYY-MM-DD-slug (lowercase, 4+ char slug)"),
  complexity: z.enum(["simple", "medium", "complex"]),
  tests_mode: z.enum(["tdd", "regression-only"]),
  stack: z
    .object({
      language: z.string(),
      package_manager: z.string().nullable().optional(),
      test_command: z.string().nullable().optional(),
      lint_command: z.string().nullable().optional(),
      build_command: z.string().nullable().optional(),
      project_type: z.enum(["frontend-app", "backend", "library"]).nullable().optional(),
    })
    .describe("Stack info — passes verbatim into pipeline-state.json"),
};

export async function pipelineInit(input: {
  project_dir: string;
  task: string;
  task_id: string;
  complexity: "simple" | "medium" | "complex";
  tests_mode: "tdd" | "regression-only";
  stack: any;
}): Promise<any> {
  const file = stateFile(input.project_dir);
  const fjsonl = findingsFile(input.project_dir);
  const summary = summaryFile(input.project_dir);

  const tplPath = join(templatesDir, "pipeline-state.json");
  const tpl = JSON.parse(await readFile(tplPath, "utf8"));

  return withStateLock(file, async (existing) => {
    if (existing && existing.verdict != null) {
      throw new Error(
        `pipeline-state.json already exists with verdict='${existing.verdict}'. Refusing to overwrite. Reset .claude/ manually first.`,
      );
    }
    const now = new Date().toISOString();
    const state = {
      ...tpl,
      task_id: input.task_id,
      task: input.task,
      complexity: input.complexity,
      tests_mode: input.tests_mode,
      stack: { ...tpl.stack, ...input.stack },
      started_at: now,
      current_step: "STEP 1",
    };
    await ensureEmptyJsonl(fjsonl);
    await writeText(summary, await buildSummary(state));
    return {
      state,
      result: {
        task_id: input.task_id,
        state_file: file,
        findings_file: fjsonl,
        summary_file: summary,
      },
    };
  });
}
