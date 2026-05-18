# Claude Pipeline

Multi-agent development pipeline for Claude Code. Form a team of specialized AI agents — planner, reviewers (logic + challenger + style + security + performance), test-writer, acceptance — and let them work through a task together with human gates at key decision points.

**Current state:** v2.2a shipped. TypeScript plugin framework, 21 MCP tools, 12 state invariants, 343 tests, 5-reviewer fan-out active on non-simple flows. Audit trail + guard hook + cross-session recovery + schema-validated state. Production-tested on 5 real-task runs.

## Releases

| Tag | What | Merged |
|---|---|---|
| [`v2.0`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.0) | TypeScript plugin framework, 7 plugin contracts, INV_001-011, guard hook, audit log | 2026-05-13 |
| [`v2.1`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.1) | 11 validation-driven fixes (Q8/Q11/Q14/Q17-Q24/Q36) from real-task signal | 2026-05-14 |
| [`v2.2`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2) | Schema hygiene + polish (10 Q-items) | 2026-05-14 |
| [`v2.2a`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2a) | Review surface unlock — Q9 wiring fix + Q27/Q30/Q41/Q42/Q43 | 2026-05-14 |

Roadmap: [`specs/v3-productization-roadmap.md`](specs/v3-productization-roadmap.md) → v2.3 daemon + Web UI is next.

## Quick start

```bash
# 1. Clone + install MCP server
git clone <repo-url>
cd claude-pipeline
cd mcp && pnpm install && pnpm build && cd ..

# 2. Symlink commands, agents, templates into ~/.claude/
ln -sf "$(pwd)/agents"    ~/.claude/agents
ln -sf "$(pwd)/commands"  ~/.claude/commands
ln -sf "$(pwd)/templates" ~/.claude/templates

# 3. Register MCP server with Claude Code
claude mcp add --scope user claude-pipeline -- node "$(pwd)/mcp/dist/server.js"

# 4. Install hooks (PreToolUse guard + Stop tracker)
mkdir -p ~/.claude/hooks
ln -sfn "$(pwd)/hooks/pipeline-guard.sh" ~/.claude/hooks/pipeline-guard.sh
ln -sfn "$(pwd)/hooks/pipeline-stop.sh"  ~/.claude/hooks/pipeline-stop.sh
# Merge PreToolUse + Stop fragments from settings.reference.json
# into ~/.claude/settings.json — see hooks/README.md

# 5. Verify install
claude mcp list                       # claude-pipeline ✓ Connected
/validate-pipeline                    # self-test, should PASS
```

In any project:
```bash
cd your-project/
/init-claudemd                        # generate CLAUDE.md
/task <description of your task>      # let the team go
```

See [`WORKFLOW.md`](WORKFLOW.md) for daily-use patterns.

## What's in the box

### Commands (16)

**Core workflow:**
- `/task <description>` — full pipeline, auto-classifies complexity
- `/quick <description>` — obvious change, skip ceremony (1-3 files)
- `/task-continue` — resume after session break or Gate feedback
- `/done` — finalize: validate, write metrics, clean `.claude/`

**Review & quality:**
- `/code-review` — 5-agent parallel review on current changes
- `/sweep [filter]` — review and fix accumulated tech debt
- `/validate-pipeline` — self-test pipeline config integrity
- `/validate-claudemd` — audit CLAUDE.md for completeness

**Feedback & metrics:**
- `/metrics-report` — human-readable pipeline-performance summary
- `/agent-feedback` — log a reviewer miss (auto-injected into future runs via past-misses)
- `/learn` — cluster findings × category, detect drift, suggest vocab updates

**Design & debug:**
- `/brainstorm <topic>` — design feature or pick a library
- `/debug-team <bug>` — competing hypotheses for hard bugs

**Project setup:**
- `/init-claudemd` — generate CLAUDE.md for new project
- `/init-kb <path>` — Knowledge Base entries from existing repo
- `/init-kb-contracts <path>` — cross-project API contract docs

### Agents (23)

Reviewers/validators (output JSON header validated against schemas):
- **logic-reviewer** + **challenger-reviewer** — independent perspectives on the same diff
- **style-reviewer** — CLAUDE.md anti-patterns
- **security-frontend** / **security-backend** — XSS, auth, injection, etc.
- **performance-react** / **performance-nestjs** / **performance-python** / **performance-flutter**
- **plan-grounding-check** — verifies plan citations against actual code
- **plan-conformance** — post-impl: drift, unfinished steps, AC coverage
- **acceptance** — mechanical AC checks (lint/typecheck/test/build)
- **context-doc-verifier** — sanity-checks code-analyzer claims

Non-review:
- **planner**, **implementer**, **architect** — produce artifacts
- **code-analyzer** — context-doc + analyzer-claims
- **research**, **migration**, **dependency-auditor**, **test**

