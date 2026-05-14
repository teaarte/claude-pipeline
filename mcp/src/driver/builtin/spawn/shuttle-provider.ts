/**
 * Shuttle SpawnProviderPlugin — the only spawn provider v2 ships. Returns a
 * `spawn-agent` DriverResponse pointing at Claude Code's `Task` tool; the
 * shuttle markdown (`commands/task.md`) routes the result back via
 * pipeline_continue_task.
 *
 * Future providers (e.g. direct Anthropic SDK) implement the same
 * `SpawnProviderPlugin` contract; swapping them in is a registry-level
 * change with no impact on core/.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
  AgentSpawnRequest,
  SpawnProviderPlugin,
  StepResult,
} from "../../types/plugin.js";
import { spawnAgent } from "../../core/shuttle.js";
import { pipelineRoot, schemasDir } from "../../../lib/paths.js";

/**
 * Claude Code's `Task` tool only accepts a fixed set of subagent_type values
 * (general-purpose, Explore, Plan, runtime-debug-agent, …). v2 maps every
 * AgentPlugin onto "general-purpose" — the agent's identity + role prompt
 * are carried in the prompt text instead. See Q16 in
 * `specs/v3-productization-roadmap.md`.
 */
const CC_GENERIC_SUBAGENT_TYPE = "general-purpose" as const;

/**
 * Q18: cached per-agent category vocab. Loaded lazily on the first spawn
 * so the registry doesn't need to know about it. `null` → file load
 * failed; we degrade gracefully and skip the inline section.
 */
let vocabCache: Record<string, string[]> | null | undefined;

async function loadCategoryVocab(): Promise<Record<string, string[]> | null> {
  if (vocabCache !== undefined) return vocabCache;
  try {
    const raw = await readFile(join(schemasDir, "category-vocab.json"), "utf8");
    const parsed = JSON.parse(raw);
    vocabCache = (parsed?.vocab as Record<string, string[]>) ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[shuttle-provider] failed to load category-vocab.json: ${msg}`);
    vocabCache = null;
  }
  return vocabCache;
}

/** Test-only — reset between cases that mutate the schemas dir. */
export function __resetVocabCacheForTests(): void {
  vocabCache = undefined;
}

function vocabSection(agent: string, vocab: Record<string, string[]> | null): string | null {
  if (!vocab) return null;
  const allowed = vocab[agent];
  if (!allowed || allowed.length === 0) return null;
  const lines: string[] = [];
  lines.push("## Allowed `category` values for findings");
  lines.push("");
  lines.push(`When emitting a finding, the \`category\` field MUST be one of:`);
  for (const v of allowed) lines.push(`- ${v}`);
  lines.push("");
  lines.push(`If no entry fits, set \`category: "other"\` AND populate \`proposed_new_category: "<your-suggestion>"\` for future vocab expansion.`);
  return lines.join("\n");
}

async function readTemplate(templatePath: string | undefined): Promise<string | null> {
  if (!templatePath) return null;
  const absolute = isAbsolute(templatePath) ? templatePath : join(pipelineRoot, templatePath);
  try {
    return await readFile(absolute, "utf8");
  } catch (e) {
    // Don't fail the spawn — surface a clearly-marked stub so the spawned
    // agent (and the operator inspecting the shuttle payload) can see what
    // went wrong. A missing template is a config bug, not a runtime fault.
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[shuttle-provider] failed to read template ${absolute}: ${msg}`);
    return `<<template read failed: ${absolute} — ${msg}>>`;
  }
}

function buildPrompt(
  req: AgentSpawnRequest,
  template: string | null,
  vocab: Record<string, string[]> | null,
): string {
  const lines: string[] = [];
  lines.push(`# You are the ${req.agent} agent`);
  lines.push("");
  lines.push(
    `Subagent dispatch via Claude Code's Task tool delivers this prompt to a general-purpose runner. Adopt the role described below verbatim.`,
  );
  lines.push("");
  lines.push(`- agent_name: ${req.agent}`);
  lines.push(`- phase: ${req.phase}`);
  lines.push(`- driver_state_id: ${req.driver_state_id}`);
  lines.push(`- agent_run_id: ${req.agent_run_id}`);
  lines.push("");
  if (template) {
    lines.push("## Role template");
    lines.push("");
    lines.push(template.trim());
    lines.push("");
  }
  const vs = vocabSection(req.agent, vocab);
  if (vs) {
    lines.push(vs);
    lines.push("");
  }
  lines.push("## Spawn context");
  lines.push("");
  lines.push(req.prompt);
  return lines.join("\n");
}

export const shuttleSpawnProvider: SpawnProviderPlugin = {
  name: "shuttle",
  async spawn(req: AgentSpawnRequest): Promise<StepResult> {
    const [template, vocab] = await Promise.all([
      readTemplate(req.template_path),
      loadCategoryVocab(),
    ]);
    const prompt = buildPrompt(req, template, vocab);
    return {
      type: "shuttle",
      response: spawnAgent(req.driver_state_id, req.agent_run_id, req.agent, {
        subagent_type: CC_GENERIC_SUBAGENT_TYPE,
        description: `Run ${req.agent}`,
        prompt,
        model: req.model,
      }),
    };
  },
};
