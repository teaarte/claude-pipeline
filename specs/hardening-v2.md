# Pipeline v2 — single-session framework rewrite

**Status:** draft
**Mode:** single-session execution, no backwards compatibility, aggressive deletion allowed
**Mission:** turn `claude-pipeline` into a **plugin-based framework** with a TypeScript FSM core, mechanizing every orchestration decision that was previously in markdown. Markdown stays only for legitimate LLM input (agent prompts, knowledge references, project rules). Result: stable, predictable, mechanically enforced pipeline that scales by adding plugins, not by rewriting the core.

## Reading order

1. This file in full.
2. `mcp/README.md` — current MCP tool surface (will grow to 17).
3. Existing `commands/task.md` + `pipelines/{simple,medium,complex}.md` — read once to map current behaviors onto built-in plugins, then delete in Item 10.
4. `templates/agent-output-formats.md` and existing `agents/*.md` — these stay as prompt templates loaded by `AgentPlugin`s.

## What v2 is

- **Framework first.** `mcp/src/driver/core/` is a generic FSM engine that knows nothing about specific agents, steps, or flows. It executes whatever plugins are registered.
- **Built-in plugins** in `mcp/src/driver/builtin/` cover all current orchestrator behavior. Each is small (<100 LoC), tested in isolation, and a worked example for future extensions.
- **TypeScript plugin contracts** in `mcp/src/driver/types/plugin.ts` are the stable API. Future extensions implement these interfaces.
- **Shuttle pattern via `SpawnProviderPlugin`.** The driver does not hardcode "use the Claude Code Task tool"; it asks the registered `SpawnProviderPlugin`. v2 ships the shuttle provider. CLI/SDK provider can be added later without core changes.
- **Hardened MCP layer.** Atomic spawn-record (Item 3), audit log (Item 2), guard hook coverage (Item 4), recovery tools (Item 5), soft JSON parsing (Item 6).
- **No backwards compatibility.** v1 state files don't load. v1 markdown orchestrator is deleted. No deprecation periods.

## What stays markdown (legitimate LLM input)

- `agents/*.md` — per-agent prompts (role + checklist + output format). Updated to strict templates; no orchestration logic.
- `agents/references/*.md` — knowledge files consumed by agents (unchanged).
- `CLAUDE.md` (per project), `WORKFLOW.md`, `README.md` — human docs.
- `commands/task.md` — **≤30 lines, pure shuttle** (Item 9).
- `commands/done.md` — ≤30 lines.

## What is deleted

- `pipelines/simple.md`, `pipelines/medium.md`, `pipelines/complex.md` — replaced by TypeScript `FlowPlugin`s in `builtin/flows/`.
- All "Global Rules 1–30" content in current `commands/task.md` — encoded as plugins, hooks, or core FSM logic.
- `PIPELINE_ALLOW_RAW=1` env-var bypass — never worked through Claude Code's hook boundary.
- Any markdown describing orchestrator decisions (complexity classification, tests_mode logic, retry policies, etc.).

## Architecture: before → after

### Before (v1)

```
User: /task "..."
  ↓
Claude Code reads commands/task.md (700 lines) + pipelines/{simple,medium,complex}.md
  ↓
LLM interprets markdown to decide: complexity, agents, parallelism, gates, retries
  ↓
LLM calls MCP tools to record state (best-effort)
  ↓
End: LLM calls /done → pipeline_finish
```

### After (v2 framework)

```
User: /task "..."
  ↓
Claude Code reads commands/task.md (≤30 lines) — pure shuttle
  ↓
Shuttle calls mcp__claude-pipeline__pipeline_run_task({project_dir, task})
  ↓
MCP driver (TS in mcp/src/driver/):
  core/fsm.ts                      # generic engine — knows nothing about agents/steps
    ├── loads PluginRegistry (built-ins + optional project config)
    ├── reads current FlowPlugin and current step
    ├── invokes hooks (before-step)
    ├── invokes StepPlugin.run(state, ctx)
    │     └── step may call SpawnProviderPlugin to spawn agents
    │     └── step may emit "ask-user" via shuttle
    ├── invokes hooks (after-step)
    └── transitions FSM to next step or pauses
  ↓
Driver returns one of (via shuttle protocol):
  • { status: "spawn-agent", ... } / { status: "spawn-agents-parallel", ... }
  • { status: "ask-user", ... }
  • { status: "complete", ... }
  • { status: "error", recovery_options, ... }
  ↓
Shuttle routes back via pipeline_continue_task with the result
```

## Plugin types (the stable framework API)

Defined in `mcp/src/driver/types/plugin.ts` (single source of truth). Every built-in is one of these shapes; every future extension implements one of these interfaces.

