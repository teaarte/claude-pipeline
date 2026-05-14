# Product Vision — AI Team RTS

> *Status: vision document. Not a roadmap, not a spec, not a commitment. Captures product framing + commercial trajectory so we don't lose them while heads-down on v2.x infrastructure work.*
>
> Created 2026-05-14. Will be revisited after each major phase merges.

## One-liner positioning

> **Programming as RTS** — command a team of AI agents working in parallel on multiple codebases through one panel. You give high-level orders, agents execute autonomously, a curator surfaces only what needs your attention.

The mental shift: from "I write code in chat with one LLM" to "I command a team of LLMs working on multiple things, and I'm playing strategy not tactics."

## Why this framing matters

The AI dev tools space in 2026 is crowded:

- **Single-agent chat**: Cursor, Aider, Copilot Workspace, Claude Code, etc. — strong at 1-on-1 conversation.
- **Single autonomous agent**: Devin, Cognition. Strong at one-shot end-to-end tasks.
- **Multi-agent frameworks (no UI)**: CrewAI, AutoGen, MetaGPT — multi-agent but require code-level orchestration, no team-management UI.
- **What's missing**: **fleet of multi-agent teams with team-lead mediation, controlled from a top-down panel.** The "RTS for code" niche is empty.

The architecture we've been building (TypeScript plugin framework, schema-validated state, audit trail, FSM driver, invariants, MCP enforcement) IS the substrate for this. The product layer on top is what monetizes.

## The mapping (RTS ↔ Pipeline)

| RTS concept | Pipeline equivalent |
|---|---|
| Units (workers / fighters / scouts) | Agents (planner / implementer / logic-reviewer / challenger / acceptance / ...) |
| Battlefield map | Multiple project directories, possibly on multiple machines |
| Unit specialties + research tree | Templates / presets — *senior backend Python*, *frontend architect*, *DevOps SRE*, etc. |
| High-level orders | `/task` description |
| Autonomous execution | Pipeline runs through gates, only escalates when needed |
| Intervention by player | Human answers at gates, gives feedback, redirects |
| Multi-base scaling | Multiple pipeline instances on multiple machines |
| Resources (food / gold / wood) | Token budget per task, model cost, API quotas |
| Tech tree / progression | Plugin marketplace, custom agent types, custom reviewers |
| Mini-map awareness | Web UI surface — real-time event stream from all agents |
| Hero unit | **Curator / tech-lead agent** — synthesizes multi-agent output, escalates only non-routine to the human |

## Target users + buying motivation

| Segment | Pain | Why they pay |
|---|---|---|
| **Solo founders scaling beyond solo** | Want to feel like a team without hiring | Pro tier ~$30-50/mo trivial vs $10K+/mo for one mid-level eng |
| **Tech leads at 5-20-person companies** | Juggle their own coding + 1-3 reports + reviews | Pro tier per seat lets them lean on AI for the review tier they don't have time for |
| **Agencies / consultancies** | Multiple client codebases, context-switching cost | Team tier per seat amortizes across N clients; templates per client preserve their preferences |
| **Indie devs / OSS maintainers** | Want force multiplier without hiring | Pro tier when they hit "I have 5 PRs to review and 3 issues to triage" |
| **Enterprise SRE / platform teams** | Evaluating Devin alternatives, want self-hosted | Enterprise tier — self-hosted, audit compliance, no vendor lock-in |
| **Educational / curious devs** | Want to learn architecture by watching multi-agent work | Free tier — viewing-only use case |

Sweet spot for monetization: **the gap between "solo dev with ambition" and "5-person engineering team"**. There are tens of thousands of people in this gap, willing to pay $30-200/mo to feel like a team.

## Pricing tiers (proposed)