Each agent is a markdown template in `agents/`. 25 senior-pattern reference files in `agents/references/` (with YAML frontmatter for LLM-driven selection).

### MCP tools (21)

State, spawn-record, driver, recovery, metrics, past-misses, meta. Full reference: [`mcp/README.md`](mcp/README.md).

Key tools:
- `pipeline_run_task` / `pipeline_continue_task` — driver entry / resume
- `pipeline_init` / `pipeline_finish` / `pipeline_done_cleanup` — task lifecycle
- `pipeline_record_agent_run` — parse agent output, validate, append findings
- `pipeline_validate` — run all 12 invariants
- `pipeline_unlock_writes` / `pipeline_relock_writes` — TTL-bounded guard bypass for recovery
- `pipeline_abandon` / `pipeline_fix_task_id` / `pipeline_cancel_spawn` — recovery primitives

## Architecture at a glance

```
┌────────────────────────────────────────────────────────┐
│  Claude Code  (chat UI)                                │
│  ↓ /task <description>                                 │
│  ↓ commands/task.md (≤30-line shuttle)                 │
└────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────┐
│  MCP server  (TypeScript, stdio transport)             │
│  ─ 21 tools, 12 invariants (INV_001-012)               │
│  ─ Plugin framework: 7 contracts (Step / Agent /       │
│    Flow / Gate / Decision / Hook / SpawnProvider)      │
│  ─ FSM driver (core has zero plugin-name references)   │
│  ─ Audit log (per-project + global, redacted)          │
└────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────┐
│  Code bundle plugins (mcp/src/driver/bundles/code/)    │
│  agents (23) · steps (~17) · flows (3) · gates (3)    │
│  decisions (6) · hooks (4) · spawn provider (shuttle)  │
└────────────────────────────────────────────────────────┘
                       ↓ shuttle response
┌────────────────────────────────────────────────────────┐
│  Claude Code  spawns subagents via Task tool           │
│  Subagents read agent template + context + refs        │
│  Output flows back via pipeline_continue_task          │
└────────────────────────────────────────────────────────┘

Cross-cutting:
  hooks/pipeline-guard.sh   PreToolUse — blocks raw writes to .claude/ MCP-managed files
  hooks/pipeline-stop.sh    Stop — tracks tri-state (in-flight / gate-paused / accept-pending)
```

Two state files per project under `<project>/.claude/`:
- `pipeline-state.json` — canonical state, schema-validated, MCP-mutated only
- `driver-state.json` — FSM scratchpad with `step_index`, `pending_spawns`, `pending_user_answer`

`.claude/findings.jsonl` collects every structured finding emitted by reviewers. `.claude/mcp-audit.jsonl` traces every MCP tool call. Cross-project metrics in `~/.claude/metrics/{pipeline,agent-feedback,mcp-audit}.jsonl`.

## Documentation

| Doc | What | When to read |
|---|---|---|
| [`README.md`](README.md) | This file — overview + install | First contact |
| [`WORKFLOW.md`](WORKFLOW.md) | Daily usage patterns, command-choice flowchart | First `/task` |
| [`mcp/README.md`](mcp/README.md) | MCP tool reference (21 tools) + invariants (INV_001-012) | When debugging state |
| [`hooks/README.md`](hooks/README.md) | Guard hook + Stop hook install + bypass mechanics | When customizing or escape-hatching |
| [`specs/product-vision.md`](specs/product-vision.md) | Product positioning — "AI Team RTS", target users, pricing tiers, commercial trajectory | When thinking about the bigger picture |
| [`specs/ui-vision.md`](specs/ui-vision.md) | 6-layer UX architecture: agent builder → specialist → team → curator → channels + console + 3 operating modes | When planning v2.3 daemon UX |
| [`specs/v3-productization-roadmap.md`](specs/v3-productization-roadmap.md) | Phase index → links to phase plans | When picking next bundle |
| [`specs/phases/`](specs/phases/) | Detailed plans per phase (v2.3 / v2.4 / v2.5 / v2.6 / far-future) | When executing a phase |
| [`specs/open-backlog.md`](specs/open-backlog.md) | Currently open + deferred + code-polish Q-items | When picking next fix |
| [`specs/closed-q-items.md`](specs/closed-q-items.md) | Historical record of 30 closed Q-items by bundle | When recurrence-checking |
| [`validation-log.md`](validation-log.md) | Validation workflow + cross-cutting observations + closed-task index | When running real-task validation |
| [`validation/closed-tasks/`](validation/closed-tasks/) | Per-task validation entries (5 files, growing) | When studying past runs |
| [`specs/done/`](specs/done/) | Archived launcher prompts (v2.1, v2.2, v2.2a) | When learning the bundle pattern |

## Self-improvement loop

Every reviewer emits structured findings (schema-validated). Misses are logged via `/agent-feedback` with category + pattern. Future runs auto-load the last 10 confirmed past-misses per agent. `/learn` clusters by category, detects drift, suggests vocab promotions. Source-of-truth files:

