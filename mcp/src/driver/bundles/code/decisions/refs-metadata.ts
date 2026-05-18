/**
 * Q41: load the parsed YAML frontmatter from every `agents/references/*.md`
 * file. Result is cached at module level — refs are static across a run and
 * scanning the directory more than once per task is wasted I/O.
 *
 * Schema (per ref):
 *   {
 *     filename: "agents/references/perf-react.md"  // repo-relative
 *     tags: string[]                                // free-form
 *     stack_signals: Array<Record<string, unknown>> // soft hints
 *     summary: string                               // 1-3 sentence
 *     when_to_load: string                          // prose conditions
 *     agent_hints: string[]                         // benefiting agents
 *   }
 *
 * Missing required keys (`tags`, `summary`, `when_to_load`) log via
 * console.error and are skipped — the LLM can't do useful selection over
 * empty metadata so we'd rather emit an empty list than a half-populated
 * one.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pipelineRoot } from "../../../../lib/paths.js";
import { parseFrontmatter } from "../../../../lib/parse-frontmatter.js";

export interface RefMetadata {
  filename: string;
  tags: string[];
  stack_signals: Array<Record<string, unknown>>;
  summary: string;
  when_to_load: string;
  agent_hints: string[];
}

let cache: RefMetadata[] | undefined;

export function __resetRefsMetadataCacheForTests(): void {
  cache = undefined;
}

export async function loadRefsMetadata(
  refsDir: string = join(pipelineRoot, "agents", "references"),
): Promise<RefMetadata[]> {
  if (cache && refsDir === join(pipelineRoot, "agents", "references")) return cache;

  const entries = await readdir(refsDir, { withFileTypes: true }).catch(() => []);
  const result: RefMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const absolute = join(refsDir, entry.name);
    const raw = await readFile(absolute, "utf8").catch(() => "");
    const { data } = parseFrontmatter(raw);
    if (!data || Object.keys(data).length === 0) {
      // No frontmatter — pre-Q41 file, skip with a warning. Surfaces
      // forgotten refs after pulls; doesn't break the pipeline.
      // eslint-disable-next-line no-console
      console.error(`[refs-metadata] ${entry.name}: no frontmatter; skipping`);
      continue;
    }
    const tags = stringArray(data.tags);
    const summary = stringField(data.summary);
    const whenToLoad = stringField(data.when_to_load);
    if (tags.length === 0 || !summary || !whenToLoad) {
      // eslint-disable-next-line no-console
      console.error(
        `[refs-metadata] ${entry.name}: missing required keys (tags/summary/when_to_load); skipping`,
      );
      continue;
    }
    result.push({
      filename: relative(pipelineRoot, absolute),
      tags,
      stack_signals: Array.isArray(data.stack_signals)
        ? (data.stack_signals as Array<Record<string, unknown>>)
        : [],
      summary,
      when_to_load: whenToLoad,
      agent_hints: stringArray(data.agent_hints),
    });
  }
  result.sort((a, b) => a.filename.localeCompare(b.filename));
  if (refsDir === join(pipelineRoot, "agents", "references")) cache = result;
  return result;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