| Tier | $/mo | What unlocks | Target |
|---|---|---|---|
| **Free** | $0 | 1 local pipeline instance, basic UI, max 3 concurrent agents, community templates, local-only metrics, OSS license | Solo devs, students, OSS contributors |
| **Pro** | $30-50 | Multi-instance per machine, full UI (curator synthesis, cost dashboard), all 5 reviewers + plan-conformance + UI-consistency + API-contract, custom templates, cross-session memory integration (claude-mem-style) | Indie devs, solo founders, hobbyists scaling up |
| **Team** | $100-200/seat | Fleet management across multiple machines, shared templates, multi-tenant (per-org workspace), RBAC, central metric store, real-time multi-instance event stream | 5-20 person companies, agencies |
| **Enterprise** | talk-to-us | Self-hosted fleet, audit compliance (SOC2/HIPAA depending), SSO, SLA, dedicated support, custom plugin development | 50+ companies, regulated industries, government |

**Pricing principle:** free tier matches today's local-dogfooding experience. Paywall starts at fleet / curator / multi-instance / shared-state — features that don't exist today.

**Margin watch:** LLM token cost scales linearly with usage. Pro tier @ $30/mo with naive routing on Opus = $50-100 in LLM cost on heavy use → negative gross margin. **v2.5 cost-aware multi-provider routing (haiku for mechanical, opus for reasoning) is a commercial prerequisite, not just nice-to-have**. Without it, no paid tier is sustainable.

## Architectural moat (what makes this defensible)

These are unusual for AI dev tools at 2-3 day age — and they compound:

| Capability | Status | Why it matters commercially |
|---|---|---|
| Schema-validated state (ajv) | ✓ | Bugs findable in minutes via `jq`, not weeks via "weird flakiness" — translates to support cost / reliability for paid users |
| Audit log with redaction | ✓ | Enterprise compliance requirement |
| 12 invariants with documented recovery | ✓ | Predictability — paid users tolerate fewer surprises |
| Plugin framework (7 contracts) | ✓ | Extensibility — Pro/Team customers add their own reviewers without forking |
| FSM-driven orchestration | ✓ | Deterministic re-run / replay — debuggability + multi-session resilience |
| Guard hook with 20+ evasion patterns | ✓ | Security claim — files protected from LLM mistakes; matters for enterprise |
| Property-based + integration tests | ✓ | Lower defect rate vs typical AI tooling |
| Grep purity gate (core has no plugin-name leak) | ✓ | Framework purity — paid customers can REPLACE built-in agents wholesale |
| Bypass marker with HMAC-TTL | ✓ | Security — enterprise auditors will look for this |

**This is closer to Temporal/Inngest (production workflow engines) than to CrewAI/AutoGen (AI agent frameworks).** That's the moat: rigorous substrate, AI-aware product layer on top.

## Commercial trajectory phases

```
NOW: v2.2a shipped (review surface unlocked), second-project validation active (wandr-be)
     ├─ free-tier dogfooding on s3-panel + wandr-be (single user, solo author)
     └─ no public discovery, no paid tier

PHASE 1 — Foundation (v2.2.5 + v2.3 + v2.4, ~7-9 weeks)
     ├─ v2.2.5: Bundle foundation (multi-domain substrate; closes Q40)
     ├─ v2.3: daemon + Web UI on single instance, BUNDLE-AWARE FROM DAY 1
     │         + templates/presets system + agent-builder UI
     └─ v2.4: Docker isolation (per-bundle docker images possible)
     EXIT: pipeline survives 5+ external alpha-user runs without showstoppers
     EXIT: at least 1 code-domain alpha user runs /task end-to-end via Web UI

PHASE 2 — Pro tier launch (v2.5 + v2.6, ~6-10 weeks after Phase 1)
     ├─ v2.5: cost-aware multi-provider routing (commercial prereq!)
     ├─ v2.6: plugin marketplace + curator agent (Pro-only feature)
     ├─ Public Github + docs + showcase video with RTS framing
     ├─ Free tier publicly available, no paywall yet
     ├─ Goal: 50-100 alpha users
     └─ Pro tier paywall flipped on once retention signal exists

PHASE 3 — Team tier (v3.0, ~3-4 months after Phase 2)
     ├─ Fleet control plane (multiple instances, multiple machines)
     ├─ Multi-tenancy + authentication + RBAC
     ├─ Central metric store (Postgres / S3)
     ├─ Real-time event stream (websocket / SSE)
     ├─ Team tier sold into existing Pro user base
     └─ Goal: 5-10 paying teams

PHASE 4 — Enterprise (v3.x+, indefinite)
     ├─ Self-hosted distribution
     ├─ Compliance certifications (SOC2 if applicable)
     ├─ Dedicated support model
     └─ Goal: 1-3 enterprise customers
```

