# Claude Pipeline

Multi-agent development pipeline for Claude Code. Form a team of specialized AI agents — planner, reviewers (logic + challenger + style + security + performance), test-writer, acceptance — and let them work through a task together with human gates at key decision points.

**Current state:** **v2.2.7 shipped**. TypeScript plugin framework, **21 MCP tools**, 13 state invariants (INV_001-013), **569 tests**, 5-reviewer fan-out active on non-simple flows. Classifier-agent auto-spawns in the context phase and populates LLM-derived decisions (`refs_to_load` / `security_needed` / `task_short` / `antipattern_rules_applicable` / `stack` / `change_kind`). Reviewer selectivity by `change_kind` skips style + performance on type-only / docs-only diffs. Runner-agnostic `SpawnRequest` shape (`runner_hint` field) unbinds pipeline core from Claude Code Task-tool names — direct prep for v2.3 daemon + Cursor / Codex adapters. Planning-phase reviewers fan out in parallel (~30-60s saved per medium/complex task). Gate-1 auto-derives "Suggested revision" from reviewer findings with one-keypress apply; opt-in capped auto-replan loop for blocking findings. INV_013 refuses `acceptance: PASS` when impl-phase reviewers still have open blockers. Gate-2 reject now distinguishes revise vs abandon; FINALIZE throws when `verdict` is null. **10 real-task validation runs** to date (s3-panel + wandr-be + frontend-core).

## Releases

| Tag | What | Merged |
|---|---|---|
| [`v2.0`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.0) | TypeScript plugin framework, 7 plugin contracts, INV_001-011, guard hook, audit log | 2026-05-13 |
| [`v2.1`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.1) | 11 validation-driven fixes (Q8/Q11/Q14/Q17-Q24/Q36) from real-task signal | 2026-05-14 |
| [`v2.2`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2) | Schema hygiene + polish (10 Q-items) | 2026-05-14 |
| [`v2.2a`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2a) | Review surface unlock — Q9 wiring fix + Q27/Q30/Q41/Q42/Q43 | 2026-05-14 |
| [`v2.2.5`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2.5) | Bundle abstraction first-class + classifier substrate + structured gate-answer + metric-row observability (Q40/Q41 partial/Q44/Q45/Q46/Q47/Q48/Q50/Q51/Q55/Q57/Q58/Q59/Q60/Q61) + post-review followups bundle | 2026-05-18 |
| [`v2.2.6`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2.6) | Stack-classifier candidate registry + classifier-output schema substrate + `<!-- validation-commands -->` marker + canonical task_id propagation + Q63 auto-close validation/final + Q64 cross-session ownership safety | 2026-05-18 |
| [`v2.2.7`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2.7) | Classifier auto-spawn + reviewer selectivity by `change_kind` + generic `SpawnRequest` (Q65) + configurable project subdir (Q66) + planning-phase parallel fan-out (Q67) + INV_013 acceptance gate (Q68) + auto-derived gate-1 feedback (Q69) + opt-in auto-replan (Q70) + gate-2 reject FSM fix (Q74 CRITICAL) + Q71/Q72/Q73/D3/D10 | 2026-05-19 |

