/**
 * Team-knowledge primitive (Item 7 of v2.2.5).
 *
 * Concept: each project may accumulate shared markdown knowledge across
 * tasks ("team conventions", "learned patterns", "post-mortem rules", …).
 * The driver injects those files into every agent prompt so reviewers
 * pick up the same conventions humans would expect.
 *
 * v2.2.5 ships the slot + the loader + spawn-time injection. The WRITE
 * path (which observations get promoted to team knowledge) is curator
 * territory — lands in v2.6. Until then, humans hand-author the
 * referenced files.
 *
 * Sources combined:
 *   1. `state.team_knowledge_refs[]` — per-project refs from
 *      `<project>/.claude/pipeline.config.json` (read at pipeline_init).
 *   2. Bundle baseline knowledge dir (e.g. `bundles/code/knowledge/`) —
 *      bundles can ship default knowledge files. v2.2.5 ships empty for
 *      every bundle; field reserved for future curated content.
 *
 * Cap: the combined content is truncated to MAX_TEAM_KNOWLEDGE_BYTES
 * (50KB by default). Truncation is logged via the returned `truncated`
 * flag — caller decides whether to emit an audit entry.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const MAX_TEAM_KNOWLEDGE_BYTES = 50 * 1024;

export interface TeamKnowledgeRef {
  /** Repo-relative or absolute path. */
  path: string;
  /** Where it came from (audit value). */
  source: "project-config" | "bundle-baseline";
}

export interface TeamKnowledgeResult {
  content: string;
  truncated: boolean;
  loaded: { path: string; bytes: number }[];
  missing: string[];
}

/**
 * Resolve refs to absolute paths. Relative paths are interpreted against
 * `baseDir` (typically `projectDir` for project-config refs and the
 * pipeline root for bundle-baseline refs).
 */
export function resolveTeamKnowledgePaths(
  refs: readonly string[],
  baseDir: string,
): string[] {
  return refs.map((r) => (isAbsolute(r) ? r : join(baseDir, r)));
}

/**
 * Load and combine team-knowledge content. Reads each ref in order; if
 * adding a file would exceed the cap, truncates at the cap boundary and
 * stops reading further files.
 *
 * Missing files (ENOENT, EACCES, etc.) are recorded in `missing[]`
 * and skipped — never throws. Callers may use `missing.length > 0` as a
 * signal to emit an audit warning.
 */
export async function loadTeamKnowledge(
  refs: readonly TeamKnowledgeRef[],
  cap: number = MAX_TEAM_KNOWLEDGE_BYTES,
): Promise<TeamKnowledgeResult> {
  const loaded: { path: string; bytes: number }[] = [];
  const missing: string[] = [];
  const parts: string[] = [];
  let bytesUsed = 0;
  let truncated = false;

  for (const ref of refs) {
    if (bytesUsed >= cap) {
      truncated = true;
      break;
    }
    try {
      const raw = await readFile(ref.path, "utf8");
      const header = `\n\n<!-- team-knowledge: ${ref.path} (${ref.source}) -->\n`;
      const section = header + raw;
      const sectionBytes = Buffer.byteLength(section, "utf8");
      if (bytesUsed + sectionBytes <= cap) {
        parts.push(section);
        bytesUsed += sectionBytes;
        loaded.push({ path: ref.path, bytes: sectionBytes });
      } else {
        const remaining = cap - bytesUsed;
        if (remaining > header.length) {
          const partial = section.slice(0, remaining);
          parts.push(partial);
          bytesUsed += Buffer.byteLength(partial, "utf8");
          loaded.push({ path: ref.path, bytes: Buffer.byteLength(partial, "utf8") });
        }
        truncated = true;
        break;
      }
    } catch {
      missing.push(ref.path);
    }
  }

  return {
    content: parts.join(""),
    truncated,
    loaded,
    missing,
  };
}
