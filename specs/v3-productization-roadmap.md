# v3 Productization Roadmap

**Status:** strategic — not committed
**Prerequisite:** v2 hardening shipped (`specs/hardening-v2.md` complete)
**Purpose:** convert `claude-pipeline` from personal tooling into a usable product. Each phase is independently shippable.

This document is **strategic, not tactical**. Each phase here gets its own detailed spec when it's time to execute. Phases are sized in days/weeks of focused work, not specific commits.

---

## Where v2 leaves us

v2 has shipped (commit range `67d736f`…`128ab51`, 13 spec items + handoff commits + **4 code-review fix commits** `20a626e`/`ed828f8`/`817a09d`/`128ab51`). Actual delivered state:

- **Plugin framework architecture:** all 7 plugin contracts in `mcp/src/driver/types/plugin.ts` (`StepPlugin`, `AgentPlugin`, `FlowPlugin`, `GatePlugin`, `DecisionPlugin`, `HookPlugin`, `SpawnProviderPlugin`) + `PLUGIN_API_VERSION = "1.0"`.
- **Built-in plugins:** 23 steps, 20 agents, 3 flows, 3 gates, 6 decisions, 3 hooks, 1 spawn provider (`shuttle`). All spec minima met.
- **MCP-enforced state invariants:** `INV_001`–`INV_012` (added INV_012 open-spawn leak in Item 3).
- **MCP tool count:** **19** (spec target 17; +2 from acceptance criteria that required `pipeline_set_pattern_confidence` and `pipeline_meta`).
- **Audit log:** per-project (`.claude/mcp-audit.jsonl`) + global (`~/.claude/metrics/mcp-audit.jsonl`).
- **Test infrastructure:** vitest + fast-check property tests + CI workflow. **179 tests across 29 files, 94.33% line coverage, 79.39% branch coverage** (slightly under 80% spec target — 5% gap is unreachable `?? default` branches in metrics builders; documented and accepted).
- **Protocol versioning:** `PLUGIN_API_VERSION = "1.0"`, `mcp/package.json 2.0.0`, frontmatter pin `mcp_protocol_required: "^2.0"` in `commands/task.md`.
- **Recovery paths:** `pipeline_abandon` + `pipeline_cancel_spawn` + `commands/done.md` (21 lines) with INV_001–INV_012 + stale-spawn recovery hints inline.
- **Guard hook hardened:** Item 4 added marker-based scoping (`.mcp-managed`), TTL bypass via `.mcp-bypass-allowed`, regex coverage expansion. **Code review extended this to 20 evasion fixtures** all blocked, including: `bash -c "rm ..."`, command substitution `$(rm ...)`, `os.system('rm ...')`, `subprocess.*`, `find -delete`, `find -exec rm`, relative paths (resolved against `$PWD`), split-form `find /x/.claude -name pipeline-state.json -delete`, `gzip/bzip2/xz/zstd` in-place, `pwsh -Command "Remove-Item"`, attempts to delete `.mcp-managed` itself. Protected basenames now include `driver-state.json`, `.mcp-managed`, `.mcp-bypass-allowed` (so the marker files protect themselves). **Bypass marker forgery prevented** via `issued_at + TTL cap` check (3600s max from issue time; `pipeline_unlock_writes` refuses to extend active marker without `force=true`). **Path traversal blocked** by new `mcp/src/lib/project-dir.ts:assertProjectDirAllowed()` (restricts `project_dir` to cwd / `TMPDIR` / `~/.claude/settings.json:pipeline.allowed_project_roots`).
- **Foundation for later phases** already in place (no need to redo in v2.5+):
  - `mcp/src/driver/types/config.ts` exports `ClaudePipelineConfig` with `default_models_by_phase`, `agent_overrides`, `gate_policy`, `notification_targets`, `plugin_enabled`.
  - `mcp/src/driver/builtin/agents/resolve-model.ts` implements the `agent_overrides[name].model ?? default_models_by_phase[phase] ?? plugin.default_model` cascade. **Phase is passed explicitly from caller** (review fix L2 — no more string-matching `template_path` heuristic).
  - State IO encapsulated: `pipeline-state.json`, `findings.jsonl`, `mcp-audit.jsonl`, `driver-state.json` written ONLY inside `mcp/src/tools/*` and `mcp/src/driver/core/state.ts`.
  - Driver transport-agnostic: `runFSM(state, registry)` in `driver/core/fsm.ts` does not depend on MCP; `pipeline_run_task` and `pipeline_continue_task` are thin wrappers.
  - **Driver↔pipeline-state wiring closed (review fix arch01/02):** `pipelineRunTask` calls `pipelineInit`; `runFSM` accepts an injected `SpawnRecorder`; `mcpSpawnRecorder` routes every `beginSpawn` through `pipelineBeginAgent`; `pipelineContinueTask` calls `pipelineRecordAgentRun`/`pipelineRecordNonreviewAgent` for `agent-result` / `agents-results` — `open_spawns[]` close correctly.
  - **Concurrency-safe (review fix conc01):** both `pipelineRunTask` and `pipelineContinueTask` wrapped in `withDriverStateLock`; concurrent invocations cannot clobber driver state. `pipelineRunTask` refuses to overwrite in-flight state (returns `IN_FLIGHT_TASK` shuttle response with recovery options).
  - **`lib/ids.ts` consolidates** `makeFindingId`, `makeFeedbackId`, `makeAgentRunId`, `AGENT_RUN_ID_PATTERN`. v2.5+ should import from here, not reinvent.
  - **`lib/audit.ts` is concurrency-safe and bounded:** `proper-lockfile.lock` around read-trim-rename; stat-based fast path skips read when file fits in 3MB; global stream redacts `project_dir`/`task`/`task_short`/`reason` to length markers (`redactForGlobal`); per-project stream capped at 50k entries; IO errors go to stderr (not silent).
  - **`lib/parse-json-header.ts` bounded:** `LENIENT_OBJECT_CEILING=128KB`, `LENIENT_RETRY_CAP=5` — patological inputs no longer cause O(n²).

### Known follow-ups from v2 execution (defer to v2.5 or v2.1 hot-fix)

