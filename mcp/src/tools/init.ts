import { readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { TASK_ID_PATTERN } from "../lib/ids.js";
import { join } from "node:path";
import { templatesDir } from "../lib/paths.js";
import { stateFile, findingsFile, summaryFile, claudeDir } from "../lib/paths.js";
import {
  withStateLock,
  ensureEmptyJsonl,
  writeText,
} from "../lib/state-io.js";
import { buildSummary } from "../lib/summary.js";
import { assertProjectDirAllowed } from "../lib/project-dir.js";
import { readProjectBundleConfig } from "../driver/loaders/project-config.js";

export const initSchema = {
  project_dir: z.string().describe("Absolute path to the project root (contains .claude/)"),
  task: z.string().describe("One-line task description"),
  task_id: z
    .string()
    .regex(TASK_ID_PATTERN)
    .describe("t-YYYY-MM-DD-slug (lowercase, 4+ char slug; optional -[a-f0-9]{4} collision suffix per Q42)"),
  complexity: z.enum(["simple", "medium", "complex"]),
  tests_mode: z.enum(["tdd", "regression-only"]),
  stack: z
    .object({
      language: z.string(),
      package_manager: z.string().nullable().optional(),
      test_command: z.string().nullable().optional(),
      lint_command: z.string().nullable().optional(),
      build_command: z.string().nullable().optional(),
      project_type: z.enum(["frontend-app", "backend", "library", "monorepo"]).nullable().optional(),
    })
    .describe("Stack info — passes verbatim into pipeline-state.json"),
  owner_id: z
    .string()
    .nullable()
    .optional()
    .describe(
      "v2.2.6 C8 / Q64 — opaque platform-agnostic owner identifier (e.g. Claude Code session_id). Stored on state for cross-session safety checks.",
    ),
};

export async function pipelineInit(input: {
  project_dir: string;
  task: string;
  task_id: string;
  complexity: "simple" | "medium" | "complex";
  tests_mode: "tdd" | "regression-only";
  stack: any;
  owner_id?: string | null;
}): Promise<any> {
  await assertProjectDirAllowed(input.project_dir);
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
    const projectConfig = await readProjectBundleConfig(input.project_dir);
    const state = {
      ...tpl,
      bundle: projectConfig.bundle,
      task_id: input.task_id,
      task: input.task,
      complexity: input.complexity,
      tests_mode: input.tests_mode,
      stack: { ...tpl.stack, ...input.stack },
      started_at: now,
      team_knowledge_refs: [...projectConfig.team_knowledge_refs],
      owner_id: input.owner_id ?? null,
    };
    await ensureEmptyJsonl(fjsonl);
    await writeText(summary, await buildSummary(state));
    // 4a: drop the .mcp-managed marker so pipeline-guard.sh scopes its checks
    // to this project. Without the marker the guard fails-open.
    const cdir = claudeDir(input.project_dir);
    await mkdir(cdir, { recursive: true });
    await writeFile(join(cdir, ".mcp-managed"), "", "utf8");
    return {
      state,
      result: {
        task_id: input.task_id,
        state_file: file,
        findings_file: fjsonl,
        summary_file: summary,
        marker_file: join(cdir, ".mcp-managed"),
      },
    };
  });
}
