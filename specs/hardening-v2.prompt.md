# claude-pipeline v2 — single-session framework launcher

> Drop into a **fresh Claude Code session** at the repo root (`/Users/teaarte/Programming/internal/claude-pipeline`).
> Self-contained — no prior session context required.
> Implements **Items 1–13** of `specs/hardening-v2.md` in one continuous build. Single commit per item. No backwards compatibility.

---

## PROMPT START

You are converting `claude-pipeline` from a markdown-orchestrated pipeline into a **plugin-based TypeScript framework** in a single session. The spec at `specs/hardening-v2.md` is the source of truth. This prompt fixes order, surfaces the plugin contract, defines the shuttle protocol, and lists acceptance criteria.

### Source of truth

Read `specs/hardening-v2.md` in full **before writing any code**. Required focus sections:

- "What v2 is" / "What stays markdown" / "What is deleted" — the lines you must not cross.
- "Architecture: before → after" — mental model.
- "Plugin types (the stable framework API)" — the type signatures you implement.
- "Execution order" — 13 items in the exact sequence.
- "Extending the pipeline" — verify your design supports each documented extension pattern.
- "Overall acceptance (whole pass)" — the gate.
- "Empirical notes" — context for Items 4b and 4c.

If anything in this prompt conflicts with the spec, **the spec wins**. Surface the conflict, do not silently choose.

### Pre-flight checks

Run all five before touching code:

1. `claude mcp list | grep claude-pipeline` shows `✓ Connected`.
2. `git status` is clean (or shows only the spec + this prompt as uncommitted from a prior session).
3. `pnpm --filter "@claude-pipeline/mcp" build && pnpm --filter "@claude-pipeline/mcp" smoke` passes (existing MCP is green before changes).
4. `~/.claude/commands` and `~/.claude/pipelines` are symlinks into this repo (`readlink` to verify).
5. **No backwards compatibility expected.** v1 state files in other projects will not load against v2 MCP. The user has consented. Confirm by re-reading the spec's "What v2 is" + "What is deleted" sections.

If any check fails, STOP.

### The plugin contract (read this carefully before Item 8)

The whole framework hangs off `mcp/src/driver/types/plugin.ts`. Implement exactly these interfaces. Built-in plugins implement them; future extensions implement them. No core code references specific plugin names.

```typescript
export const PLUGIN_API_VERSION = "1.0";

export interface PluginMeta { api_version?: string; }

export interface StepPlugin extends PluginMeta {
  name: string;
  phase: "context" | "planning" | "test_first" | "implementation" | "validation";
  run(state: DriverState, ctx: StepContext): Promise<StepResult>;
}

export interface AgentPlugin extends PluginMeta {
  name: string;
  template_path: string;
  output_schema: "reviewer" | "validator" | "nonreview";
  default_model: "haiku" | "sonnet" | "opus";
  applies_to?(state: DriverState): boolean;
}

export interface FlowPlugin extends PluginMeta {
  name: string;
  complexity: string;
  steps: string[];
}

export interface GatePlugin extends PluginMeta {
  name: string;
  message(state: DriverState): string;
  validate_response(answer: string): { ok: boolean; decision: "approved" | "rejected" | "changes_requested" };
}

export interface DecisionPlugin<T> extends PluginMeta {
  name: string;
  decide(state: DriverState): T;
}

export interface HookPlugin extends PluginMeta {
  name: string;
  event: "before-step" | "after-step" | "before-agent-spawn" | "after-agent-result";
  step_filter?: string | RegExp;
  run(state: DriverState, ctx: HookContext): Promise<void>;
}

export interface SpawnProviderPlugin extends PluginMeta {
  name: string;
  spawn(req: AgentSpawnRequest): Promise<StepResult>;
}
```

Hard rule: **`mcp/src/driver/core/` references these types, never the names of specific plugins.**

### The shuttle protocol (read this before Items 8 and 9)

The driver pauses between LLM-needed work by returning a structured response. The shuttle (Claude Code `/task` slash command in ≤30 lines of markdown) routes results back.