**Honest timeline read:** Phase 1 ≈ 6-8 weeks of focused work from today. Phase 2 launch ≈ 3-4 months. First paying Pro user ≈ 4-5 months from today (optimistic). Sustainable revenue ≈ 8-12 months. This is OSS + bootstrap pace, not VC-fueled racing.

## Open questions (decide later)

### Product
- **Curator agent**: AgentPlugin or new contract type? Multi-curator (per-team-segment) or single? Configurable curator persona?
- **Templates / presets**: declarative YAML/JSON? versioned? user-contributed marketplace? signed-author trust model?
- **Cross-session memory**: integrate `claude-mem` (Phase 1 sideways), or build own? (Probably integrate — NIH waste otherwise.)
- **Real-time UI**: websocket from daemon? polling? what's the trade-off for self-hosted?

### Distribution + GTM
- **Public launch venue**: Show HN? Twitter? Reddit r/programming? Direct outreach to ICPs?
- **Showcase**: video of multi-agent run with RTS framing? interactive demo on landing page?
- **Pricing experiment**: $30 vs $50 Pro tier? Per-seat or flat?
- **Trial mechanics**: free tier permanent, no trial needed? OR Pro 14-day trial converts higher?

### Business
- **Entity**: when to incorporate? US LLC? EU GmbH? Solo proprietorship until first revenue?
- **Payments**: Stripe? Paddle (handles VAT)?
- **OSS license**: stays MIT? Or core MIT + commercial layer proprietary (BSL)?
- **Cofounders / team**: solo through Phase 2? Hire first eng after Pro launch? Or stay solo through Phase 3?

## Domain boundary — what generalizes, what's code-specific

The pipeline's core architecture is generic; the built-in plugin set is code-specific. This distinction is load-bearing for any future expansion to non-code domains (photo / video / research / VFX / etc.).

### Generic (reusable for any multi-agent workflow with quality gates)

- **FSM driver** (`mcp/src/driver/core/`) — knows nothing about code; consumes flows + steps as data
- **7 plugin contracts** (`mcp/src/driver/types/plugin.ts`) — abstract interfaces; `AgentPlugin`, `FlowPlugin`, etc. accept any `name` / `template_path` / model
- **MCP enforcement + 12 invariants** — protect state shape, not the domain of work
- **Audit log + redaction** — JSONL stream of any content
- **Gates + validate_response** — human-in-loop interaction of any kind
- **Recovery paths** — `pipeline_abandon`, `pipeline_unlock_writes`, `pipeline_finish` — generic state management
- **Schema validation discipline** (ajv) — applies to any JSON schema
- **Cross-session recovery** — snapshot/resume any workflow
- **Past-misses / feedback streams** — generic learning loop

### Code-specific (would need replacement per non-code domain)

