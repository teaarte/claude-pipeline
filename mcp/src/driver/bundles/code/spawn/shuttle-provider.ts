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
} from "../../../types/plugin.js";
import { spawnAgent } from "../../../core/shuttle.js";
import { pipelineRoot, schemasDir } from "../../../../lib/paths.js";

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
  if (req.team_knowledge && req.team_knowledge.length > 0) {
    lines.push("## Team knowledge");
    lines.push("");
    lines.push(
      "Project-scoped shared conventions and patterns the team has accumulated. Apply when relevant.",
    );
    lines.push("");
    lines.push(req.team_knowledge.trim());
    lines.push("");
  }
  lines.push("## Spawn context");
  lines.push("");
  lines.push(req.prompt);
  return lines.join("\n");
}

/**
 * The shuttle SpawnProvider returns control to Claude Code's Task tool via
 * a shuttle response — the spawned agent runs in Claude Code's context, not
 * in this MCP server's process. Two consequences worth knowing:
 *
 * 1. `spawn(req)` doesn't await the agent's result. It returns a shuttle that
 *    Claude Code observes; the agent's output later comes back through
 *    `pipeline_continue_task({type:"agent-result", ...})` round-trip.
 *
 * 2. `query?()` (Q41 — synchronous one-shot LLM classification call used by
 *    DecisionPlugins like refs-to-load) is intentionally NOT implemented
 *    here. The shuttle pattern cannot issue a synchronous out-of-band LLM
 *    call — we don't have an LLM transport in this process; the LLM lives
 *    behind Claude Code. The optional `?` on `SpawnProviderPlugin.query?()`
 *    encodes this: DecisionPlugins must handle `ctx.spawn_provider?.query`
 *    being undefined and fall back gracefully (refs-to-load uses regex
 *    fallback when query is absent).
 *
 *    `query?()` will be implemented by the v2.3 daemon's direct-API
 *    SpawnProvider (Anthropic SDK or OpenAI SDK running in the daemon
 *    process — no shuttle, real async). At that point Q41's LLM-driven
 *    refs selection activates automatically with no changes here or in
 *    refs-to-load.
 */
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