```typescript
type DriverResponse =
  | { status: "spawn-agent", driver_state_id, agent_run_id, agent, claude_code_task: { subagent_type, description, prompt, model? } }
  | { status: "spawn-agents-parallel", driver_state_id, spawns: [{ agent_run_id, agent, claude_code_task }] }
  | { status: "ask-user", driver_state_id, gate, message }
  | { status: "complete", task_id, verdict, summary }
  | { status: "error", driver_state_id, code, message, recovery_options };

type ContinueTaskInput =
  | { driver_state_id, type: "agent-result", agent_run_id, agent_output }
  | { driver_state_id, type: "agents-results", results: [{ agent_run_id, agent_output }] }
  | { driver_state_id, type: "user-answer", answer }
  | { driver_state_id, type: "recovery", choice: "abandon" | "force-close" | "retry" };
```

`pipeline_run_task` is the entry; `pipeline_continue_task` is the resume. Driver persists FSM state to `.claude/driver-state.json` (separate from `pipeline-state.json` which is canonical state owned by MCP tools).

### Implementation order — exact sequence

**One commit per item. 13 commits.** No reordering.

1. **Test infrastructure** — vitest + fast-check + GH Actions + per-tool unit tests + property tests for INV_001–INV_011.
2. **Audit log** — `mcp/src/lib/audit.ts`; wire every existing tool; per-project + global jsonl streams; hook bypass log.
3. **Atomic spawn-record** — `pipeline_begin_agent` + `open_spawns[]` schema + INV_012 + stale-spawn detection. `agent_run_id` REQUIRED in record tools.
4. **Guard hardening** — 4a marker `.mcp-managed`, 4b regex expansion (Python/Node/Deno/Perl/Ruby/dd + 12 evasion fixtures), 4c `pipeline_unlock_writes`/`pipeline_relock_writes` + bypass marker. **Remove `PIPELINE_ALLOW_RAW=1` entirely.**
5. **Recovery tools** — `pipeline_abandon` + `pipeline_cancel_spawn` + `commands/done.md` Recovery section.
6. **Soft JSON parsing** — 3-stage parser + `_repaired` flag.
7. **Counter coercion** — string→int + helpful errors.
8. **TypeScript framework + plugins + driver MCP tools** — the core of v2. See "Item 8 file layout" in the spec. Build in this internal order:
   - 8.1 `types/plugin.ts` + `core/state.ts` + `core/registry.ts` + `core/shuttle.ts`.
   - 8.2 `core/fsm.ts` + `core/invoke-hooks.ts` (generic engine, no plugin names).
   - 8.3 `builtin/decisions/*.ts` (pure functions, easiest tests).
   - 8.4 `builtin/agents/*.ts` (wrap each existing `agents/*.md` as `AgentPlugin`).
   - 8.5 `builtin/gates/*.ts`.
   - 8.6 `builtin/steps/*.ts` (one per FSM step, ~17 total).
   - 8.7 `builtin/hooks/*.ts` (load-past-misses, anti-pattern-grep, caller-context-expand).
   - 8.8 `builtin/spawn/shuttle-provider.ts`.
   - 8.9 `builtin/flows/{simple,medium,complex}.ts`.
   - 8.10 `loaders/builtins.ts` + `loaders/project-config.ts` (stub).
   - 8.11 `tools/run-task.ts` + `tools/continue-task.ts` (MCP tools).
   - 8.12 Tests for each plugin + property tests for core FSM.
9. **Shuttle markdown** — `commands/task.md` ≤30 lines per spec Item 9.
10. **Markdown apocalypse** — delete `pipelines/`, shrink `commands/done.md` ≤30 lines, trim `agents/*.md` (remove orchestration leakage), update `README.md` + `WORKFLOW.md`.
11. **Past-misses decay** — score function + `pipeline_set_pattern_confidence` tool.
12. **Protocol bump to 2.0** — `pipeline_meta` tool + `mcp/package.json` 2.0.0 + frontmatter `mcp_protocol_required: "^2.0"`.
13. **Golden-state smoke** — local script with simple-rename fixture + synthetic plugin proving extension claim.

### Hard rules during execution