Roadmap: [`specs/v3-productization-roadmap.md`](specs/v3-productization-roadmap.md) → next is **v2.3 daemon + Web UI** (`AnthropicSdkSpawnProvider` is direct beneficiary of v2.2.7 D4's runner-agnostic `SpawnRequest`).

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

### Agents (21 pipeline + 3 wrapper utilities)

Reviewers/validators (output JSON header validated against schemas; v2.2.7 added `relevant_for_change_kinds?: string[]` to skip irrelevant reviewers on type-only / docs-only diffs):
- **logic-reviewer** + **challenger-reviewer** — independent perspectives on the same diff (no change_kind filter — always relevant)
- **style-reviewer** — CLAUDE.md anti-patterns (skipped on type-only / docs-only / config-only)
- **security** — XSS, auth, injection, etc.
- **performance** — hot paths, caching, query shape, render perf (skipped on type-only / docs-only / config-only)
- **plan-grounding-check** — verifies plan citations against actual code
- **plan-conformance** — post-impl: drift, unfinished steps, AC coverage
- **acceptance** — mechanical AC checks (lint/typecheck/test/build); v2.2.7 INV_013 refuses PASS when impl-phase reviewers still have open blockers
- **context-doc-verifier** — sanity-checks code-analyzer claims
- **api-contract**, **playwright**, **ui-consistency** — domain-specific validators

Non-review:
- **planner**, **implementer**, **architect** — produce artifacts
- **classifier** — context-phase agent: emits structured JSON (`refs_to_load`, `security_needed`, `task_short`, `antipattern_rules_applicable`, `stack`, `change_kind`). Auto-spawns in `CLASSIFY_AGENT` step (v2.2.7 D1); output parsed by the `extract-classifier-output` hook
- **code-analyzer** — context-doc + analyzer-claims
- **research**, **migration**, **dependency-auditor**, **test**

Each agent is a markdown template in `agents/`. **25 senior-pattern reference files** in `agents/references/` (with YAML frontmatter for LLM-driven selection). 3 wrapper utilities (`test-all-agent`, `fe-test-all-agent`, `runtime-debug-agent`) live alongside but aren't AgentPlugins — they're CC sub-agent helpers invoked outside the pipeline FSM.

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
│  ─ 21 tools, 13 invariants (INV_001-013)               │
│  ─ Plugin framework: 7 contracts (Step / Agent /       │
│    Flow / Gate / Decision / Hook / SpawnProvider)      │
│  ─ FSM driver (core has zero plugin-name references)   │
│  ─ Audit log (per-project + global, redacted)          │
└────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────┐
│  Code bundle plugins (mcp/src/driver/bundles/code/)    │
│  agents (21) · steps (24) · flows (3) · gates (3)      │
│  decisions (8) · hooks (6) · spawn provider (shuttle)  │
│  Loaded via loaders/bundles.ts (loadBundle("code", …)) │
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
| [`mcp/README.md`](mcp/README.md) | MCP tool reference (21 tools) + invariants (INV_001-013) | When debugging state |
| [`hooks/README.md`](hooks/README.md) | Guard hook + Stop hook install + bypass mechanics | When customizing or escape-hatching |
| [`specs/product-vision.md`](specs/product-vision.md) | Product positioning — "AI Team RTS", target users, pricing tiers, commercial trajectory | When thinking about the bigger picture |
| [`specs/ui-vision.md`](specs/ui-vision.md) | 6-layer UX architecture: agent builder → specialist → team → curator → channels + console + 3 operating modes | When planning v2.3 daemon UX |
| [`specs/v3-productization-roadmap.md`](specs/v3-productization-roadmap.md) | Phase index → links to phase plans | When picking next bundle |
| [`specs/phases/`](specs/phases/) | Detailed plans per phase (v2.3 / v2.4 / v2.5 / v2.6 / far-future) | When executing a phase |
| [`specs/open-backlog.md`](specs/open-backlog.md) | Currently open + deferred + code-polish Q-items | When picking next fix |
| [`specs/closed-q-items.md`](specs/closed-q-items.md) | Historical record of 56 closed Q-items by bundle (7 bundles) | When recurrence-checking |
| [`validation-log.md`](validation-log.md) | Validation workflow + cross-cutting observations + closed-task index | When running real-task validation |
| [`validation/closed-tasks/`](validation/closed-tasks/) | Per-task validation entries (10 files, growing) | When studying past runs |
| [`specs/done/`](specs/done/) | Archived launcher prompts (v2.1, v2.2, v2.2a, v2.2.5, v2.2.6, v2.2.7) | When learning the bundle pattern |

## Self-improvement loop

Every reviewer emits structured findings (schema-validated). Misses are logged via `/agent-feedback` with category + pattern. Future runs auto-load the last 10 confirmed past-misses per agent. `/learn` clusters by category, detects drift, suggests vocab promotions. Source-of-truth files:

- `~/.claude/metrics/pipeline.jsonl` — one row per task (post-`/done`), 18+ fields
- `~/.claude/metrics/agent-feedback.jsonl` — one row per logged miss
- `~/.claude/metrics/mcp-audit.jsonl` — global audit (redacted project_dir, capped 10k)

10 real-task validation runs to date across **3 projects**: s3-panel (TypeScript pnpm monorepo) + wandr-be (NestJS backend) + frontend-core (TypeScript Rsbuild + Module Federation monorepo). See [`validation/closed-tasks/`](validation/closed-tasks/) for per-task entries.

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
├── agents/                  21 pipeline AgentPlugin prompt templates + 3 wrapper utilities
│   └── references/          25 senior-pattern refs (YAML frontmatter + content)
├── commands/                16 slash commands (task.md is a ≤30-line shuttle)
├── templates/
│   ├── schemas/             JSON Schemas (7) — finding, reviewer/validator output, state, vocab, classifier-output, bundle-extensions/code
│   ├── stack-candidates.yaml   v2.2.6 — single source of truth for languages / PMs / commands / project-type heuristics
│   └── pipeline-state.json  initial state template (schema 1.1)
├── mcp/                     MCP server (TypeScript, stdio)
│   ├── src/
│   │   ├── tools/           21 MCP tool implementations
│   │   ├── lib/             schemas, ids, audit, parse-frontmatter, stack-candidates, owner, paths, …
│   │   └── driver/          v2 plugin framework
│   │       ├── types/       7 plugin contracts + bundle.ts (incl. runner-agnostic SpawnRequest)
│   │       ├── core/        FSM + registry + shuttle (zero plugin-name refs — grep-gated)
│   │       ├── bundles/     code/ (21 agents · 24 steps · 3 flows · 3 gates · 8 decisions · 6 hooks · 1 spawn) + _template/ skeleton
│   │       └── loaders/     bundles.ts + project-config.ts
│   ├── test/                569 tests across 73 files
│   └── README.md            tool reference + invariants + CLAUDE.md authoring conventions
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
1. Create `agents/my-reviewer.md` (prompt template — role + checklist + JSON output schema; include the Canonical-identifiers constraint per v2.2.6 C6).
2. Add an `AgentPlugin` entry in `mcp/src/driver/bundles/code/agents/index.ts` (~5 lines — name, model, template_path, applies_to).
3. Register in `bundles/code/bundle.ts` (1 line in `supported_agents`).

Adding a new ecosystem (C# / Svelte / Crystal / …) — just edit `templates/stack-candidates.yaml`. No TypeScript change required. The Zod loader cross-references entries and fails fast at process start on malformed YAML.

Core is **never** touched. `grep -rEi "planner|implementer|logic-reviewer|gate-[012]|simple-flow|medium-flow|complex-flow" mcp/src/driver/core/` returns zero matches — enforced as a per-commit gate.

Plugin framework supports 7 contracts. Adding a new LLM provider = new `SpawnProviderPlugin` (Anthropic SDK direct, Ollama, OpenAI, etc.). Adding a new task trigger source (Jira/Slack/etc.) = new `TriggerSourcePlugin` (planned for v2.6, see [`specs/ui-vision.md`](specs/ui-vision.md)).

**Domain bundles** (content / research / VFX) are first-class as of v2.2.5 — Q40 closed. Create a new bundle under `mcp/src/driver/bundles/<name>/` mirroring `_template/` + `bundles/code/`. State carries `state.bundle: <name>`; the bundle's `bundle.ts` manifest enumerates supported plugins.

## Requirements

- Claude Code CLI
- Node 20+ and pnpm (for MCP server)
- `jq`, `git`, standard Unix toolchain (macOS / Linux / WSL)
- Recommended: [RTK](https://github.com/rtk-ai/rtk) (60-90% CLI token savings)

## License

MIT. See [LICENSE](LICENSE) (if present).
