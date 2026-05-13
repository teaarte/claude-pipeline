# v3 Productization Roadmap

**Status:** strategic — not committed
**Prerequisite:** v2 hardening shipped (`specs/hardening-v2.md` complete)
**Purpose:** convert `claude-pipeline` from personal tooling into a usable product. Each phase is independently shippable.

This document is **strategic, not tactical**. Each phase here gets its own detailed spec when it's time to execute. Phases are sized in days/weeks of focused work, not specific commits.

---

## Where v2 leaves us

After v2 hardening ships, `claude-pipeline` has:

- Plugin framework architecture (`StepPlugin`, `AgentPlugin`, `FlowPlugin`, `GatePlugin`, `DecisionPlugin`, `HookPlugin`, `SpawnProviderPlugin`)
- 7 built-in plugins of each type
- MCP-enforced state invariants (`INV_001`–`INV_012`)
- Audit log (per-project + global)
- 17 MCP tools
- Test infrastructure (vitest + property-based + CI)
- Protocol versioning (`PLUGIN_API_VERSION = "1.0"`, `mcp/package.json 2.0.0`)
- Recovery paths (`pipeline_abandon`, `pipeline_cancel_spawn`, `pipeline_unlock_writes`)

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

## Phase P5 — Multi-harness portability

**Goal:** run outside Claude Code.

### P5.1 — Direct SDK spawn provider

- Ship `builtin/spawn/direct-sdk-provider.ts` that uses Anthropic SDK directly.
- CLI mode: `claude-pipeline run "task description"` — fully standalone, no Claude Code.
- Same plugins work; only the spawn mechanism differs.

### P5.2 — Multi-model support

- New `LLMClient` interface (above SpawnProvider).
- Ship clients for: Anthropic, OpenAI (Responses API), Google Gemini, open models via OpenRouter, local Ollama.
- Per-agent model preferences become abstract: "fast" / "balanced" / "deep" — mapped to provider-specific models.

### P5.3 — Editor integrations beyond Claude Code

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
v2 hardening (specs/hardening-v2.md) ← required first
  │
  ▼
P1 (open source + npm + docs site)  ← biggest leverage; week 1-4
  │
  ├──▶ P2 (plugin distribution + trust)  ← unlocks ecosystem; week 5-7
  │
  └──▶ P3 (team features)  ← unlocks paid customers; week 8-13
         │
         ▼
       P4 (hosted tier + commercialization)  ← month 4-6
         │
         ▼
       P5 (multi-harness)  ← month 7+ if data supports
```

**Total horizon:** ~6 months solo to reach product with paying customers. ~3 months with one collaborator.

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