- **No backwards compatibility.** Wipe any pre-existing `.claude/pipeline-state.json`, `findings.jsonl`, `agent-feedback.jsonl` at start. Do not write migration shims. Do not keep deprecated paths.
- **Tests-with-plugin.** Every plugin file ships with its own test file in the same commit. No "tests later".
- **`mcp/src/driver/core/` is plugin-name-free.** Never grep-able to `"planner"`, `"implementer"`, `"logic-reviewer"`, etc. The grep `grep -rEi "planner|implementer|logic-reviewer|gate-[012]" mcp/src/driver/core/` returns NOTHING.
- **Plugins register only in `loaders/builtins.ts`.** No other file in core touches the registry.
- **Run gates before every commit:**
  ```
  pnpm --filter "@claude-pipeline/mcp" typecheck
  pnpm --filter "@claude-pipeline/mcp" test
  pnpm --filter "@claude-pipeline/mcp" smoke
  ```
  All must pass. Each commit leaves `main` green.
- **One commit per item.** 13 commits total.
- Use the standard footer:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- **No push.** Local commits only. Push happens explicitly on human instruction after Item 13.

### What NOT to do

- Do not implement runtime plugin loading (`loaders/project-config.ts` is a stub returning empty overrides).
- Do not ship a direct-SDK spawn provider (shuttle provider only).
- Do not move agent prompts into TypeScript (`agents/*.md` stays markdown).
- Do not implement DAG-shaped flows (linear lists; parallelism is step-internal).
- Do not refactor adjacent code not named in the spec. Surgical only.
- Do not write fallback "manual mode" if any MCP tool misbehaves. Fix the bug or halt.
- Do not invent new invariants beyond `INV_012`.

### Final acceptance (after Item 13)

All criteria in the spec's "Overall acceptance (whole pass)" section. Of special note:

1. 17 MCP tools (was 10).
2. `INV_001`–`INV_012`.
3. `mcp/package.json` version `2.0.0`; `PLUGIN_API_VERSION` exported as `"1.0"`.
4. `commands/task.md` ≤30 lines.
5. `pipelines/` directory deleted.
6. All 12 guard-evasion fixtures blocked.
7. `PIPELINE_ALLOW_RAW=1` has no effect.
8. **Framework gates:**
   - `grep -rEi "planner|implementer|logic-reviewer|gate-[012]|simple-flow|medium-flow|complex-flow" mcp/src/driver/core/` returns nothing.
   - All 7 plugin types defined in `types/plugin.ts`.
   - Built-in plugin counts: ≥17 steps, ≥20 agents, ≥3 flows, ≥3 gates, ≥6 decisions, ≥3 hooks, 1 spawn provider.
   - Smoke test in Item 13 registers a synthetic plugin (e.g., `CustomTrivialReviewer`) and drives a task through it without modifying core.

### Output expected at the end

A short final report (≤500 words) covering:
- 13 commit SHAs in order.
- Final `pnpm test` coverage (line + branch percentages).
- Defaults chosen for Open Questions (audit retention, decay constants, bypass TTL, stale-spawn timeout, smoke gating).
- Any deviations from the spec, with reasoning.
- Any places where the spec was wrong or incomplete (this is expected; surface honestly).
- Confirmation that `grep -rEi "planner|implementer|logic-reviewer|gate-[012]" mcp/src/driver/core/` returns no matches.

## PROMPT END

---

## How to invoke

```
cd /Users/teaarte/Programming/internal/claude-pipeline
claude
```

Then paste the text between **PROMPT START** and **PROMPT END** as your first message. Or, if this file stays in the repo as the canonical instruction set:

```
Read specs/hardening-v2.prompt.md and execute the PROMPT START / END block literally.
```

## After this pass

Future evolution does NOT require editing `mcp/src/driver/core/`. Follow the "Extending the pipeline" section of `specs/hardening-v2.md`:

- New reviewer / agent → new `AgentPlugin` + 1 line in a flow.
- New step → new `StepPlugin` + reference in flows.
- New flow → new `FlowPlugin` + decision routing.
- New gate → new `GatePlugin` + step.
- New cross-cutting hook → new `HookPlugin` + register.
- Replace spawn mechanism → new `SpawnProviderPlugin` + swap in registry.
- Project-specific overrides → eventually via `loaders/project-config.ts` (full loader is a v3 task).