1. **`agents/*.md` cleanup** — 4 files still mention "orchestrator" (Item 10 was light-touch). Template loading verified working; cosmetic cleanup deferred. Fold into v2.5 (when agents/*.md gets new model-resolution metadata anyway).
2. **`pipelines/` symlink in `~/.claude/`** — pointed at deleted `repo/pipelines/`. Removed during v2 post-flight. New installs won't have this issue.
3. **`pipeline-guard.sh` is a copy in `~/.claude/hooks/`** (not a symlink to repo). Means hook updates require manual sync. Consider symlinking in v2.5 (or document `ln -sf` in install script).
4. **`set-phase-status.ts` coercion** — Item 7 spec named this file as a coercion site, but it has no integer args today. Left untouched.

### Deliberately deferred from code review (track for v2.5+)

These were flagged in the v2 code review and consciously deferred — fix when their cost/benefit improves:

1. **Sec sec005 — nested-project marker walk.** `find_marker_dir` takes the NEAREST `.mcp-managed`. No real leak (bypass marker reads from same dir as `.mcp-managed`), but documented edge case if user has nested projects with conflicting markers.
2. **Perf I2 — `get-past-misses` reads whole `pipeline.jsonl`.** Fine at <5MB scale (~500KB per 1000 tasks). Convert to streaming tail-N when file grows. v2.5+ candidate.
3. **Challenger #8 — audit reads pipeline-state on every call.** 5-15ms on hot cache. Threading `task_id` through 19 tool signatures was not justified at v2. Revisit when audit becomes a hot path (P3 team-scale era).

What's missing for **product**:

- Discoverability — only known to the author
- Onboarding — assumes deep familiarity with Claude Code internals
- Distribution — manual git clone + symlink + MCP registration
- Plugin trust model — any plugin has full system access
- Multi-user / team story — single-user assumptions everywhere
- Hosted services — no shared metrics, no cross-team learning, no plugin marketplace
- Brand + docs site — no public face

The roadmap below addresses these gaps in order of leverage.

---

## Phase v2.5 — Daemon + Web UI + Multi-provider foundation

**Prerequisite:** v2 shipped (confirmed at commit `95f3f90`).
**Goal:** turn the in-process MCP-tool driver into a **long-running daemon** with HTTP API + minimal Web UI for configuration. Add the first non-shuttle `SpawnProviderPlugin` (Anthropic SDK direct) so model selection becomes meaningful. Keep Claude Code as a first-class entry point.

This phase is the bridge from "personal tool used in a Claude Code chat" to "self-hosted dev tool with multiple entry points and configurable LLM backends".

### What's already in place from v2 (don't redo)

These pieces were nudged into v2 ahead of time so v2.5 doesn't need rework:

- ✓ `ClaudePipelineConfig` type in `mcp/src/driver/types/config.ts` — the schema Web UI will edit.
- ✓ `resolveAgentModel(plugin, phase, config)` cascade — phase passed explicitly (no template_path heuristic).
- ✓ State IO encapsulated through `tools/*.ts` + `driver/core/state.ts` — SQLite swap is a state-layer-only change.
- ✓ Driver transport-agnostic (`runFSM(state, registry)` accepts injected `SpawnRecorder`; HTTP API will inject its own).
- ✓ Driver↔pipeline-state fully wired via `mcpSpawnRecorder` — open spawns close correctly through `pipelineBeginAgent` + `pipelineRecord*`.
- ✓ Concurrency-safe driver (`withDriverStateLock` on both `pipelineRunTask` and `pipelineContinueTask`).
- ✓ `pipeline_set_pattern_confidence` MCP tool (Item 11) — past-misses confidence override already works.
- ✓ `pipeline_meta` MCP tool (Item 12) — Web UI can call this to discover protocol version + tool list.
- ✓ `lib/ids.ts` consolidates id generators (don't write new ones; import).
- ✓ `lib/audit.ts` is lock-safe + bounded + redacted in global stream.
- ✓ `lib/project-dir.ts:assertProjectDirAllowed()` — **MUST be used by HTTP API in v2.5.3 for every incoming `project_dir`** (Web UI is a path-traversal vector otherwise).
- ✓ Bypass marker is forgery-resistant (`issued_at + TTL cap` ≤ 3600s) — Web UI "Unlock writes" button calls existing `pipeline_unlock_writes`; do not reinvent the marker format.

v2.5 builds **on top of** these; reuse them, don't reinvent.

### Security must-haves carried over from v2

1. **HTTP API endpoints accepting `project_dir`** (POST /api/tasks, GET /api/tasks/:id, etc.): wrap every `project_dir` extraction through `assertProjectDirAllowed()` before passing to MCP tools. Without this, a malicious request can target paths outside the user's projects (e.g. `~/.ssh/`).
2. **Web UI "Unlock writes" button**: bound TTL to the same 3600s max enforced by `pipeline_unlock_writes`. Don't bypass.
3. **HTTP API task submission must use the SAME `mcpSpawnRecorder`** as MCP entry points — guarantees pipeline-state stays consistent regardless of which client submitted.
4. **`INV_012` fires on both `completed` AND `skipped`** (review fix L3). If v2.5 adds gate-policy plugins that auto-skip phases, they MUST cancel open spawns first or hit this invariant.

### Target architecture after v2.5

```
┌─────────────────────────────────────────────────────────────┐
│ ENTRY POINTS (equally first-class)                          │
│   Web UI (SvelteKit/Astro SPA, localhost:5173)              │
│   Claude Code chat (/task via MCP, unchanged from v2)        │
│   CLI (claude-pipeline submit/status/tail/queue)             │
└─────────────────────────────────────────────────────────────┘
                ↓ HTTP/SSE  ↓ MCP stdio  ↓ direct
┌─────────────────────────────────────────────────────────────┐
│ DAEMON (long-running Node, started via launchd/systemd/CLI)  │
│   ├─ HTTP server (Fastify): /api/{config,tasks,agents,...}   │
│   ├─ MCP server (stdio): unchanged from v2                   │
│   ├─ Driver: v2 FSM + plugin framework, shared by all entry  │
│   └─ Persistence: SQLite (config + history) + JSONL (audit) │
└─────────────────────────────────────────────────────────────┘
```

### v2.5.1 — Daemon lifecycle

- `claude-pipeline daemon start|stop|status|restart` CLI commands.
- PID file in `~/.claude-pipeline/daemon.pid`, log file in `~/.claude-pipeline/daemon.log`.
- Optional: `launchd` plist for macOS / `systemd` unit for Linux to autostart.
- Daemon process owns the singleton `PluginRegistry` + driver. All entry points connect to the same daemon.
- Health endpoint `GET /healthz` returns daemon uptime + plugin counts.

**Effort:** ~1 day.

### v2.5.2 — SQLite migration for queryable state

JSONL is great for audit (append-only stream) but bad for "list my last 50 tasks". Migrate:

| Data | Stays as | Becomes |
|------|----------|---------|
| `~/.claude/metrics/pipeline.jsonl` | JSONL (append-only) | Mirrored to SQLite `tasks` table for queries |
| `~/.claude/metrics/agent-feedback.jsonl` | JSONL | Mirrored to SQLite `past_misses` table |
| `~/.claude/metrics/mcp-audit.jsonl` | JSONL | Stays JSONL only (high volume, append-only) |
| Per-agent config | n/a | New: SQLite `agent_configs` table |
| Pipeline config | n/a | New: SQLite `pipeline_config` table (single row) |
| Plugin registry state | n/a | New: SQLite `plugins` table (enabled/disabled, version) |
| **Per-spawn cost** | n/a | New: SQLite `spawn_costs` table — provider, model, input_tokens, output_tokens, est_cost_usd, ts, task_id, agent |
| **Task budgets** | n/a | New: SQLite `task_budgets` table — limit_usd, spent_usd, status |

New `StateStorePlugin` contract (8th plugin type):

```typescript
export interface StateStorePlugin extends PluginMeta {
  name: string;
  loadConfig(): Promise<ClaudePipelineConfig>;
  saveConfig(c: ClaudePipelineConfig): Promise<void>;
  loadAgentConfig(agent: string): Promise<AgentConfig | null>;
  saveAgentConfig(agent: string, c: AgentConfig): Promise<void>;
  listTasks(filter): Promise<TaskSummary[]>;
  getTask(taskId): Promise<TaskFull | null>;
  // ...
}
```

Built-in: `SqliteStateStorePlugin` using `better-sqlite3` or Drizzle.
Driver consumes via `registry.state_store` — no direct DB knowledge.

**Effort:** ~1-2 days.

### v2.5.3 — HTTP API

Fastify server inside the daemon, mounting:

```
GET    /api/config                  → current pipeline config
PATCH  /api/config                  → update config
GET    /api/agents                  → list all agents with their configs
PATCH  /api/agents/:name            → update per-agent config (model, provider, model params)
GET    /api/providers               → list registered SpawnProviders + status
GET    /api/tasks                   → recent tasks (paginated)
POST   /api/tasks                   → submit new task (queues it)
GET    /api/tasks/:id               → single task with status, agents, findings
GET    /api/tasks/:id/stream        → SSE stream of live updates
DELETE /api/tasks/:id               → cancel a running task (via pipeline_abandon)
GET    /api/findings                → search findings by category/agent/file
GET    /api/audit                   → recent audit entries
GET    /api/metrics                 → aggregate metrics for /metrics-report UI
GET    /api/plugins                 → installed plugins + their manifests
```

OpenAPI spec auto-generated. All endpoints schema-validated via Zod (already a dependency).

**Effort:** ~1-2 days.

### v2.5.4 — Multi-provider SpawnProviders (first batch)

Implement the second `SpawnProviderPlugin` so model selection becomes meaningful:

1. **`AnthropicSdkSpawnProvider`** — uses `@anthropic-ai/sdk` directly. Requires `ANTHROPIC_API_KEY`. User specifies model per agent in config.
2. **`ClaudeCodeSubprocessSpawnProvider`** (optional) — invokes `claude` CLI with `--output-format stream-json` per agent (ralphex pattern). For users who want autonomous-from-Claude-Code-subprocess without needing API key.

Driver behavior:
- Reads `agent_config.provider` from SQLite (e.g. `"shuttle" | "anthropic-sdk" | "claude-code-subprocess"`).
- Looks up the matching `SpawnProviderPlugin` in registry.
- Hands off the spawn request.

**Effort:** ~2-3 days for SDK provider + ~1 day for subprocess provider.

### v2.5.5 — Minimal Web UI

**Stack:** SvelteKit or Astro (single-binary friendly, builds to static assets, served by daemon's HTTP). Tailwind via CDN for fast iteration.

**Pages (4, plus a shell):**

1. **Settings** — global pipeline config (default models per phase, complexity heuristic overrides, gate policy, notification preferences).
2. **Agents** — list of registered agents. Per-agent: provider dropdown, model dropdown (populated from provider capabilities), token/cost limit, timeout, enabled/disabled toggle.
3. **Tasks** — submit form + recent tasks list. Click task → detail view with timeline, agent spawns, findings, audit trail, SSE-live updates while running.
4. **Plugins** — list installed plugins with manifest, version, capabilities. Mostly read-only initially; enable/disable in v2.5 era; plugin marketplace in P2.

**Effort:** ~3-4 days.

### v2.5.6 — Auto-mode gates + notifications

By default after v2.5, gates auto-approve in the daemon (HTTP-submitted tasks run unattended). Interactive gates remain for Claude Code chat flow.

New plugin types:
- **`GatePolicyPlugin`** (variants: `auto-approve`, `escalate-on-blocker`, `interactive`).
- **`NotificationPlugin`** (built-ins: `desktop-notify`, `webhook`, `email-via-smtp`, `log-only`).

Per-task in submit form: choose gate policy + notification target.

**Effort:** ~1-2 days.

### v2.5.7 — Permission strategy for autonomous mode

Claude Code asks the user for permission before running Bash commands, editing files, calling MCP tools, etc. In interactive `/task` flow this is fine — user clicks through. In autonomous (daemon-submitted) tasks there's nobody to click. v2.5 must offer mechanisms that don't block on permission prompts.

**Background.** Claude Code permission system:
- `permissions.allow[]` in `~/.claude/settings.json` whitelists tools/commands.
- `defaultMode: "acceptEdits"` auto-approves file edits.
- `--dangerously-skip-permissions` CLI flag bypasses everything (used by ralphex).
- Task-spawned sub-agents inherit parent session's permission grants.

**Three strategies, configurable per task via `pipeline_config.permission_strategy`:**

#### Strategy B — Claude Code subprocess + skip-permissions (DEFAULT for autonomous mode)

`ClaudeCodeSubprocessSpawnProvider` invokes `claude --dangerously-skip-permissions --output-format stream-json --verbose` per agent (ralphex pattern). Bypasses all permission prompts.

**Why this is the default:** v2.6 makes Docker isolation the default execution environment for autonomous tasks. With the container as the blast-radius boundary, `--dangerously-skip-permissions` is safe — the agent can do whatever, but it can only do it inside the throwaway container. This combination = ralphex-grade autonomy + better isolation than ralphex (per-task containers vs ralphex's optional Docker wrapper).

**Pros:**
- Uses existing Claude Code subscription (no separate API key).
- Mirrors a battle-tested pattern (ralphex).
- Agent behavior is identical to interactive mode (no behavioral surprises).
- No permission-prompt deadlocks possible.

**Cons:**
- Requires `claude` CLI installed in the daemon's environment / Docker image (already true for our daemon container).
- "dangerously" is in the flag name — pair with Docker isolation always.

**Effort:** ~1 day, slots into v2.5.4 work.

#### Strategy A — Anthropic SDK direct (alternative for headless or API-first setups)

`AnthropicSdkSpawnProvider` calls `@anthropic-ai/sdk` directly. Claude Code permission system never engages because we're not using Claude Code at all for the spawn.

Tool surface is explicit in the SDK call:

```typescript
const response = await anthropic.messages.create({
  model: agentConfig.model,
  tools: BUILTIN_AGENT_TOOLS,  // Read, Edit, Bash (with shell filter), Grep, etc.
  messages: [...],
});
```

**When to use:** running daemon on a server without Claude Code CLI installed; CI integrations; cost monitoring through Anthropic console rather than Claude Code subscription; needs explicit per-tool audit.

**Pros:** explicit tool surface, no Claude Code CLI dependency, separate Anthropic billing visibility, foundation for multi-model providers in P5.
**Cons:** requires `ANTHROPIC_API_KEY`; separate billing from Claude Code subscription; agent tools must be defined explicitly (more work than just inheriting Claude Code's defaults).
**Effort:** already counted in v2.5.4.

#### Strategy C — Pre-warmed allowlist + shuttle (alternative for paranoid users)

For users who want subprocess mode WITHOUT `--dangerously-skip-permissions` even with Docker isolation: daemon generates `~/.claude-pipeline/auto-settings.json` per task with computed allowlist and spawns Claude Code subprocess with `--settings <path>`.

**When to use:** belt-and-suspenders security in environments where Docker isolation is considered insufficient (e.g., shared CI runners).

**Pros:** controlled blast radius even inside the container.
**Cons:** allowlist is a guess; tasks needing unexpected commands halt; complexity.
**Effort:** ~1-2 days, can be added later if A+B insufficient.

#### Configuration

```typescript
// ClaudePipelineConfig
permission_strategy: {
  // Default for autonomous tasks (HTTP submission, CLI submission).
  default_autonomous: "subprocess-skip",  // (Strategy B)

  // Default for interactive tasks (Claude Code /task chat).
  // "shuttle" = inherits Claude Code's permission system (user clicks through).
  default_interactive: "shuttle",

  // Per-agent overrides.
  per_agent_overrides?: Record<string, "shuttle" | "subprocess-skip" | "anthropic-sdk" | "subprocess-allowlist">,

  // For Strategy C only.
  subprocess_allowlist?: string[],
}
```

Web UI Settings page surfaces this as a radio choice per mode (autonomous/interactive) + per-agent override grid. The default values above are pre-selected; user can change but the safe defaults assume Docker isolation is on.

### v2.5.8 — Worktree isolation

Each autonomous task runs in a `git worktree` isolated from the main working tree:

```
<repo>/
  .git/                                    # main git dir
  src/                                     # main branch checkout
  .claude-pipeline/worktrees/
    t-2026-05-13-feature-x/                # worktree for autonomous task
      src/                                 # isolated checkout of task branch
      .claude/                             # task-local state
```

`pipeline_init` accepts `isolation: "worktree" | "in-place"` (default `in-place` for backward compatibility with v2; `worktree` for autonomous submissions).

When task completes successfully, daemon either auto-merges to main (if config allows) or surfaces a "merge ready" notification.

**Pros:** multiple autonomous tasks run in parallel without branch conflicts; failed tasks discardable without affecting main.
**Cons:** worktree management adds complexity; merge conflicts on completion need handling.
**Effort:** ~2-3 days (was previously P2.5 in earlier draft; promoted here because autonomous mode needs it).

### v2.5 acceptance

1. `claude-pipeline daemon start` runs the daemon; `status` shows uptime + plugin counts.
2. `localhost:5173` (or chosen port) serves Web UI; Settings page reads and persists changes.
3. Per-agent model override in Web UI takes effect on next task spawn (proven by audit log).
4. Submitting a task via Web UI runs autonomously to completion; finding count + verdict appear in task detail view.
5. Same task submitted via Claude Code `/task` still works through shuttle (one daemon, two entry points).
6. SSE stream pushes live progress updates while a task runs.
7. SQLite contains `tasks`, `agent_configs`, `pipeline_config`, `plugins` tables; queryable via raw SQL for debugging.
8. At least one non-shuttle SpawnProvider works end-to-end (e.g., a task fully driven through `AnthropicSdkSpawnProvider`).
9. Auto-approve gate plugin lets tasks run unattended; notification fires on completion.

### v2.5 total effort

**~10-13 focused days of agent work** (or 2-2.5 weeks in comfortable pace with reviews). Could be 3-4 Claude Code sessions due to scope (grew from earlier ~7-10 estimate after adding permission strategy + worktree isolation as required-for-autonomy).

### Decision gates inside v2.5

- After v2.5.1 (daemon): does the daemon model feel right? If not, can fall back to per-invocation Node process. Skip v2.5.2+ if user finds daemon too heavy.
- After v2.5.4 (multi-provider): does provider switching actually help? If single provider (Claude Code) covers all needs, defer remaining providers indefinitely.
- After v2.5.5 (Web UI MVP): is the UI actually used vs `/task` in chat? If chat covers 90% of use, treat Web UI as read-only history viewer and stop adding write features.
- After v2.5.7 (permission strategy): which strategy gets the most use? If Strategy A dominates, can drop work on Strategy C.

---

## Phase v2.6 — Container isolation + Docker distribution

**Prerequisite:** v2.5 shipped (daemon + autonomous mode exist).
**Goal:** Docker isolation **is the default execution environment for autonomous tasks**, not opt-in. Ship daemon as Docker images. Per-task containers are spawned automatically. Combined with Strategy B (`--dangerously-skip-permissions` Claude Code subprocess), this gives ralphex-grade autonomy with stronger isolation than ralphex.

**Design philosophy:** `--dangerously-skip-permissions` is safe ONLY because Docker is the cage. The two defaults reinforce each other:
- Subprocess + skip-permissions → no permission prompts, fast execution, full agent capability.
- Docker container per task → blast radius is the ephemeral container, host filesystem untouched, network egress controlled.

Removing either one breaks the safety argument. Both must ship together as default.

Interactive mode (Claude Code chat `/task`) does NOT change — user is in the loop, no isolation needed by default, shuttle provider with normal permissions still works.

### v2.6.1 — Daemon-as-Docker-image

Build and publish Docker images:

```
ghcr.io/<org>/claude-pipeline:latest        # base — Node + daemon + MCP server
ghcr.io/<org>/claude-pipeline-ts:latest     # + TypeScript toolchain pre-installed
ghcr.io/<org>/claude-pipeline-py:latest     # + Python toolchain
ghcr.io/<org>/claude-pipeline-go:latest     # + Go toolchain
ghcr.io/<org>/claude-pipeline-flutter:latest # + Flutter SDK
```

Daemon listens on `:5173` (HTTP) inside the container; user maps to host port.

Standard run:

```bash
docker run -d \
  -p 5173:5173 \
  -v $HOME/projects:/projects \
  -v $HOME/.claude-pipeline:/data \
  -e ANTHROPIC_API_KEY=sk-... \
  ghcr.io/<org>/claude-pipeline-ts:latest
```

Docker Compose template included in `examples/` for common setups (with traefik for cleaner local URLs, with persistent SQLite volume, multi-project mount).

**Effort:** ~2 days. Dockerfile + GitHub Actions workflow for builds on tag.

### v2.6.2 — Per-task container isolation

Even when daemon runs on host, individual autonomous tasks can spawn in their own throwaway containers. New `ExecutionEnvironmentPlugin` (9th plugin type):

```typescript
export interface ExecutionEnvironmentPlugin extends PluginMeta {
  name: string;
  // Acquire an isolated working environment for one task.
  acquire(task: TaskHandle): Promise<{ workspace_path: string; cleanup: () => Promise<void> }>;
}
```

Built-in implementations:

- **`DockerContainerEnvironment`** (DEFAULT for autonomous tasks): spins up a fresh container per task. Volume-mounts a worktree as `/workspace`. Resource limits (CPU, memory) configurable. Network policy: default-deny outbound except `api.anthropic.com` + per-language package registries + git remotes. Container torn down after task finalizes (kept 60 min for inspection if task failed, configurable).
- **`InPlaceEnvironment`** (DEFAULT for interactive Claude Code chat tasks): uses `<project>/.claude-pipeline/worktrees/<task_id>/` from v2.5.8. No container — just git worktree on the host. Fast, no filesystem isolation. Safe because user is in the loop.
- **`FirecrackerEnvironment`** (P2 era — too heavy for v2.6): VM-level isolation. Skip for now.

Configuration with sane defaults:

```typescript
// ClaudePipelineConfig
execution_environment: {
  // Hardwired defaults reflecting the safety design:
  default_autonomous: "docker-container",   // mandatory isolation for unattended tasks
  default_interactive: "in-place",           // user-watched, no isolation needed

  docker: {
    image: "ghcr.io/<org>/claude-pipeline-ts:latest",  // matches detected project stack
    network: "allowlist",                    // default
    allowed_hosts: [
      "api.anthropic.com",
      "registry.npmjs.org",
      "pypi.org",
      "github.com",
      // + project's git remote auto-added
    ],
    cpu_limit: "1.0",
    memory_limit: "2g",
    keep_after_failure_minutes: 60,
    wall_time_limit_minutes: 120,
  },

  per_agent_overrides?: Record<string, "docker-container" | "in-place">,
}
```

Web UI Settings page exposes this but the defaults above are pre-selected. Changing `default_autonomous` away from `docker-container` shows a warning: *"Without container isolation, `--dangerously-skip-permissions` (Strategy B in permission settings) is unsafe. Consider switching permission strategy to Anthropic SDK (Strategy A) if you disable container isolation."*

**Effort:** ~3-4 days. Container lifecycle + network policy enforcement + volume mounts + cleanup.

### v2.6.3 — Network policy

Tasks executing in `DockerContainerEnvironment` get a default-deny network policy with a small allowlist:

- `api.anthropic.com` (always, for SDK provider)
- `registry.npmjs.org`, `pypi.org`, `proxy.golang.org`, etc. (per-language package managers)
- `github.com`, the project's git remote (for clone/push)

User can extend per-task or globally. Egress to anything else logged + denied. This protects against accidentally-malicious plugins or compromised dependencies trying to phone home.

Implementation: Docker network in `bridge` mode + iptables rules inside container, or external DNS+proxy. Start with iptables-in-container for simplicity.

**Effort:** ~2 days. Includes audit-log entries for each blocked egress attempt.

### v2.6.4 — Volume-mount strategy

Three tiers of access:

| Mount | Purpose | Default mode |
|-------|---------|--------------|
| `/workspace` | Worktree containing the actual code | rw |
| `/data` | Daemon's `~/.claude-pipeline/` | rw |
| `/secrets` | API keys, .env (only what task explicitly needs) | ro, via env injection |
| `/host` | Rest of host filesystem | NOT mounted by default |

Tasks NEVER see arbitrary host filesystem. `~/.ssh` etc. invisible unless user explicitly maps something.

If a task needs files outside the worktree (e.g., shared design system in a sibling dir), user must mount it explicitly.

**Effort:** ~1 day. Already mostly determined by the run script in v2.6.1; finalized here.

### v2.6.5 — Resource limits + escape valves

Per-task limits, enforced at container level:

- **CPU:** default `1.0` core; configurable per task or per agent.
- **Memory:** default `2GB`; configurable.
- **Disk:** default `5GB` ephemeral volume.
- **Wall time:** default `2 hours`; configurable. Hard kill on exceed (records `pipeline_violation: timeout`).
- **Network bandwidth:** optional rate limit (1 MB/s default).

If a task hits any limit, daemon surfaces it via SSE + audit log + notification. Recovery: same paths as other failures (Items 5 in v2 spec — abandon / force-close / retry).

**Effort:** ~1 day. Most of this is `docker run --cpus 1.0 --memory 2g` flags; some daemon-side enforcement for wall time.

### v2.6 total effort

**~9-11 focused days.** Could be 2 Claude Code sessions.

### v2.6 acceptance

1. `docker run ghcr.io/<org>/claude-pipeline-ts` starts a working daemon; Web UI accessible on mapped port.
2. **Autonomous tasks default to Docker container execution + Strategy B (subprocess-skip-permissions).** Verified: submit a task via HTTP without specifying environment → daemon spawns container + claude subprocess with skip-permissions → task completes → container torn down.
3. **Interactive tasks via Claude Code `/task` default to in-place + shuttle** (no container, normal permissions). Verified: same outcome as v2 when run through `/task`.
4. Disabling Docker default in Web UI shows the safety warning explaining the dependency on Strategy A.
5. Network policy blocks egress to non-allowlisted hosts; audit log records the attempt.
6. Wall-time timeout kills a runaway task; pipeline-state reflects timeout violation.
7. `--keep-container` flag preserves container for inspection after failure.
8. `ExecutionEnvironmentPlugin` is registered like other plugins; users can add custom environments without core changes.
9. Docker Compose template in `examples/` works end-to-end (daemon + persistent SQLite + multi-project mount).
10. Inside a v2.6 container, an agent doing `rm -rf /tmp/foo` only affects the container's `/tmp`, not the host (proves the isolation).

### v2.6 decision gates

- After v2.6.1 (daemon image): is anyone running the daemon-in-Docker? If only the author, the image is a distribution detail; per-task isolation (v2.6.2) is the main value.
- After v2.6.2 (per-task isolation): does container startup add significant latency? If >30s per task, consider container reuse (pool of warm containers) — separate optimization.

---

## Phase v2.7 — Cost-aware multi-provider routing

**Prerequisite:** v2.6 shipped (daemon + Docker isolation + at least Strategy A/B SpawnProviders).
**Goal:** make hybrid LLM routing economically viable. Premium models (Claude Opus/Sonnet) for quality-critical roles (planner, implementer, security). Cheap models (DeepSeek, Qwen via Ollama) for mechanical roles (style-reviewer, plan-conformance). Long-context models (Gemini 2.5 Pro) for diff-heavy roles (api-contract, ui-consistency). Cost tracking + budget caps so autonomous mode doesn't burn through money silently.

This phase is what makes autonomous mode **sustainable**. ~4-10× cost reduction on typical MEDIUM tasks while preserving quality on critical agents.

### Why now (before P1 open-source)

Once the tool is autonomous, the bill comes fast:
- Opus-only MEDIUM task: $8-15
- Sonnet-only: $3-5
- Tier-based hybrid: $1-2
- Hybrid with local Ollama for cheap tier: $0.5-1

For a personal tool used 5-10x/week → $50-150/month savings.
For any product use → the difference between viable and not.

### v2.7.1 — Additional SpawnProviderPlugins

Ship 5 more providers beyond v2.5's Anthropic SDK + Claude Code subprocess:

- **`OpenRouterSpawnProvider`** (RECOMMENDED for multi-provider users) — single API key, access to 200+ models (Anthropic, OpenAI, Google, DeepSeek, Mistral, Llama variants, etc.) via OpenAI-compatible API at `https://openrouter.ai/api/v1`. Eliminates need for separate provider integrations for 90% of users.
- **`OpenAiSpawnProvider`** — GPT-5.x via OpenAI Responses API directly. For users with existing OpenAI credits or who want direct billing.
- **`DeepSeekSpawnProvider`** — DeepSeek V3.x via DeepSeek's OpenAI-compatible API directly. For direct billing or when OpenRouter overhead matters.
- **`GeminiSpawnProvider`** — Gemini 2.5 Pro / Flash via Google AI Studio SDK directly. Special handling for huge context window (1M+ tokens).
- **`OllamaSpawnProvider`** — local models via Ollama HTTP API (`localhost:11434`). Auto-detects available models (`/api/tags`).

All cloud providers share a `BaseLLMSpawnProvider` abstract class (~150 LoC). Concrete adapters: OpenRouter and OpenAI essentially identical (different baseURL); DeepSeek = OpenAI with different baseURL; Gemini has its own SDK; Ollama uses fetch().

**Why OpenRouter as the recommended multi-provider entry point:**

| Aspect | Direct SDKs | OpenRouter |
|--------|-------------|------------|
| API keys to manage | 1 per provider | **1 total** |
| Billing dashboards | 1 per provider | **1 total** |
| Access to newly released models | Wait for SpawnProvider update | **Immediate** (change model string) |
| Auto-fallback on unavailable model | Manual | **Built-in** (`models: [...]` array) |
| Cost overhead | $0 | ~5-10% margin |
| Latency | Direct | One extra hop |
| OSS models (Llama, Qwen, etc.) | Need Ollama or Together/Groq | **Hosted natively** |

For users with high volume (>$50/mo on a single provider): direct SDK saves the OpenRouter margin. For everyone else: OpenRouter is the simpler choice.

**Recommended hybrid configuration** (subscription + OpenRouter + local):

```typescript
tiers: {
  // Subscription — $0 marginal cost
  premium:  { provider: "claude-code-subprocess", model: "claude-opus-4-7" },
  balanced: { provider: "claude-code-subprocess", model: "claude-sonnet-4-6" },

  // OpenRouter — one key, multiple models
  cheap:        { provider: "openrouter", model: "deepseek/deepseek-v3.2" },
  long_context: { provider: "openrouter", model: "google/gemini-2.5-pro" },

  // Local — free, requires GPU
  local: { provider: "ollama", model: "qwen3-coder:32b" },
}
```

**Effort:** ~3-4 days total. OpenRouter + OpenAI are essentially the same plugin (different baseURL); DeepSeek same again; only Gemini SDK and Ollama require unique code paths.

### v2.7.2 — Tier abstraction + routing decision

New config schema (lives in `ClaudePipelineConfig.routing`):

```typescript
type Tier =
  | "premium"      // Opus, GPT-5.5 Pro
  | "balanced"     // Sonnet, GPT-5.5
  | "cheap"        // DeepSeek V3, Qwen
  | "long_context" // Gemini 2.5 Pro
  | "local"        // Ollama local model
  | string;        // user-defined tier name

type TierConfig = {
  provider: string;          // SpawnProvider name
  model: string;             // model id
  max_tokens_per_spawn?: number;
  timeout_ms?: number;
};

type RoutingConfig = {
  tiers: Record<Tier, TierConfig>;
  agent_tiers: Record<string, Tier>;   // agent name → tier
  fallback_tier?: Tier;                 // when tier unreachable (e.g., Ollama down)
  cost_aware_downgrade?: {
    enabled: boolean;
    threshold_percent: number;          // 70% = downgrade tier when 70% of budget spent
    downgrade_map: Record<Tier, Tier>;  // premium → balanced, balanced → cheap, etc.
  };
};
```

New `DecisionPlugin<RouteSelection>` resolves an agent name + current state into `{provider, model}`:

```typescript
function decide({ agent, state, config }) {
  const tier = config.routing.agent_tiers[agent.name] ?? agent.default_tier ?? "balanced";

  // Cost-aware downgrade
  if (config.routing.cost_aware_downgrade?.enabled) {
    const spent_pct = state.task_costs.spent_usd / state.task_costs.limit_usd;
    if (spent_pct > config.routing.cost_aware_downgrade.threshold_percent / 100) {
      const downgraded = config.routing.cost_aware_downgrade.downgrade_map[tier];
      if (downgraded) tier = downgraded;
    }
  }

  return config.routing.tiers[tier];
}
```

Built-in default tiers + agent_tiers in `loaders/builtins.ts` reflecting the market reality (see preset below). User can override per-project via Web UI.

**Default preset (recommended starting point):**

```typescript
tiers: {
  premium:      { provider: "anthropic-sdk", model: "claude-opus-4-7" },
  balanced:     { provider: "anthropic-sdk", model: "claude-sonnet-4-6" },
  cheap:        { provider: "deepseek-sdk",  model: "deepseek-v3.2" },
  long_context: { provider: "gemini-sdk",    model: "gemini-2.5-pro" },
  local:        { provider: "ollama",        model: "qwen3-coder:32b" },
},
agent_tiers: {
  planner:               "balanced",     // quality matters
  implementer:           "balanced",
  architect:             "premium",
  logic-reviewer:        "balanced",
  challenger-reviewer:   "balanced",
  security:              "premium",
  performance:           "premium",
  style-reviewer:        "cheap",        // mechanical
  acceptance:            "cheap",
  plan-conformance:      "cheap",
  plan-grounding-check:  "cheap",
  context-doc-verifier:  "cheap",
  api-contract:          "long_context", // big diffs
  ui-consistency:        "long_context",
  research:              "balanced",
  migration:             "premium",
  code-analyzer:         "balanced",
  dependency-auditor:    "cheap",
  test:                  "balanced",
  playwright:            "balanced",
}
```

**Effort:** ~2 days.

### v2.7.3 — Cost tracking infrastructure

Already partly added in v2.5.2 (SQLite `spawn_costs` and `task_budgets` tables). v2.7.3 wires them up:

**HookPlugin: `costTrackingHook`** (event=`after-agent-result`):
- Receives spawn result with `usage: {input_tokens, output_tokens}` from the SpawnProvider.
- Looks up price per 1M tokens from `tiers` config (each TierConfig has `pricing: {input_per_1m_usd, output_per_1m_usd}`).
- Computes `est_cost_usd = (input_tokens / 1e6 * input_price) + (output_tokens / 1e6 * output_price)`.
- Appends to SQLite `spawn_costs` table.
- Updates `task_budgets.spent_usd` for the current task.

**HookPlugin: `budgetGuardHook`** (event=`before-agent-spawn`):
- Reads `task_budgets.spent_usd` and `limit_usd`.
- If `spent_usd >= limit_usd`: emit `status: "error"` with code `BUDGET_EXCEEDED`, recovery options `["raise-budget", "abandon", "downgrade-tier"]`.
- If `spent_usd >= 0.8 * limit_usd`: emit warning to audit log (no halt).

**MCP tools:**
- `pipeline_get_costs({task_id?, since?, group_by?})` → cost report (per task, per agent, per provider, per model).
- `pipeline_set_budget({task_id, limit_usd})` → set/update per-task budget.
- `pipeline_set_global_budget({limit_usd_per_day, limit_usd_per_month})` → global caps.

**Effort:** ~2 days.

### v2.7.4 — Cost dashboard in Web UI

New Web UI section (`/costs`):

- **Per-task cost breakdown:** waterfall chart showing each agent spawn with its cost.
- **Provider/model attribution:** pie chart — where the money goes.
- **Trend chart:** $/day, $/week over last N tasks.
- **Budget configuration:** per-task default budget, global daily/monthly caps.
- **Routing editor:** drag-and-drop matrix of [agent × tier]; preview cost estimate for a hypothetical MEDIUM task with current routing.

**Effort:** ~3-4 days.

### v2.7.5 — Local model integration (Ollama)

Special attention because local models have unique characteristics:

- Slower than cloud (no rate limits but limited by hardware).
- Free but capacity-constrained (one model at a time on consumer GPU; need queueing).
- Detection: daemon polls `localhost:11434/api/tags` on startup, auto-populates available models in Web UI.
- Fallback handling: if Ollama unreachable, fall back to `fallback_tier` (default: "cheap" → DeepSeek).

**Effort:** ~2 days. Mostly UX polish on top of v2.7.1's `OllamaSpawnProvider`.

### v2.7 total effort

**~10-13 days** focused work. Could be 2-3 Claude Code sessions.

### v2.7 acceptance

1. All 7 SpawnProvider plugins registered (`shuttle`, `claude-code-subprocess`, `anthropic-sdk`, `openrouter`, `openai-sdk`, `deepseek-sdk`, `gemini-sdk`, `ollama`).
2. Tier abstraction works end-to-end: changing `agent_tiers.style-reviewer` from "cheap" to "balanced" in Web UI causes next spawn of `style-reviewer` to use Claude Sonnet via `anthropic-sdk` provider (verified in audit log).
3. Cost tracking populates SQLite for every spawn; Web UI dashboard shows accurate per-task totals.
4. Setting `task_budget.limit_usd = 0.50` and running a task that would exceed it → driver halts at the spawn that would breach budget, surfaces error with recovery options.
5. Cost-aware downgrade works: when `spent_pct > 70%`, next spawn of a "premium" agent is automatically downgraded to "balanced" tier.
6. Ollama integration: with Ollama running locally and `qwen3-coder:32b` available, setting `agent_tiers.style-reviewer = "local"` routes that agent to local model; works offline.
7. Provider fallback: take Ollama down mid-task → next spawn requiring "local" tier falls back to `fallback_tier` and continues.
8. Cost dashboard shows ~80%+ correlation with actual provider billing (validated by cross-checking Anthropic console + DeepSeek dashboard at end of week).

### v2.7 decision gates

- After v2.7.1 (providers added): which providers does the user actually use? If only Anthropic + Ollama, defer OpenAI/Gemini work to P5 era.
- After v2.7.2 (tier routing): does the default preset hold up in practice? Re-tune based on real cost data after 2-4 weeks.
- After v2.7.5 (Ollama): is local model quality sufficient for "cheap" tier agents? If consistently producing junk findings, reroute "cheap" tier to DeepSeek cloud and demote local to opt-in only.

---

## Phase P1 — Open source + npm distribution

**Goal:** anyone with Claude Code can install in ≤5 minutes.

### P1.1 — Package as npm-installable CLI

- Restructure `mcp/` as the publishable npm package (`@claude-pipeline/mcp`).
- Add `bin/claude-pipeline` CLI with subcommands:
  - `init` — bootstrap a project (writes CLAUDE.md template, creates `.claude/`, registers MCP)
  - `mcp install` — register MCP server with Claude Code (`claude mcp add ...`)
  - `mcp upgrade` — pull latest, rebuild, re-register
  - `plugin list` — show built-in + project plugins
  - `plugin validate <path>` — typecheck and contract-validate a plugin file
  - `doctor` — diagnose installation problems
- `npx @claude-pipeline/init` quickstart (creates project skeleton + connects MCP).

### P1.2 — Hostable docs site

- Generate from existing `.md` files (mintlify / docusaurus).
- Required sections:
  - 5-minute quickstart (install → first `/task` → see findings)
  - Architecture diagram (cleaned-up version of the layered diagram from this spec)
  - Plugin authoring tutorial (build a custom reviewer in 15 min)
  - Recipes (common project setups: NestJS, Next.js, Flutter)
  - API reference (auto-generated from `types/plugin.ts`)
  - Troubleshooting / FAQ
- Domain: `claude-pipeline.dev` or similar.

### P1.3 — Open-source under Apache 2.0

- License headers.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates.
- Public GitHub release; GitHub Actions for releases.
- First semver-tagged release: `v2.0.0` (matches MCP `package.json`).

### P1.4 — Showcase repo

- A small but real public project (e.g. CRUD demo with auth) where the entire commit history was driven by `claude-pipeline`.
- Demonstrates: metrics dashboards, structured findings, past-misses evolution, plugin extensions.
- Embedded in docs as the "see it in action" tour.

**Phase P1 effort estimate:** 3–4 weeks of focused work. Solo or with one collaborator.

**Phase P1 success signal:** ≥50 GitHub stars in first 2 months, ≥5 external installations confirmed via telemetry opt-in.

---

## Phase P2 — Plugin distribution + trust model

**Goal:** third-party plugins can be installed safely.

### P2.1 — Plugin discovery

- Plugin registry conventions:
  - `<project>/.claude-pipeline/plugins/*.ts` — project-local plugins (TS, runtime compiled via `tsx`)
  - `~/.claude-pipeline/plugins/*` — user-global plugins
  - npm packages with `claude-pipeline-plugin` keyword → auto-discovered if installed
- Plugin loader (`loaders/project-config.ts` becomes real, not stub):
  - Scans the three locations above
  - Validates `PLUGIN_API_VERSION` compatibility
  - Registers plugins into PluginRegistry
  - Reports clear errors for malformed plugins

### P2.2 — Plugin manifest

Each plugin must export a `manifest`:

```typescript
export const manifest: PluginManifest = {
  name: "@author/accessibility-reviewer",
  version: "1.2.0",
  api_version: "1.0",
  capabilities: [
    "spawn-agent",            // can call SpawnProvider
    "read-state",             // can call pipeline_state_get
    "write-finding",          // can emit findings via record_agent_run
    // NOT: "write-state-directly", "execute-shell", "network-egress"
  ],
  trusted_paths: ["agents/accessibility-reviewer.md"],  // only files this plugin reads
};
```

### P2.3 — Capability-based sandbox

- Plugins run with restricted MCP-tool access based on declared capabilities.
- Plugin trying to call a tool outside its declared capabilities → blocked + audit-logged.
- Reviewer plugins can't accidentally call `pipeline_finish`.
- Shell access for plugins is opt-in via `execute-shell` capability; defaults off.

### P2.4 — Plugin signing (optional, but recommended)

- Plugin manifests can be signed (sigstore / minisign).
- Project config has `trust_unsigned: false` option.
- Plugin loader refuses unsigned plugins when `trust_unsigned: false`.

**Phase P2 effort:** 2–3 weeks.

**Phase P2 success signal:** ≥3 third-party plugins exist that aren't ours.

---

## Phase P3 — Team / collaboration features

**Goal:** small teams use `claude-pipeline` together.

### P3.1 — Shared past-misses

- Today: `agent-feedback.jsonl` is per-machine.
- New: opt-in sync to a team server (or git-hosted append-only log).
- Team members benefit from each other's reviewer-miss feedback.

### P3.2 — Team-level plugins

- Team config file (`team.claude-pipeline.config.ts`) sourced from a git repo.
- Members of a team automatically pull team plugins on first task.

### P3.3 — Shared metrics dashboard

- `~/.claude/metrics/pipeline.jsonl` lines can be pushed to a team aggregator.
- Web UI for browsing team metrics: pipeline durations, complexity distribution, reviewer accuracy over time, drift trends.

### P3.4 — Role-based access

- Project config can require certain reviewers for certain file paths.
  - "Auth code requires Security review by user X or one of {alice, bob}."
- Gates can pause for specific human approvers, not just any user.

**Phase P3 effort:** 4–6 weeks.

**Phase P3 success signal:** ≥1 team of 5+ developers actively using the tool together for ≥1 month.

---

## Phase P4 — Hosted tier (commercialization)

**Goal:** sustainable revenue model.

### P4.1 — Cloud audit + metrics

- Optional hosted backend (`claude-pipeline.dev/team/<id>`):
  - Stores audit logs, metrics, findings beyond local retention.
  - Web dashboards (pipeline runs, agent performance, finding categories over time).
  - Team plugin sharing.
- Tiers:
  - **Free**: 7-day retention, single user.
  - **Team** (~$15/user/mo): 90-day retention, team plugins, dashboards.
  - **Enterprise**: unlimited retention, SSO, audit export, custom SLAs.

### P4.2 — Plugin marketplace

- Curated registry of community plugins.
- Reputation/rating system.
- Signed plugins from trusted authors.
- Optional: paid plugins (revenue share with authors).

### P4.3 — Anthropic partnership story

- If Anthropic builds an official "agent orchestration framework", we either:
  - Position as the **production / observability layer** above their framework.
  - Get acqui-hired.
  - Pivot to multi-LLM support (Anthropic + OpenAI + open models).
- v2 SpawnProviderPlugin already abstracts this — we have optionality.

**Phase P4 effort:** 8–12 weeks for MVP hosted product.

**Phase P4 success signal:** ≥10 paying teams within 6 months of launch.

---

## Phase P5 — Editor integrations beyond Claude Code

**Goal:** run from environments other than Claude Code chat. Multi-LLM provider support lives in v2.7 (shipped before this phase).

### P5.1 — Editor integrations beyond Claude Code

- VS Code extension that exposes `/task` via command palette.
- JetBrains plugin.
- Both run the same TS driver under the hood.

**Phase P5 effort:** 6–8 weeks.

**Phase P5 success signal:** ≥30% of usage is outside Claude Code.

---

## Cross-cutting concerns (apply throughout all phases)

These are not phases themselves — they're standing concerns that need investment continuously.

### Security

- Plugin sandbox (Phase P2).
- Secrets handling — agent prompts must never see env vars or .env content unless explicitly requested.
- Audit log retention + privacy controls.
- SBOM for npm package.

### Performance

- Driver should add <500ms latency per FSM step.
- Audit log writes must not block tool returns.
- Plugin loading should be cached after first invocation.

### Observability

- Structured logging (pino) replacing ad-hoc console output.
- OpenTelemetry traces — agent spawns as spans.
- Health endpoint for hosted backend.

### Compatibility

- Each major v3.x can break plugin API ONLY on intentional version bump.
- Test matrix: Node 20, 22, 24 / macOS, Linux / Claude Code stable + beta.

### Localization

- Currently English-only. Russian / Spanish / Chinese docs would unlock entire user pools.
- Agent prompts may need locale-aware variants (e.g. Russian commits in Russian repos).

---

## Order of execution (recommended)

Strict prerequisite order, but each phase is independently shippable:

```
v2 hardening (specs/hardening-v2.md) ← currently being implemented
  │
  ▼
v2.5 (daemon + Web UI + multi-provider basics)  ← week 1-3
  │
  ▼
v2.6 (Docker isolation, default for autonomous mode)  ← week 4-5
  │
  ▼
v2.7 (cost-aware multi-provider routing + cost dashboard)  ← week 6-8
  │  ↑ critical for autonomous mode economics
  │
  ▼
P1 (open source + npm + docs site)  ← week 9-12; biggest external leverage
  │
  ├──▶ P2 (plugin distribution + trust)  ← week 13-15
  │
  └──▶ P3 (team features)  ← week 16-21
         │
         ▼
       P4 (hosted tier + commercialization)  ← month 6-9
         │
         ▼
       P5 (editor integrations: VSCode/JetBrains)  ← month 10+
```

**Total horizon:**
- ~5-6 weeks to first usable autonomous mode with Web UI (v2.5).
- ~10-12 weeks to a financially sustainable autonomous tool with cost controls (v2.7).
- ~6 months to product with paying customers (P4).
- ~3 months with one collaborator working in parallel.

**Why v2.7 before P1:** going public (P1) with a tool that burns through API budget without controls = bad first impression + unhappy users. Cost-aware routing is what makes external adoption viable.

---

## Out of scope for this roadmap

- AI/ML for plugin recommendations ("you should add a Security reviewer based on diff patterns") — interesting but not core differentiation.
- Visual flow editor — niche. CLI/IDE-first audience.
- Mobile-first interface — not a fit for the user audience.

---

## Decision gates between phases

Don't progress to next phase unless prior phase signals:

| Phase | Signal to proceed | Signal to pause |
|-------|-------------------|------------------|
| P1 → P2 | ≥50 stars, ≥5 confirmed external users | <10 stars after 2 months → revisit positioning |
| P2 → P3 | ≥3 third-party plugins exist | No external interest in plugins → pivot to vertical-specific tooling |
| P3 → P4 | ≥1 team of 5+ actively using | Teams reject the workflow → simplify before scaling |
| P4 → P5 | ≥10 paying customers | <3 paying after 6 months → close hosted tier, stay OSS |

Each gate is a real decision point, not a celebration. Bail out is a valid option at every level.

---

## What this roadmap does NOT promise

- That the project should become commercial. Stay personal tooling forever is a legitimate choice.
- That timelines are accurate. They're starting estimates; multiply by 2-3x in practice.
- That competition won't catch up. Anthropic or a well-funded startup could ship something similar. The differentiators are: observability, self-improvement loop, plugin framework, audit discipline.
- That the user must follow this roadmap. It's one possible path. Skip any phase if it doesn't fit your goals.

---

## Concrete next step (when v2 ships)

Pick one of these to start P1:

1. **P1.1 — npm packaging** (3–4 days). Lowest effort, biggest UX win. Even before docs site.
2. **P1.4 — showcase repo** (1 week). Builds external evidence the tool works. Required for P1.2 to be credible.
3. **P1.2 — docs site** (1–2 weeks). Heavy effort but unlocks all downstream marketing.

Recommended start: **P1.1 + P1.4 in parallel**. Then P1.2. P1.3 (open source) happens implicitly along the way (license + README polish).

---

## Competitive analysis: ralphex (umputun/ralphex)

A Go-based autonomous executor for markdown plans with checkboxes. Different shape (subprocess-orchestrates-Claude-Code vs our native MCP integration), but several features worth porting once v2 ships. None of these require changes to the v2 spec — they all sit on top of the plugin framework.

### Features worth incorporating

#### P1.5 — `--dry-run` mode

ralphex has a `--dry-run` flag that previews what would happen without executing.

In our model: implement as `DryRunSpawnProvider` (alternative `SpawnProviderPlugin`) that logs every intended spawn + agent prompt to stdout but never invokes Claude. Driver state machine still runs through all transitions, gates auto-approve, no real agent work.

**Use cases:**
- Debug plugin behavior without burning API tokens.
- Predict what a complex task will do before committing.
- Onboarding/demos.

**Effort:** 2–3 days. Pure plugin addition, zero core changes. Slots into P1 alongside npm packaging.

#### P1.6 — Brew formula + Docker images

ralphex ships `brew install umputun/apps/ralphex`, `go install`, and Docker images (`ghcr.io/umputun/ralphex:latest`).

Equivalent for us:
- `brew install teaarte/tap/claude-pipeline`
- `ghcr.io/<org>/claude-pipeline:latest` (Node-based image with pre-built MCP)
- `ghcr.io/<org>/claude-pipeline-typescript:latest` and variants for stack-specific tooling baked in

**Effort:** 1 week. Parallel to P1.1 npm packaging.

#### P1.7 — Autonomous mode (no gates)

ralphex has zero human-in-the-loop by design. We have 3 gates by default. Add a `--auto` (or `headless` config option) that auto-approves gates after presenting their content to the audit log.

In our model: register an `AutoApprovingGateOverride` hook that satisfies `ask-user` responses programmatically. Or a new `GatePlugin` variant: `autoApproveGate0/1/2`.

**Use cases:**
- Overnight runs of long task lists.
- CI integration: run pipeline as part of automated PR validation.
- Power-user workflows trusting the planner output.

**Risk:** loses one of our quality differentiators. Should be opt-in per task, not a default. Audit log + summary email at completion mitigates.

**Effort:** 3–5 days. Plugin-only addition.

#### P2.5 — Worktree-isolated parallel pipelines

ralphex runs multiple plans in parallel via `git worktree`-isolated directories under `.ralphex/worktrees/<branch>`. We currently assume one pipeline per project.

In our model: add `pipeline_init` option `isolation: "worktree" | "in-place"` (default in-place). Worktree mode:
- Creates `.claude-pipeline/worktrees/<task_id>/` git worktree.
- All state files + agent work happens inside the worktree.
- `/done` merges back to source branch (with conflict surfacing).

**Use cases:**
- Run 3 tasks in parallel against the same repo (e.g., "refactor X", "add Y", "fix Z").
- Isolate experimental tasks that may need to be discarded.

**Effort:** 1–2 weeks. Touches initialization + cleanup paths but not core FSM.

#### P3.5 — Plan-as-markdown input flow

ralphex's primary input is a markdown plan with task checkboxes. Each `### Task N: ...` with `[ ]` runs in a fresh session, marked `[x]` on success.

Different from our flow (planner agent creates plan inside the pipeline), but legitimate alternative when the user already has a plan. Implement as a new `FlowPlugin`:

```typescript
export const executePlanFlow: FlowPlugin = {
  name: "execute-plan",
  complexity: "custom-execute-plan",
  steps: [
    "read-plan-file",       // parses markdown checkboxes
    "execute-next-task",    // spawns implementer for each unchecked
    "review-task",          // mini-review per task
    "mark-complete",        // [x] in the plan file
    "loop-or-finalize",
  ],
};
```

Routed via a new decision: `complexity == "execute-plan"` when user invokes `/task --plan path/to/plan.md`.

**Use cases:**
- Long plans drafted in advance, executed unattended.
- Reproducible task lists (e.g., "implement these 8 acceptance criteria from the spec").

**Effort:** 2 weeks. Pure plugin addition.

#### P4.5 — Real-time web dashboard with SSE

ralphex has a web dashboard that streams execution progress via Server-Sent Events. Powerful for visibility.

For us: web UI reading audit log + driver state in real time. Component of hosted tier (P4) but a local-only version could exist earlier as part of `claude-pipeline doctor` UX.

**Local version (P2 era):** `claude-pipeline watch` opens a local HTTP server on `:3000` reading `mcp-audit.jsonl` and showing live state.

**Hosted version (P4):** team-wide dashboard, multi-project view, historical metrics.

**Effort:** 1 week local, 4 weeks hosted.

#### P5.5 — External LLM provider integrations

ralphex bridges Codex, Copilot, Gemini via wrapper scripts that translate to Claude-compatible stream-json.

For us: implement as `SpawnProviderPlugin` variants:
- `OpenAISpawnProvider` — direct OpenAI Responses API
- `GeminiSpawnProvider` — Google Gemini
- `OllamaSpawnProvider` — local LLMs
- `MultiProviderSpawnProvider` — routes per-agent based on declared model preference

**Effort:** 1 week per provider after the first (the first one establishes the abstraction).

#### P2.6 — Stalemate / patience detection

ralphex has `--review-patience` that bails out of infinite review loops when agents keep disagreeing. We have iteration-counter limits but no explicit stalemate concept.

In our model: extend iterate step (`builtin/steps/iterate.ts`) with stalemate detection:
- Track whether the same blocking-finding category keeps reappearing across iterations.
- After N consecutive same-category iterations → emit `status: "ask-user"` with the loop description and recovery options.

**Effort:** 1–2 days. Pure step logic.

#### P2.7 — Config hierarchy (CLI flags > local > global > embedded)

ralphex resolves config from: CLI flags > local `.ralphex/config` > global `~/.config/ralphex/config` > embedded defaults.

We currently spread config across `~/.claude/settings.json`, scattered per-tool defaults. Standardize:

```
1. Driver invocation args (passed via pipeline_run_task)
2. Project: <project>/.claude-pipeline/config.{ts,json}
3. User global: ~/.claude-pipeline/config.{ts,json}
4. Embedded defaults in plugin code
```

`loaders/project-config.ts` (today a stub) becomes the canonical resolver.

**Effort:** 3–4 days. Plugin-only — touches the loader, not core.

### Summary table

| Inspired feature | Phase placement | Effort | Touches core? |
|------------------|------------------|--------|---------------|
| `--dry-run` mode | P1.5 | 2–3 days | No |
| Brew + Docker distribution | P1.6 | 1 week | No |
| Autonomous (no-gates) mode | P1.7 | 3–5 days | No |
| Worktree isolation | P2.5 | 1–2 weeks | Touches init |
| Plan-as-markdown input flow | P3.5 | 2 weeks | No |
| Real-time web dashboard | P4.5 (local: P2 era) | 1 wk local / 4 wk hosted | No |
| Multi-provider spawn | P5.5 | 1 week per provider | No |
| Stalemate detection | P2.6 | 1–2 days | No |
| Config hierarchy | P2.7 | 3–4 days | No |

**Architectural insight from this analysis:** the v2 plugin framework holds up. Every feature ralphex has that we'd want can be added as plugins without touching `mcp/src/driver/core/`. That's the framework working as intended.

### What we deliberately do NOT copy from ralphex

- **Full autonomy as default** — our Human Gates are a quality differentiator; opt-in `--auto` is the right balance.
- **Subprocess-Claude-Code architecture** — couples us to CLI behavior; MCP integration is cleaner and gives us the audit/invariant story.
- **Markdown-as-state** — checkbox files are human-friendly but lose typed structure; we keep JSON + schemas as canonical.
- **Per-task fresh sessions** — context degradation isn't our top problem (file-pointer mode + driver-managed state handles it).

ralphex and claude-pipeline target different audiences:
- ralphex: "I have a long plan, just execute it overnight."
- claude-pipeline: "Drive this complex task with feedback at key gates and audit afterwards."

Both valid. The `execute-plan` flow (P3.5) is the version of "ralphex inside claude-pipeline" if/when demand arises.