- **State schema enums** — `Phase = context|planning|test_first|implementation|validation|final`, `complexity = simple|medium|complex`, `tests_mode = tdd|regression-only`, `stack = {language, package_manager, test_command, ...}`. `test_first` phase and `stack` fields are code-only
- **Built-in agents** (`mcp/src/driver/builtin/agents/` — 20 files) — planner, code-analyzer, logic-reviewer, security-frontend, performance-react, etc. All code-domain
- **Built-in flows** (`builtin/flows/{simple,medium,complex}.ts`) — code-workflow shapes
- **Built-in decisions** (`builtin/decisions/`) — `tests-mode`, `stack-detect`, `ui-touched`, `api-touched`, `security-needed`. All code-only
- **Built-in hooks** (`builtin/hooks/`) — `anti-pattern-grep` (CLAUDE.md "What NOT to Do"), `caller-context-expand` (git callers). Code-specific
- **SpawnProviders** — currently only `shuttle` (Claude Code Task tool). Photo/video would need `DalleSpawnProvider` / `RunwaySpawnProvider` / etc.
- **Skills** (`commands/task.md`, `commands/done.md`) — reference `git diff`, CLAUDE.md "Validation Commands", `pnpm/lint/typecheck/test/build`. Code-domain framing throughout
- **Guard hook** (`hooks/pipeline-guard.sh`) — protects code-state working files; might not be needed (or needs different paths) for photo workflows

### Bundle abstraction (Q40, **scheduled for v2.2.5** — 2026-05-14 promotion)

**Promoted from "deferred" to "next phase" 2026-05-14.** Triggering observation: when planning v2.3 daemon + Web UI it became clear that building UI code-only and retrofitting bundle-awareness later means rewriting React components. Inserting v2.2.5 (~5-7d) BEFORE v2.3 is cheaper than the post-hoc refactor. See [`phases/v2.2.5-bundle-foundation.md`](phases/v2.2.5-bundle-foundation.md).

**What ships in v2.2.5:**

1. **Directory restructure:** `mcp/src/driver/builtin/` → `mcp/src/driver/bundles/code/`. New `_template/` skeleton for future domains.
2. **`BundleManifest` interface** in `types/bundle.ts` — declares supported flows / decisions / agents / steps / hooks / gates + task-prompt-template path + state-schema-extension path + knowledge directory.
3. **`loaders/bundles.ts`** — accepts `bundle: string` parameter, loads that bundle's plugins.
4. **`state.bundle: string`** required field (default `"code"`, auto-set by `pipeline_init`).
5. **`Phase` becomes `string`** (was enum). `FlowPlugin` declares `phases: string[]`. Code-bundle flows declare current 6 phases.
6. **State schema split:** base schema (universal) + per-bundle extension schema (`bundles/code/state-extension.schema.json`). ajv conditional validation by `state.bundle`.
7. **`<project>/.claude/pipeline.config.json`** — project-level config: `{"bundle": "code", "mcp_clients": [], "team_knowledge_refs": []}`. Default works without it.
8. **Skills bundle-parameterized:** `commands/task.md` reads bundle from config; bundle's `task-prompt.md` injects preamble.
9. **`MCPClientPlugin` contract** (NEW) — pipeline becomes both MCP server AND client. Daemon spawns external MCP servers (e.g., `claude-mem`), exposes their tools to agents. Unlocks declarative integration of external MCP servers without code changes.
10. **`state.team_knowledge_refs: string[]`** slot — team-scoped shared knowledge files. Write API ships in v2.6 (curator); slot is reserved now.

**Explicitly out of scope for v2.2.5:**

- **No new domain bundles** beyond the `code` bundle (and `_template/` skeleton docs). Authoring `tiktok/` / `marketing/` waits for validated demand.
- **No write API for team knowledge** — v2.6 curator decides what gets promoted.
- **No `pipeline.config.json` editor UI** — v2.3 Web UI delivers that.
- **No MCP marketplace** — external MCP integration is config-level. Curated catalog v2.6.

### Strategic read

The pipeline today is **"AI dev team RTS"** focused on code. v2.2.5 makes the architecture **honestly multi-domain capable** — moving the bundle abstraction from "future Q40" to "shipped substrate" closes the gap between vision (multi-domain virtual teams) and reality (code-only built-ins).