```typescript
export const PLUGIN_API_VERSION = "1.0";

export interface PluginMeta {
  api_version?: string;  // default "1.0"; loader warns on mismatch
}

// A single FSM step (e.g. classify, plan, review, finalize).
export interface StepPlugin extends PluginMeta {
  name: string;
  phase: "context" | "planning" | "test_first" | "implementation" | "validation";
  run(state: DriverState, ctx: StepContext): Promise<StepResult>;
}

// An agent (LLM role) that can be spawned by a step.
export interface AgentPlugin extends PluginMeta {
  name: string;
  template_path: string;            // path to agents/*.md
  output_schema: "reviewer" | "validator" | "nonreview";
  default_model: "haiku" | "sonnet" | "opus";
  applies_to?(state: DriverState): boolean;  // conditional gating
}

// An ordered list of step names per complexity (or custom flow).
export interface FlowPlugin extends PluginMeta {
  name: string;                     // unique flow name
  complexity: string;               // "simple" | "medium" | "complex" | custom
  steps: string[];                  // ordered step plugin names
}

// A human gate (gate-0, gate-1, gate-2, or custom).
export interface GatePlugin extends PluginMeta {
  name: string;
  message(state: DriverState): string;
  validate_response(answer: string): { ok: boolean; decision: "approved" | "rejected" | "changes_requested" };
}

// A pure decision (complexity, tests_mode, refs-to-load, ...).
export interface DecisionPlugin<T> extends PluginMeta {
  name: string;
  decide(state: DriverState): T;
}

// A side-effect at lifecycle events (past-misses load, anti-pattern grep, ...).
export interface HookPlugin extends PluginMeta {
  name: string;
  event: "before-step" | "after-step" | "before-agent-spawn" | "after-agent-result";
  step_filter?: string | RegExp;
  run(state: DriverState, ctx: HookContext): Promise<void>;
}

// Spawn mechanism itself is a plugin. v2 ships ShuttleSpawnProvider; SDK provider can be added later.
export interface SpawnProviderPlugin extends PluginMeta {
  name: string;
  spawn(req: AgentSpawnRequest): Promise<StepResult>;
}
```

## Execution order — 13 items, one commit each

