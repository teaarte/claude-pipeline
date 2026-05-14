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
NOW: v2.1 shipped, v2.2 active
     ├─ free-tier dogfooding on s3-panel (single user, solo author)
     └─ no public discovery, no paid tier

PHASE 1 — Foundation (v2.2 + v2.3 + v2.4, ~6-8 weeks)
     ├─ v2.2: review completeness + clear-bundle fixes
     ├─ v2.3: daemon + Web UI on single instance + templates/presets system
     └─ v2.4: Docker isolation
     EXIT: pipeline survives 5+ external alpha-user runs without showstoppers

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