- `~/.claude/metrics/pipeline.jsonl` — one row per task (post-`/done`), 18+ fields
- `~/.claude/metrics/agent-feedback.jsonl` — one row per logged miss
- `~/.claude/metrics/mcp-audit.jsonl` — global audit (redacted project_dir, capped 10k)

5 real-task runs to date all on s3-panel (TypeScript pnpm monorepo). Second-project validation pending — see [`specs/v3-productization-roadmap.md`](specs/v3-productization-roadmap.md) "Concrete next step".

## Model routing

Canonical table in `commands/task.md`. Simplified view:

| Agent | SIMPLE / MEDIUM | COMPLEX |
|---|:-:|:-:|
| planner, implementer, logic-reviewer, challenger | opus | opus |
| architect, research, migration | opus | opus |
| code-analyzer, security, performance | sonnet | **opus** |
| acceptance, plan-conformance, plan-grounding-check, style | **haiku** | sonnet |

Multi-provider routing (cost-aware) is v2.5 territory — see [`specs/phases/v2.5-multiprovider.md`](specs/phases/v2.5-multiprovider.md). Until then, default per-agent.

## File structure

```
claude-pipeline/
├── README.md                this file
├── WORKFLOW.md              daily-usage guide
├── validation-log.md        validation workflow + cross-cutting observations
├── agents/                  23 agent prompt templates
│   └── references/          25 senior-pattern refs (YAML frontmatter + content)
├── commands/                16 slash commands (task.md is a ≤30-line shuttle)
├── templates/
│   ├── schemas/             JSON Schemas — finding, reviewer/validator output, state, vocab
│   └── pipeline-state.json  initial state template
├── mcp/                     MCP server (TypeScript, stdio)
│   ├── src/
│   │   ├── tools/           21 MCP tool implementations
│   │   ├── lib/             schemas, ids, audit, parse-frontmatter, etc.
│   │   └── driver/          v2 plugin framework
│   │       ├── types/       7 plugin contracts
│   │       ├── core/        FSM + registry + shuttle (zero plugin-name refs — grep-gated)
│   │       ├── builtin/     all built-in plugins (steps, agents, flows, gates, decisions, hooks, spawn)
│   │       └── loaders/     builtins.ts + project-config.ts
│   ├── test/                343 tests across 45 files
│   └── README.md            tool reference + invariants
├── hooks/
│   ├── pipeline-guard.sh    PreToolUse — protects .claude/ state files (20+ evasion patterns)
│   ├── pipeline-stop.sh     Stop — tri-state (in-flight / gate-paused / accept-pending)
│   └── README.md            install + bypass mechanics
├── metrics/                 (per-machine; copied to ~/.claude/metrics on install)
├── specs/
│   ├── product-vision.md          positioning + commercial trajectory
│   ├── ui-vision.md               UX architecture (6 layers + 3 modes)
│   ├── v3-productization-roadmap.md  phase index
│   ├── open-backlog.md            active Q-items
│   ├── closed-q-items.md          historical Q-items by bundle
│   ├── phases/                    detailed per-phase plans
│   └── done/                      archived launcher prompts
├── validation/
│   └── closed-tasks/        per-task entries (newest-first)
├── tests/
│   └── guard-evasion/       20 guard hook evasion fixtures (all blocked)
└── settings.reference.json  hooks fragment to merge into ~/.claude/settings.json
```

## Extension model

Adding a new reviewer:
1. Create `agents/my-reviewer.md` (prompt template — role + checklist + JSON output schema).
2. Create `mcp/src/driver/builtin/agents/my-reviewer.ts` (~5 lines — AgentPlugin meta: name, model, template_path, applies_to).
3. Register in `mcp/src/driver/loaders/builtins.ts` (1 line).

Core is **never** touched. `grep -rEi "planner|implementer|logic-reviewer|gate-[012]" mcp/src/driver/core/` returns zero matches — this is enforced as a build gate.

Plugin framework supports 7 contracts. Adding a new LLM provider = new `SpawnProviderPlugin` (Anthropic SDK direct, Ollama, OpenAI, etc.). Adding a new task trigger source (Jira/Slack/etc.) = new `TriggerSourcePlugin` (planned for v2.6, see [`specs/ui-vision.md`](specs/ui-vision.md)).

Domain bundles (photo / video / research / VFX) are forward-compat via `PluginMeta.domain` field — see [`specs/open-backlog.md`](specs/open-backlog.md) Q40.

## Requirements

- Claude Code CLI
- Node 20+ and pnpm (for MCP server)
- `jq`, `git`, standard Unix toolchain (macOS / Linux / WSL)
- Recommended: [RTK](https://github.com/rtk-ai/rtk) (60-90% CLI token savings)

## License

MIT. See [LICENSE](LICENSE) (if present).