| # | Title | LoC budget | Depends on |
|---|-------|------------|------------|
| 1 | Test infra (vitest + property-based + CI) | ~600 | — |
| 2 | Audit log (helper + wire all tools + hook bypass logging) | ~200 | 1 |
| 3 | Atomic spawn-record (`pipeline_begin_agent` + INV_012 + schema) | ~250 | 1, 2 |
| 4 | Guard hardening (scope + regex + bypass replacement) | ~200 | 1, 2 |
| 5 | Recovery tools (`pipeline_abandon`, `pipeline_cancel_spawn` + /done docs) | ~150 | 1, 2, 3 |
| 6 | Soft JSON parsing (3-stage fallback) | ~80 | 1, 2 |
| 7 | Counter coercion + helpful errors | ~60 | 1 |
| 8 | **TypeScript framework + built-in plugins + 2 MCP driver tools** | ~2200 | 1–7 |
| 9 | **Shuttle markdown** (`commands/task.md` ≤30 lines) | ~30 | 8 |
| 10 | **Markdown apocalypse** (delete pipelines/, shrink done.md, trim agents/*.md) | net negative | 8, 9 |
| 11 | Past-misses decay (scoring function only) | ~80 | 1, 2 |
| 12 | Protocol bump to 2.0 + `pipeline_meta` tool | ~80 | all earlier |
| 13 | Golden-state smoke (1 fixture, local script) | ~150 | 8, 9, 10 |

Total: ~4100 new TS LoC + ~700 deleted markdown + ~30 tests/mocks. Achievable in one focused session (~2–3 hours of Claude Code agent work).

---

## Item 1 — Test infrastructure

Bootstrap testing for the whole pass.

**Build:**
- `mcp/package.json` adds dev deps: `vitest`, `@vitest/coverage-v8`, `fast-check`.
- `mcp/vitest.config.ts` — 80% line + branch coverage threshold on `mcp/src/**`.
- `mcp/test/tools/*.test.ts` — one happy-path + one rejection-path test per existing tool (10 files).
- `mcp/test/lib/invariants.property.test.ts` — property tests for `INV_001`–`INV_011`.
- `.github/workflows/mcp-test.yml`: `pnpm typecheck && pnpm test && pnpm smoke` on every PR touching `mcp/`. Merge-gated.
- `mcp/package.json` scripts: `test`, `test:watch`, `ci`.

**Acceptance:**
1. `pnpm test` green; ≥80% coverage on `mcp/src/tools/**` + `mcp/src/lib/**`.
2. Removing any `throw new Error('INV_xxx')` breaks ≥1 test.
3. CI workflow exists and merge-gates on failure.

---

## Item 2 — Audit log

Build `mcp/src/lib/audit.ts`:

```typescript
export type AuditEntry = {
  schema_version: "1.0";
  ts: string;
  tool: string;
  task_id: string | null;
  project_dir: string;
  args_summary: Record<string, unknown>;   // structural — never includes agent_output
  verdict: "ok" | "error" | "force_bypass";
  error?: string;
  force_used: boolean;
};

export async function audit(entry: AuditEntry, projectDir: string): Promise<void>;
```

Two streams: per-project `<project>/.claude/mcp-audit.jsonl` (cleaned by `/done`), global `~/.claude/metrics/mcp-audit.jsonl` (capped at 10k entries).

Wire every MCP tool through `audit()` after success and on caught errors. `hooks/pipeline-guard.sh` emits an audit line on bypass marker honoring (added in Item 4).

**Acceptance:**
1. N MCP calls → N audit lines, all valid JSON with `schema_version: "1.0"`.
2. `force=true` → `force_used: true, verdict: "force_bypass"`.
3. `/done` clears project audit; keeps global.
4. Unit tests cover ok / error / force_bypass paths.

---

## Item 3 — Atomic spawn-record

**Build:**

- `pipeline_begin_agent({project_dir, phase, agent, model?})` → returns `{agent_run_id: "ar-<uuid>"}`. Appends to `state.phases[phase].open_spawns[]`.
- `pipeline_record_agent_run` and `pipeline_record_nonreview_agent`: **require** `agent_run_id`. Match against `open_spawns[]`, remove on success.
- New `INV_012`: phase cannot be `completed` while `open_spawns[]` non-empty.
- Stale-spawn detection (default 30 min, configurable via `~/.claude/settings.json:pipeline.stale_spawn_timeout_ms`): `pipeline_validate` returns `stale-spawn` violation; `pipeline_finish` refuses unless `force=true`.

Schema:
```diff
"phases": {
  "implementation": {
    "status": "...",
+   "open_spawns": [
+     { "id": "ar-...", "agent": "logic-reviewer", "started_at": "..." }
+   ],
    ...
  }
}
```

**Acceptance:**
1. `pipeline_record_agent_run` without `agent_run_id` throws.
2. Begin 3, record 2, attempt phase complete → INV_012 thrown with leaked spawns listed.
3. `pipeline_validate` returns `stale-spawn` for an open spawn older than the timeout.
4. Smoke test covers parallel begin → record sequence.

---

## Item 4 — Guard hardening

Three coupled fixes to `hooks/pipeline-guard.sh`.

### 4a — project scoping via marker
`pipeline_init` creates `<project>/.claude/.mcp-managed` (zero-byte). Guard walks ancestors; no marker → fail-open. `/done` keeps the marker. `~/.claude/metrics/*.jsonl` always-managed.

### 4b — coverage expansion
Add write-op regex for non-shell tools:
```
python(3)?[[:space:]]+-c .*\b(unlink|remove|rmtree|open\([^)]*['\"]w)
node(js)?[[:space:]]+-e .*\b(unlinkSync|writeFileSync|appendFileSync|rmSync|truncateSync)
deno[[:space:]]+(run[[:space:]]+)?-A? .*\b(removeSync|writeTextFileSync|writeFileSync)
perl[[:space:]]+-e .*\bunlink
ruby[[:space:]]+-e .*\bFile\.(delete|write|open\([^)]*['\"]w)
dd[[:space:]]+.*\bof=
```
Both write-op + protected path must match. `tests/guard-evasion/` ships 12+ fixtures.

### 4c — replace env-var bypass with marker + tools
**Delete `PIPELINE_ALLOW_RAW=1` entirely.** Never worked through Claude Code's hook boundary.

- `pipeline_unlock_writes({project_dir, ttl_seconds, reason})` writes `.claude/.mcp-bypass-allowed`:
  ```json
  { "schema_version": "1.0", "expires_at": "...", "reason": "...", "issued_by_task_id": "..." }
  ```
  Default TTL 300s, max 3600s.
- `pipeline_relock_writes({project_dir})` deletes the marker.
- Guard reads marker; honors iff `now < expires_at`; emits audit line.
- `/done` deletes `.mcp-bypass-allowed`.

**Acceptance:**
1. No marker → guard fails-open.
2. `pipeline_init` creates marker; direct writes blocked.
3. All 12 evasion fixtures blocked.
4. `pipeline_unlock_writes({ttl_seconds: 300, ...})` then `rm` → succeeds; 301s later → blocked.
5. `PIPELINE_ALLOW_RAW=1` has no effect.
6. Audit log records every bypass.

---

## Item 5 — Recovery tools

**Build:**
- `pipeline_abandon({project_dir, reason})`: moves `pipeline-state.json` → `abandoned-<ts>.json`, writes audit, no metrics row.
- `pipeline_cancel_spawn({project_dir, phase, agent_run_id, reason})`: removes from `open_spawns[]`, audits.

**Update `commands/done.md`** with Recovery section:
- **A. Fix upstream** (preferred): each INV mapped to its fix.
- **B. Force-close**: `force=true` with audit acknowledgment.
- **C. Abandon**: when state is hopeless.

**Acceptance:**
1. Each INV_001–INV_012 has a recovery suggestion in `done.md`.
2. `pipeline_abandon` moves state, audits, writes no metrics row.
3. `pipeline_cancel_spawn` removes spawn + audits; subsequent `set_phase_status(completed)` succeeds.
4. Unit tests for all three recovery paths.

---

## Item 6 — Soft JSON parsing

3-stage parser in `mcp/src/lib/parse-json-header.ts`:
1. Fenced ```json block, parse strictly → done.
2. Lenient: scan first 500 chars for top-level `{...}`. If valid + schema-valid → accept with `_repaired: true` flag in response and audit.
3. Else throw.

Driver treats `_repaired` as informational, not error.

**Acceptance:** unit tests cover all three stages.

---

## Item 7 — Counter coercion

In `record-agent-run.ts`, `record-nonreview-agent.ts`, `set-phase-status.ts`: coerce numeric strings (`"3"`) for known-integer fields; reject approximations (`"~5"`, `"3-4"`, `"lots"`) with custom error: *"`iterations: '~5'` is approximate; pass an exact integer or omit the field."*

**Acceptance:** unit tests for both paths.

---

## Item 8 — TypeScript framework + built-in plugins (THE CORE)

**This is the heart of v2.** A generic FSM core consuming plugins; built-ins cover all current orchestrator behavior.

### File layout

```
mcp/src/driver/
  core/                              # generic engine; knows nothing about agents/steps
    fsm.ts                           # runFSM(state, registry) — driver loop
    state.ts                         # DriverState type + persistence to .claude/driver-state.json
    registry.ts                      # PluginRegistry impl
    shuttle.ts                       # DriverResponse / ContinueTaskInput types
    invoke-hooks.ts                  # runHooks(event, state, registry)
  types/
    plugin.ts                        # all plugin interfaces (single source of truth)
    shuttle.ts                       # shuttle protocol types
  builtin/
    steps/
      initialize.ts                  # pipeline_init + driver-state init
      classify.ts                    # decide complexity/tests_mode/refs (pure)
      gate-0.ts                      # show classification, ask confirm (SIMPLE fast-tracks)
      enrich.ts                      # parallel dep-auditor + code-analyzer
      context-verify.ts              # context-doc-verifier (MEDIUM/COMPLEX)
      architect.ts                   # architect (COMPLEX only)
      plan.ts                        # planner(s)
      plan-grounding.ts              # plan-grounding-check
      plan-review.ts                 # plan reviewers in parallel
      gate-1.ts                      # plan approval
      test-first.ts                  # tdd path: test agent in test-first mode
      git-stash.ts                   # pre-impl rollback point
      implement.ts                   # implementer
      git-diff.ts                    # capture .claude/diff.txt
      pre-review.ts                  # anti-pattern grep + caller-context (via hooks too)
      review.ts                      # parallel reviewers
      reconcile.ts                   # logic-vs-challenger
      iterate.ts                     # decide if another impl iteration
      sacred-tests.ts                # tdd: rehash test files
      final-checks.ts                # plan-conformance + acceptance + ui/api in parallel
      test-verify.ts                 # run test suite
      gate-2.ts                      # summary + accept/reject
      finalize.ts                    # pipeline_finish
    agents/                          # one AgentPlugin per agents/*.md file
      planner.ts                     # template_path: "agents/planner.md", schema: "nonreview", model: "opus"
      implementer.ts
      logic-reviewer.ts
      challenger-reviewer.ts
      style-reviewer.ts
      security.ts
      performance.ts
      code-analyzer.ts
      dependency-auditor.ts
      research.ts
      migration.ts
      architect.ts
      test.ts
      acceptance.ts
      plan-conformance.ts
      plan-grounding-check.ts
      context-doc-verifier.ts
      ui-consistency.ts
      api-contract.ts
      playwright.ts
    flows/
      simple.ts                      # FlowPlugin: steps = [initialize, classify, plan, gate-1, ...]
      medium.ts
      complex.ts
    gates/
      gate-0.ts                      # GatePlugin
      gate-1.ts
      gate-2.ts
    decisions/
      complexity.ts                  # DecisionPlugin<"simple"|"medium"|"complex">
      tests-mode.ts
      refs-to-load.ts
      security-needed.ts
      ui-touched.ts
      api-touched.ts
    hooks/
      load-past-misses.ts            # event: "before-step", step_filter: /^plan-review|review$/
      anti-pattern-grep.ts           # event: "after-step", step_filter: "implement"
      caller-context-expand.ts       # event: "after-step", step_filter: "implement" (MEDIUM/COMPLEX)
    spawn/
      shuttle-provider.ts            # SpawnProviderPlugin — returns "spawn-agent" / "spawn-agents-parallel" shuttle responses
  loaders/
    builtins.ts                      # loadBuiltinPlugins(registry) — registers everything in builtin/
    project-config.ts                # optional: load <project>/claude-pipeline.config.ts at runtime (stub for v2; full impl deferred)
  tools/
    run-task.ts                      # exposes pipeline_run_task
    continue-task.ts                 # exposes pipeline_continue_task
```

### Core principles

**The `core/` directory contains zero plugin-specific logic.** `core/fsm.ts` knows about `StepPlugin`, `FlowPlugin`, etc. as types but never references `"planner"` or `"implementer"` by name. All such names live in `builtin/`.

**Plugins are registered in `loaders/builtins.ts`:**
```typescript
export function loadBuiltinPlugins(registry: PluginRegistry): void {
  // Steps
  registry.steps.set("classify", classifyStep);
  registry.steps.set("plan", planStep);
  // ... ~17 steps total

  // Agents
  registry.agents.set("planner", plannerAgent);
  // ... ~20 agents total

  // Flows
  registry.flows.set("simple", simpleFlow);
  registry.flows.set("medium", mediumFlow);
  registry.flows.set("complex", complexFlow);

  // Gates
  registry.gates.set("gate-0", gate0);
  registry.gates.set("gate-1", gate1);
  registry.gates.set("gate-2", gate2);

  // Decisions
  registry.decisions.set("complexity", complexityDecision);
  // ... ~6 decisions total

  // Hooks
  registry.hooks.push(loadPastMissesHook);
  // ... ~3 hooks total

  // Spawn provider
  registry.spawn_provider = shuttleSpawnProvider;
}
```

**Driver lifecycle:**
```typescript
// pseudo-code
async function pipelineRunTask(input: {project_dir, task}): Promise<DriverResponse> {
  const registry = new PluginRegistry();
  loadBuiltinPlugins(registry);
  await loadProjectConfigIfPresent(registry, input.project_dir);  // stub returns no-op in v2

  const state = await initializeDriverState(input);
  return runFSM(state, registry);
}

async function pipelineContinueTask(input: ContinueTaskInput): Promise<DriverResponse> {
  const state = await loadDriverState(input.driver_state_id);
  const registry = await rebuildRegistry(state.project_dir);
  await applyInputToState(state, input);
  return runFSM(state, registry);
}

async function runFSM(state, registry): Promise<DriverResponse> {
  while (true) {
    const flow = registry.flows.get(state.flow_name);
    const stepName = flow.steps[state.step_index];
    const step = registry.steps.get(stepName);

    await runHooks(registry, "before-step", state, {step: stepName});
    const result = await step.run(state, buildStepContext(state, registry));
    await runHooks(registry, "after-step", state, {step: stepName, result});

    if (result.type === "shuttle-response") return result.response;
    if (result.type === "advance") { state.step_index++; await persist(state); continue; }
    if (result.type === "halt") return result.response;
  }
}
```

### Built-in flow definitions

```typescript
// builtin/flows/simple.ts
export const simpleFlow: FlowPlugin = {
  name: "simple",
  complexity: "simple",
  steps: [
    "initialize",
    "classify",
    "plan",
    "plan-grounding",
    "gate-1",
    "git-stash",
    "implement",
    "git-diff",
    "pre-review",
    "review",
    "final-checks",
    "test-verify",
    "gate-2",
    "finalize",
  ],
};
```

```typescript
// builtin/flows/medium.ts
export const mediumFlow: FlowPlugin = {
  name: "medium",
  complexity: "medium",
  steps: [
    "initialize",
    "classify",
    "gate-0",
    "enrich",
    "context-verify",
    "plan",
    "plan-grounding",
    "plan-review",
    "gate-1",
    "test-first",         // skipped at runtime when tests_mode=regression-only
    "git-stash",
    "implement",
    "git-diff",
    "pre-review",
    "review",
    "reconcile",
    "iterate",            // loops back to "implement" if needed
    "sacred-tests",       // no-op when tests_mode=regression-only
    "final-checks",
    "test-verify",
    "gate-2",
    "finalize",
  ],
};
```

(Complex flow analogous; adds `architect`, 3 competing planners, etc.)

### MCP tools

- `pipeline_run_task({project_dir, task})` → DriverResponse.
- `pipeline_continue_task(ContinueTaskInput)` → DriverResponse.

Both update `.claude/driver-state.json` atomically (proper-lockfile, same as state file).

### Tests

- Per-plugin unit tests under `mcp/test/driver/builtin/{type}/<name>.test.ts`.
- Core engine tests under `mcp/test/driver/core/`: FSM transitions, hook invocation order, registry behavior.
- Integration test in Item 13: end-to-end with mocked agents.

### Item 8 acceptance

1. `mcp/src/driver/core/**` files contain zero references to specific agent/step/flow names.
2. `mcp/src/driver/types/plugin.ts` defines all 7 plugin interfaces (Step, Agent, Flow, Gate, Decision, Hook, SpawnProvider) + `PLUGIN_API_VERSION`.
3. `mcp/src/driver/builtin/**` registers ≥17 steps, ≥20 agents, ≥3 flows, ≥3 gates, ≥6 decisions, ≥3 hooks, 1 spawn provider.
4. `loaders/builtins.ts` registers all of the above.
5. `loaders/project-config.ts` exists (stub: no-op returning empty overrides — full impl deferred).
6. `pipeline_run_task` and `pipeline_continue_task` are registered MCP tools.
7. Unit tests cover every built-in plugin's outputs (≥1 test per plugin).
8. FSM core has property tests proving: any sequence of valid shuttle inputs → either reaches `complete` or `error` (never hangs, never leaks open spawns when shuttle protocol is followed).

---

## Item 9 — Shuttle markdown (`commands/task.md` ≤30 lines)

Replace the entire current `commands/task.md` with a pure shuttle. The shuttle makes zero orchestration decisions; it only routes messages between user, Task tool, and the MCP driver.

Required behaviors (encoded in markdown):

1. Call `mcp__claude-pipeline__pipeline_run_task({project_dir: <cwd>, task: "$ARGUMENTS"})`.
2. Loop on driver responses:
   - **`spawn-agent`**: invoke `Task` tool with the embedded params. Pass agent output to `pipeline_continue_task({type: "agent-result", agent_run_id, agent_output})`.
   - **`spawn-agents-parallel`**: invoke `Task` for each spawn in parallel. Bundle results into `pipeline_continue_task({type: "agents-results", results: [...]})`.
   - **`ask-user`**: display `message` verbatim, capture user reply, call `pipeline_continue_task({type: "user-answer", answer})`.
   - **`complete`**: display `summary`, suggest `/done`, stop.
   - **`error`**: display `message` + `recovery_options`, ask user to pick, call `pipeline_continue_task({type: "recovery", choice})`.
3. Explicit prohibitions: don't interpret agent output, don't decide complexity/tests_mode/agent selection/parallelism/retries, don't skip gates, don't edit state files.

**Acceptance:**
1. `commands/task.md` ≤30 lines (excluding code fences and headers).
2. Contains no orchestration policy.
3. References only `pipeline_run_task` and `pipeline_continue_task` MCP tools and the `Task` tool.

---

## Item 10 — Markdown apocalypse

Delete and shrink markdown no longer driving behavior.

### Delete
- `pipelines/simple.md`, `pipelines/medium.md`, `pipelines/complex.md` (logic now in `builtin/flows/`).
- `pipelines/` directory itself.

### Shrink
- `commands/done.md` → ≤30 lines: `pipeline_validate` → `pipeline_finish` → KB persist → cleanup. The 100-line metrics-row description is gone — `pipeline_finish` computes it mechanically.
- `commands/agent-feedback.md` — verify it only calls `pipeline_log_agent_feedback`; trim any orchestration leakage.

### Trim each `agents/*.md`
For every file in `agents/`:
- Remove "When orchestrator should spawn me" / "Coordinate with X" / "After me, orchestrator does Y" content.
- Keep: role, input format, output format (fenced ```json block), task checklist.
- Result: every agent prompt is self-contained, agnostic to surrounding flow, loadable by its `AgentPlugin.template_path`.

### Update docs
- `WORKFLOW.md` — rewrite "How Issues Flow" diagram and "State integrity" section for plugin-based driver.
- `README.md` — Pipeline Flow section now describes the driver. Architecture section: "TypeScript plugin framework in `mcp/src/driver/`; markdown only for agent prompts and references."
- Remove all references to `pipelines/simple.md`, `pipelines/medium.md`, `pipelines/complex.md`.

**Acceptance:**
1. `pipelines/` directory does not exist.
2. `commands/task.md` ≤30 lines; `commands/done.md` ≤30 lines.
3. `grep -r "pipelines/simple\|pipelines/medium\|pipelines/complex" *.md commands/ agents/ mcp/ hooks/` returns no results.
4. Every `agents/*.md` loads cleanly via `mcp/src/driver/builtin/agents/<x>.ts`'s `template_path`.

---

## Item 11 — Past-misses decay

`pipeline_get_past_misses` ranks by score:
```
score = recency_weight × confidence × match_rate
recency_weight = exp(-age_days / 60)         // halflife ~42 days
confidence     = entry.manual_confidence ?? 1.0
match_rate     = (times_matched_last_20 / 20) + 0.05
```
`times_matched_last_20` computed on the fly by scanning recent `findings.jsonl` entries — no schema change.

New tool: `pipeline_set_pattern_confidence({feedback_id, confidence})` — writes `manual_confidence` into the JSONL entry (only place an existing JSONL line is mutated; auditable, explicit user action).

**Acceptance:**
1. Stale miss (no matches in 20 runs, age > 60 days) drops out of top-10.
2. `pipeline_set_pattern_confidence({confidence: 0.0})` permanently demotes.
3. Unit tests with fixture jsonl covering decay shapes.

---

## Item 12 — Protocol bump to 2.0

- New tool `pipeline_meta({})` → `{ protocol_version, schema_versions, tools[], plugin_api_version }`.
- `mcp/package.json` version → `2.0.0`.
- `PROTOCOL_VERSION = "2.0"` in `mcp/src/server.ts`.
- Shuttle markdown frontmatter: `mcp_protocol_required: "^2.0"`.
- Driver startup asserts via `pipeline_meta`; halts on mismatch.
- `mcp/README.md` SemVer policy.

**Acceptance:**
1. `pipeline_meta` returns current values including `plugin_api_version: "1.0"`.
2. Stub MCP at v1 → `pipeline_run_task` halts with clear error.

---

## Item 13 — Golden-state smoke (local script, exercises plugin registration)

`mcp/test/smoke-orchestrator/`:
```
fixtures/
  simple-rename/
    CLAUDE.md
    src/foo.ts
    task.txt
    expected-state.shape.json
    mock-agent-responses/
      planner.json
      implementer.json
      logic-reviewer.json
      style-reviewer.json
      acceptance.json
runner.ts
```

Runner:
1. Builds a `PluginRegistry`; loads built-ins.
2. Registers a `MockSpawnProvider` that overrides `shuttleSpawnProvider` and returns canned agent outputs from `mock-agent-responses/`.
3. Calls `pipeline_run_task` → `pipeline_continue_task` loop until `complete`.
4. Asserts `pipeline-state.json` shape (`complexity: "simple"`, `verdict: "accepted"`, `agents_count >= 3`, all `open_spawns[]` empty, audit log populated).

Also verifies the plugin contract: register a synthetic `CustomAgentPlugin` + add to flow steps; assert the driver picks it up without core changes.

`pnpm smoke:orchestrator` runs in <30s, no network.

**Acceptance:**
1. `pnpm smoke:orchestrator` passes.
2. Removing one FSM transition (e.g. drop `gate-1` step from `simpleFlow`) breaks the smoke with a clear assertion.
3. The synthetic CustomAgentPlugin proves the framework's extension claim.

---

## Extending the pipeline (framework documentation)

Once Item 8 is in place, future evolution does NOT require editing `mcp/src/driver/core/`. Every extension follows one of these patterns.

### Add a new agent (e.g., `accessibility-reviewer`)

1. Write the prompt template: `agents/accessibility-reviewer.md` (role, output format).
2. Register an `AgentPlugin` in a new file `mcp/src/driver/builtin/agents/accessibility-reviewer.ts`:
   ```typescript
   export const accessibilityReviewerAgent: AgentPlugin = {
     name: "accessibility-reviewer",
     template_path: "agents/accessibility-reviewer.md",
     output_schema: "reviewer",
     default_model: "sonnet",
     applies_to: (state) => didTouchUI(state),
   };
   ```
3. Register in `loaders/builtins.ts`: `registry.agents.set("accessibility-reviewer", accessibilityReviewerAgent);`.
4. Reference in a flow's review step (or add a new step that spawns it).
5. Done. No core changes.

### Add a new step

1. Create `mcp/src/driver/builtin/steps/<name>.ts` exporting a `StepPlugin`.
2. Register in `loaders/builtins.ts`.
3. Add the step name to any flow's `steps` list where it should run.

### Add a custom flow

1. Create `mcp/src/driver/builtin/flows/<name>.ts` exporting a `FlowPlugin`.
2. Register.
3. Decision in `complexity.ts` (or a custom DecisionPlugin) can route to it.

### Add a custom gate

1. Create `mcp/src/driver/builtin/gates/<name>.ts` exporting a `GatePlugin`.
2. Register.
3. Insert the corresponding step into a flow.

### Add a hook (cross-cutting side effect)

1. Create `mcp/src/driver/builtin/hooks/<name>.ts` exporting a `HookPlugin`.
2. Register via `registry.hooks.push(...)`.
3. Driver calls it automatically at the declared event with optional `step_filter`.

### Override a decision (e.g., custom complexity heuristic)

In a future version with runtime plugin loading: write `<project>/claude-pipeline.config.ts`:
```typescript
export default {
  decisions: {
    complexity: customComplexityDecision,
  },
};
```
`loaders/project-config.ts` will pick it up. For v2 (compile-time): edit `loaders/builtins.ts` directly to swap the registration.

### Replace the spawn provider

To run the driver without Claude Code (e.g., as a CLI with direct Anthropic SDK):

1. Implement `SpawnProviderPlugin`:
   ```typescript
   export const directSdkSpawnProvider: SpawnProviderPlugin = {
     name: "direct-sdk",
     async spawn(req) {
       const response = await anthropic.messages.create({ ... });
       return { type: "shuttle-response", response: { status: "agent-result", agent_run_id: req.agent_run_id, agent_output: response.content } };
     },
   };
   ```
2. Register: `registry.spawn_provider = directSdkSpawnProvider;`.
3. Done. Driver core unchanged.

### Plugin API version compatibility

`PLUGIN_API_VERSION` lives in `mcp/src/driver/types/plugin.ts`. Plugins MAY declare `api_version`. The loader warns on mismatch in v2; becomes a hard fail in v3 once external plugins ship. Bump policy:
- **Major** = removed or signature-changed plugin interface.
- **Minor** = added optional field or new plugin type.
- **Patch** = clarification or bugfix in plugin contract.

---

## Overall acceptance (whole pass)

After all 13 commits land locally:

1. `pnpm typecheck && pnpm test && pnpm smoke && pnpm smoke:orchestrator` all green.
2. ≥80% line + branch coverage on `mcp/src/**`.
3. MCP tools total: 17 (was 10): added `pipeline_begin_agent`, `pipeline_cancel_spawn`, `pipeline_abandon`, `pipeline_unlock_writes`, `pipeline_relock_writes`, `pipeline_set_pattern_confidence`, `pipeline_meta`, `pipeline_run_task`, `pipeline_continue_task`.
4. Invariants: `INV_001`–`INV_012`.
5. `mcp/package.json` version `2.0.0`; `PLUGIN_API_VERSION = "1.0"`.
6. `commands/task.md` ≤30-line shuttle; `commands/done.md` ≤30 lines.
7. `pipelines/` directory does not exist.
8. All 12 guard-evasion fixtures blocked.
9. `PIPELINE_ALLOW_RAW=1` has no effect.
10. v1 `pipeline-state.json` files explicitly rejected (schema mismatch, by design).
11. **Framework criteria:**
    a. `mcp/src/driver/core/**` contains zero references to specific agent/step/flow names.
    b. `mcp/src/driver/types/plugin.ts` exports all 7 plugin contracts.
    c. Built-in plugins: ≥17 steps, ≥20 agents, ≥3 flows, ≥3 gates, ≥6 decisions, ≥3 hooks, 1 spawn provider.
    d. Adding a new built-in plugin requires zero changes to `mcp/src/driver/core/`.
    e. The smoke test in Item 13 includes a synthetic plugin proving the extension claim.
12. Audit log streams populated after a real `/task` run.

---

## Defaults for Open Questions

| Question | Default |
|----------|---------|
| Audit retention (global) | 10k entries; `/learn` truncates |
| Past-misses decay halflife | 42 days |
| Past-misses match window | last 20 runs |
| Bypass marker TTL default | 300 s |
| Bypass marker TTL max | 3600 s |
| Stale-spawn timeout | 30 min |
| Smoke fixtures | 1 (simple-rename); add more later |
| CI orchestrator-smoke gating | not in CI — local-only this pass |
| Plugin runtime loader | stub in `loaders/project-config.ts`; full impl deferred |

---

## Empirical notes (preserve)

- **Python/Node guard evasion verified empirically** during 2026-05-13 `s3-panel/.claude/` cleanup. Item 4b regex set is the direct fix.
- **`PIPELINE_ALLOW_RAW=1` never reached the hook from in-session Bash.** Claude Code's hook runs in its own process env. Item 4c removes the env-var path entirely.

---

## What this spec does NOT do

- **Does not implement runtime plugin loading.** Stub in `loaders/project-config.ts`; full loader is a v3 task.
- **Does not ship an SDK-direct spawn provider.** Shuttle provider only. SDK provider is one file (`builtin/spawn/direct-sdk-provider.ts`) and can be added in a follow-up without core changes.
- **Does not move agent prompts into TypeScript.** They stay markdown — loaded by `AgentPlugin.template_path`. This is the framework's clean line between "code" and "LLM input".
- **Does not implement DAG-shaped flows.** Flows are linear step lists. Parallelism is a step-internal concern (e.g., `review` step internally spawns 5 reviewers in parallel via the spawn provider).
- **Does not add an external plugin marketplace.** Built-ins are the only plugins for v2.