Code remains the **first and primary bundle** through Phase 2. Other bundles (content / marketing / research / VFX) only get authored when validated external demand appears. Architectural readiness ≠ market commitment.

**Recommended posture:** ship v2.2.5 substrate. Continue building code-domain product first. Entertain non-code bundles only when (a) someone external asks for it, OR (b) a side-project proof-of-concept produces a "wow, this delivers" signal. Architecture is now ready when those moments come; no rework cost.

## Architectural principle: code + LLM hybrid for classification

Surfaced as a coherent principle during wandr-be validation run 2026-05-14 (filing of Q44/Q45/Q46). Worth stating explicitly because it shapes how every future decision/predicate/hook is built.

### The principle

> **Pure code for deterministic problems. Code + LLM for classification / picking / matching / interpretation.**
>
> When a problem requires understanding semantic content (which references are relevant to this task? does this diff really violate this rule? what's a good slug for this Cyrillic text?), patches like multilingual regex / transliteration libraries / pattern extractors are the wrong tool. They appear to solve the problem in test cases but leak edge cases endlessly.
>
> The right tool is a small LLM classification call. Code provides:
> - **Input parameters** (the task description, the diff, the state)
> - **List of available options / candidates** (refs in registry, anti-pattern rules in CLAUDE.md, agents in flow)
> - **Output constraints** (return JSON array, max N items, must be from the candidate list)
>
> LLM provides:
> - **The actual classification decision** (which subset, which match, which slug, which agent)
>
> Result: bounded LLM cost (~$0.0005-0.005 per call on haiku tier), bounded LLM scope (it only picks; it doesn't invent), correctness scales with content quality (descriptive frontmatter / clear rule text) instead of regex maintenance.

### Sites where this applies

Already designed this way:
- **Q41 — `refs-to-load`** decision. Refs are self-describing (YAML frontmatter); LLM picks top-N relevant. Inactive in prod (shuttle leaves `query?()` undefined; activates with v2.3 daemon's direct-API SpawnProvider).

Future sites (will be retrofitted as the LLM-classification infra matures):
- **Q44 — anti-pattern detection.** Rule text + diff → LLM extracts real violations with `file:line`. Replaces word-overlap noise.
- **Q46 — slug synthesis.** Arbitrary task text → LLM generates 8-15 char English semantic slug. Replaces transliteration libraries.
- **Q45** — same as Q41; not a separate bug, just the visible manifestation of Q41 partial state on non-English tasks.
- **`applies_to` predicates** (currently boolean code in Q9 family). Some predicates (e.g. "should challenger spawn?") have legitimate fuzzy classification logic that boolean code can't capture cleanly.
- **`complexity` decision** (currently heuristic code: file count, new patterns, etc.). Edge cases like "wide but shallow" require interpretation.
- **Past-misses ranking** (currently chronological top-10). Diff-aware re-ranking by relevance is classification.
- **Curator dispatch** (v2.6) — entire job is "given task + team + history, pick specialist". Pure LLM by design.
- **Anti-pattern rule extraction** (Q44 sibling) — turning prose "Don't do X" rules into machine-checkable form is itself a classification task.

### When NOT to use LLM (deterministic problems)

Stay with code for:
- **Schema validation** (ajv): deterministic, fast, free.
- **State transitions** (FSM, INV_001-012): correctness > flexibility.
- **Audit log** (every MCP call): structured, queryable, redactable. Deterministic.
- **Plugin registration / loading**: deterministic.
- **Stack detection** (Q17/Q26): CLAUDE.md parsing + package.json reading — deterministic interfaces. (Though edge cases like polyglot monorepos could benefit from LLM classification — borderline.)
- **`pipeline_validate`** (12 invariants): correctness must be reproducible.

The rule of thumb: **if you find yourself writing regex / keyword lists / tokenization → classification problem → LLM.** If you find yourself writing schema constraints / state machine transitions / structured emission → deterministic → code.

### Infrastructure requirements

For the LLM-classification pattern to be usable across the codebase:

1. **`SpawnProviderPlugin.query?()`** — lightweight one-shot classification call. Defined in v2.2a Q41 work. Shuttle provider intentionally leaves it `undefined` (no synchronous out-of-band LLM calls available via shuttle pattern). Activated when v2.3 daemon adds a direct-API SpawnProvider (Anthropic SDK / Ollama / OpenAI / etc.).
2. **Cost ceiling per call** — haiku tier preferred for classification ($0.0005-0.005). Opus / sonnet only when judgement depth matters (e.g. curator decisions).
3. **Caching** — same input → same output → cache. Avoid redundant LLM calls for stable decisions (refs-to-load already caches via `state.decisions.refs_to_load`).
4. **Fallback on failure** — LLM call fails or returns malformed → graceful degrade (empty list, pre-LLM heuristic, audit entry). Pipeline never crashes on LLM unavailability.
5. **Observability** — when fallback fires, emit audit `error_class: "llm-classification-needed"`. Lets us count how much value LLM-activation actually delivers post-v2.3.

This isn't a separate phase — the principle is **applied incrementally** as decisions/hooks/predicates are added or revisited. v2.3 daemon makes it usable everywhere; v2.6 curator is its biggest single application.

## Trigger sources & autonomous mode

The pipeline today fires only when a human types `/task` in Claude Code. The RTS positioning ("I create a task, the team picks it up and does it") requires task **pickup loops** from external systems and **auto-gate policies** that skip human approval on routine work. This section sketches the architecture; v2.6 territory.

### Three plugin contracts needed (not yet defined)

```typescript
interface TriggerSourcePlugin extends PluginMeta {
  name: string;
  start(ctx: TriggerContext): Promise<void>;   // begin listening/polling
  stop(): Promise<void>;
}
//  Implementations: JiraPollerPlugin, SlackEventPlugin, GithubWebhookPlugin,
//                   CronPlugin, QueuePlugin (SQS/Redis/RabbitMQ)

interface AutoGatePolicyPlugin extends PluginMeta {
  name: string;
  decide_gate(state: DriverState, gate: "gate-0" | "gate-1" | "gate-2"):
    "auto-approve" | "human-required";
}
//  Examples:
//    - auto-approve gate-0 if complexity=simple AND project ∈ trusted
//    - auto-approve gate-1 if grounding=GROUNDED AND no security touched
//    - human-required always on gate-2 of complex tasks

interface OutputRoutingPlugin extends PluginMeta {
  name: string;
  on_complete(state: DriverState, verdict: Verdict): Promise<void>;
}
//  Implementations: JiraCommentPlugin, SlackDMPlugin, GithubPRPlugin,
//                   CuratorEscalationPlugin (only non-routine → human)
```

These are forward-compat additions. Plugin framework already supports new contracts via `loaders/builtins.ts` extension; no core refactor needed. `PluginMeta.domain` (already added) lets a trigger source declare which bundle it belongs to (e.g., Jira → code bundle, Slack-photo-bot → photo bundle).

### Example: Jira ticket → autonomous run

```
1. Daemon running (v2.3 prerequisite).
2. JiraPollerPlugin registered with config:
   { jira_url, project_keys: ["DEV"], poll_interval: "5m",
     filter: "label=ai-eligible AND status=todo",
     template_preset: "senior-backend-typescript" }
3. Plugin polls every 5min. Finds eligible ticket DEV-123.
4. Ticket body normalized → POST to daemon's /tasks endpoint with
   { description, source: "jira", source_id: "DEV-123",
     auto_approve_categories: ["medium-frontend"],
     output_routing: ["slack:@reporter", "github:open-pr"] }
5. Pipeline applies the template preset (which agents, refs, model routing).
6. Each gate: AutoGatePolicyPlugin checks. Routine? auto-approve.
   Non-routine? CuratorEscalationPlugin DMs the reporter on Slack with a
   compact summary + a 30-min response window. Timeout → escalate to lead.
7. On completion: GithubPRPlugin opens PR with branch + summary.
   JiraCommentPlugin updates DEV-123 with PR link.
   SlackDMPlugin notifies reporter.
```

### Example: Slack command → autonomous run

```
User in #engineering: /pipeline run "fix login button alignment"
  → SlackEventPlugin parses → POST /tasks
  → Daemon dispatches to a free instance (Fleet abstraction, v3.0)
  → Pipeline runs autonomously, Curator DMs user only on gate non-routine
  → Result: thread reply with PR link + 1-paragraph summary
```

### Required capabilities (mapping to phases)

| Capability | Phase | Required for autonomous pickup |
|---|---|---|
| Daemon HTTP API + Web UI | v2.3 | YES — must be running |
| Templates / presets | v2.3 | YES — preset per task profile |
| Multi-provider cost-aware routing | v2.5 | NICE — cheaper for routine ingest |
| Curator agent | v2.6 | YES — handles non-routine escalation |
| `TriggerSourcePlugin` contract | v2.6 | YES — core requirement |
| `AutoGatePolicyPlugin` contract | v2.6 | YES — without human at each gate |
| `OutputRoutingPlugin` contract | v2.6 | YES — completion notifications |
| Fleet abstraction (multi-instance dispatch) | v3.0 | NICE — for high-volume |

**Timeline from today:** ~2-3 months to single-instance Jira/Slack autonomous mode (v2.6); ~4-5 months to fleet dispatch (v3.0).

### Trust / safety considerations

Autonomous mode adds risk vectors:

- **Trigger source compromise** — if Jira instance is compromised, attacker can dispatch tasks. Mitigations: per-trigger-source allowlist of repo paths; per-trigger-source rate limits; explicit `verified_reporter` allowlist in config; audit-log entry per trigger acceptance.
- **Auto-approve policy too permissive** — wrong gate auto-approved on a security-sensitive change. Mitigations: AutoGatePolicy plugins always run AFTER review verdicts; require unanimous reviewer APPROVE; require zero blocking findings; security-needed=true → always human gate.
- **Curator escalation flooded** — high-volume mode swamps the human with DMs. Mitigations: per-user DM rate limit; batch summaries; weekly digest mode.
- **Side-effect operations** (PR open, git push, ticket comment) — these are publicly visible. Existing guardrails (guard hook, OutputRoutingPlugin allowlist, dry-run mode for first 10 runs of any new trigger source).

These are NOT cheap problems. They're the difference between "v2.6 ships with autonomous-mode disabled by default" and "v2.6 ships with safe autonomous-mode enabled by default". Likely path: ship disabled in v2.6, validate in dogfood for 2-4 weeks, enable for trusted users in v2.7.

### Strategic posture

Autonomous mode is **THE differentiator** versus single-agent autonomous tools (Devin, Cognition) — those tools execute one task at a time when invoked. Fleet of multi-agent teams with team-lead mediation, pickup from N trigger sources, output to N destinations — this is the RTS positioning.

But it's also **the easiest place to over-promise.** "Just give me a Jira ticket, the AI does the rest" is a marketing message that survives reality less than "human-in-loop with strong assistance". Plan to ship autonomous mode **disabled by default + opt-in per trigger source**, not as the headline feature. The headline stays: "command a team of AI agents." Autonomous pickup is a Pro/Team tier capability that mature users unlock.

## Anti-goals (what NOT to build)

- ❌ **Generic AI chat interface** — Cursor/Claude Code own this. Don't compete.
- ❌ **One autonomous agent** — Devin owns this. Don't compete.
- ❌ **Code generation IDE plugin** — too crowded.
- ❌ **Universal LLM gateway** — LiteLLM/OpenRouter own this. Use them, don't compete.
- ❌ **Build own LLM** — obvious, but worth stating.
- ❌ **Premature monetization** — no paywall before product survives external use. No Stripe integration before Phase 2.
- ❌ **Enterprise sales motion** before Pro is validated. Skip the SaaS-too-early death spiral.

## What is already built that supports this

Snapshot as of 2026-05-14:

- ✅ 7 plugin contracts in TypeScript (`AgentPlugin`, `StepPlugin`, `FlowPlugin`, `GatePlugin`, `DecisionPlugin`, `HookPlugin`, `SpawnProviderPlugin`)
- ✅ 21 MCP tools (state, spawn-record, driver, recovery, metrics, past-misses, meta)
- ✅ FSM driver with injectable `SpawnRecorder` (transport-agnostic)
- ✅ Schema-validated state via ajv draft 2020-12
- ✅ 12 invariants (INV_001 – INV_012) with documented recovery
- ✅ Audit log with redaction (per-project + global, jsonl)
- ✅ Guard hook (PreToolUse) with 20+ evasion patterns + path traversal
- ✅ Bypass marker with HMAC-TTL forge-resistance
- ✅ 274 tests, 39 files (~76% test:source ratio at v2.1-polish-bundle close)
- ✅ Validation discipline: `validation-log.md`, `validation-prompt.md`, Q-item triage with severity / effort / recurrence
- ✅ Done-cleanup via dedicated MCP tool (server-side atomic, no guard bypass)
- ✅ Stack auto-detection (Q17, partial — Q26 follow-up)
- ✅ Stop hook with three legitimate states (in-flight / gate-paused / post-accept)
- ✅ Q-items closed: Q7, Q8, Q11, Q12-15, Q16, Q17 partial, Q18, Q19, Q20, Q21, Q22, Q23, Q24, Q36 = 14 fixes from real-task validation

This is **the strongest substrate I've seen for an AI dev tool at this age.** Translating it into a product is the next ~6-8 months of work.

## What is NOT yet built (and is on the path)

- ❌ Daemon mode (long-running process with HTTP API) — v2.3
- ❌ Web UI on single instance — v2.3
- ❌ Templates / presets system — v2.3
- ❌ Docker isolation — v2.4
- ❌ Multi-provider routing (cost-aware, haiku vs opus per agent role) — v2.5
- ❌ Plugin marketplace + signed publishers — v2.6
- ❌ Curator / tech-lead agent — v2.6
- ❌ Cross-session memory (claude-mem integration) — v2.6 or earlier
- ❌ Fleet control plane (multi-instance, multi-machine) — v3.0
- ❌ Multi-tenancy + authentication + RBAC — v3.0
- ❌ Central metric store + real-time event stream — v3.0
- ❌ Compliance certifications — v3.x

## Numbering note

Version numbers in `specs/v3-productization-roadmap.md` used to be v2.5/2.6/2.7/2.8 with gaps. **Compacted to v2.3/2.4/2.5/2.6** going forward (no gaps). v3.0 reserved for fleet + commercial launch. Will switch to strict semver (breaking changes = major bump) once external alpha users exist and version pinning becomes a real concern.

## Update cadence

Revisit this document after each major phase merges:
- After v2.2 merges → update "what is built" list, pruning closed items
- After v2.3 (daemon + UI) ships → revisit pricing tiers in light of real UX, fill in any open questions answerable from first 10-20 alpha users
- After v2.5 (multi-provider routing) ships → recalculate margin math with real cost data
- Before flipping Pro paywall → mandatory full re-read + check against acquired alpha feedback

---

**Bottom line:** RTS framing + production-grade substrate + clear phasing + honest commercial trajectory = real shot at a defensible category-new product. Path is multi-month, not multi-week. Don't lose focus on Q9 review completeness while this excitement is fresh.
