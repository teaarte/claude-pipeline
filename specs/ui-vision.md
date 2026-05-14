# UX architecture vision — agent builder → team → curator → autonomous

> *Status: vision document. Captures the layered UX flow we're building toward. Each layer maps to one or more phases in [`v3-productization-roadmap.md`](v3-productization-roadmap.md). Not a commitment — concrete designs happen when the phase docs detail it.*
>
> Created 2026-05-14. Companion to [`product-vision.md`](product-vision.md) which covers positioning + commercial trajectory; this doc covers the UX/UI architecture.

## One-liner

> **A form-based UI lets you build agents → bundle them into specialists → compose specialists into teams → a curator dispatches incoming tasks from any channel (Jira/Slack/Telegram/console) to the right specialist → you only see what needs your decision.**

That's the full vision. Everything below decomposes it into layers + UI screens + roadmap phases.

## The six layers (bottom-up)

```
┌─────────────────────────────────────────────────────────────────┐
│ 6. CHANNEL ADAPTERS (Jira / Slack / Telegram / console / chat) │
│    ↓ inbound tasks                                              │
├─────────────────────────────────────────────────────────────────┤
│ 5. HUMAN CONSOLE (notification inbox + decision UI + analytics)│
│    ↑ escalations / approvals                                    │
├─────────────────────────────────────────────────────────────────┤
│ 4. CURATOR (dispatcher + auto-policy + result synthesizer)     │
│    routes tasks to the right specialist in the team             │
├─────────────────────────────────────────────────────────────────┤
│ 3. TEAM COMPOSER (specialists → team)                          │
│    e.g. "frontend-team" = [react-architect, perf-reviewer,     │
│                              accessibility-specialist]          │
├─────────────────────────────────────────────────────────────────┤
│ 2. SPECIALIST COMPOSER (agents + refs → specialist)            │
│    e.g. "senior-react-architect" = {planner, code-analyzer,    │
│                                       logic-reviewer, perf-     │
│                                       reviewer, refs[react19,  │
│                                       perf-react]}              │
├─────────────────────────────────────────────────────────────────┤
│ 1. AGENT + REFERENCE BUILDER (form-based CRUD)                 │
│    name, prompt template, model, applies-to, tags, output      │
│    schema; refs: tags, stack signals, summary, when-to-load     │
└─────────────────────────────────────────────────────────────────┘
```

Each layer is a UI surface that composes the layers below it. Layer 1 is where most users spend time when extending the system; Layers 4-6 are where they spend time when *using* it.

## Three operating modes

Each team / specialist / task can run in one of three modes:

| Mode | Gate 0 | Gate 1 | Gate 2 | Human role |
|---|---|---|---|---|
| **Full-supervised** (today's v2.2a) | Always asks | Always asks | Always asks | In the loop for every gate |
| **Curator-mediated** | Auto-approve routine; escalate complex | Auto-approve grounded plans; escalate divergence | Always asks (final approval) | Receives only escalations + Gate 2 |
| **Full-autonomous** | Auto-approve per policy | Auto-approve per policy | Auto-approve per policy | Receives completion summaries only; can mute |

Mode is set per-team OR per-specialist OR per-task with cascading precedence:
```
task override > specialist default > team default > workspace default > 'full-supervised'
```

Default is always full-supervised — autonomous mode is **opt-in per scope**, never silently enabled.

## Layer 1 — Agent + Reference Builder (form-based CRUD)

Today, agents live as `agents/<name>.md` markdown files with output-constraint blocks. References live as `agents/references/<name>.md` with YAML frontmatter (added in Q41). The Builder UI is **a form view of these files** — saves serialize back to disk (or to SQLite in v2.3+).

### Agent editor screen (sketch)

```
┌─────────────────────────────────────────────────────────────────┐
│  Agents › react-perf-reviewer                          [Save]   │
├─────────────────────────────────────────────────────────────────┤
│  Name:        [react-perf-reviewer                            ] │
│  Description: [Reviews React render-perf concerns: memo, virt-] │
│               [ualization, render-tree shape.                 ] │
│                                                                  │
│  Model:       (●) haiku  ( ) sonnet  ( ) opus  Cost cap: [$5/mo]│
│                                                                  │
│  Output schema: ( ) reviewer  ( ) validator  (●) nonreview      │
│                                                                  │
│  Applies-to (when this agent should spawn):                     │
│   [+] ui_touched = true                                         │
│   [+] complexity ≠ simple                                       │
│   [Add condition...]                                            │
│                                                                  │
│  Tags: [frontend] [react] [performance] [+Add]                  │
│                                                                  │
│  Reference categories this agent benefits from:                 │
│   [react] [performance] [+Add]                                  │
│                                                                  │
│  ┌─── Prompt template (markdown) ────────────────────────────┐ │
│  │ # Role                                                    │ │
│  │ You are a React performance reviewer. You see code diffs  │ │
│  │ touching React components and you...                      │ │
│  │ ...                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Output constraints (auto-derived from schema):                 │
│   ✓ summary_line: ≤ 100 chars                                   │
│   ✓ findings[].id: ^f-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$            │
│   ✓ findings[].summary: ≤ 200 chars                             │
│   ✓ findings[].schema_version: "1.0"                            │
│                                                                  │
│  [Test playground: paste sample task → see prompt + simulated   │
│   output ↗]                                              [Save] │
└─────────────────────────────────────────────────────────────────┘
```

### Reference editor screen

```
┌─────────────────────────────────────────────────────────────────┐
│  References › perf-react.md                            [Save]   │
├─────────────────────────────────────────────────────────────────┤
│  Name:    perf-react.md                                          │
│  Tags:    [frontend] [react] [performance] [+Add]               │
│                                                                  │
│  Stack signals (soft hints for LLM picker):                     │
│   language:     [typescript] [javascript] [+]                   │
│   project_type: [frontend-app] [monorepo] [+]                   │
│                                                                  │
│  Summary (LLM reads this — 1-3 sentences):                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ React-specific performance patterns: memo, useMemo,     │   │
│  │ useCallback, virtualization, lazy loading, render-cost. │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  When-to-load (LLM picker uses this to decide):                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Task involves React component changes, performance-     │   │
│  │ sensitive UI rendering, list virtualization, or render- │   │
│  │ tree restructuring.                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Agent hints (which agents typically benefit):                  │
│   [logic-reviewer] [performance-reviewer] [+]                   │
│                                                                  │
│  ┌─── Content (markdown) ───────────────────────────────────┐  │
│  │ # React performance patterns                              │  │
│  │ ...                                                       │  │
│  └────────────────────────────────────────────────────────────┘ │
│                                                          [Save] │
└─────────────────────────────────────────────────────────────────┘
```

### Phase: v2.3 (daemon + Web UI shell)

The Builder UI is a v2.3 deliverable. Pre-v2.3, agents/refs are edited as files. v2.3 daemon's Web UI shell adds the form-based view + serialization.

## Layer 2 — Specialist Composer

A **specialist** is a named bundle of agents + refs + default config. Think of it as a saved configuration: *"when I need a senior React architect, spawn this set with these settings."*

### Specialist card (sketch)

```
┌─────────────────────────────────────────────────────────────────┐
│  Specialists › senior-react-architect                  [Edit]   │
├─────────────────────────────────────────────────────────────────┤
│  Use case: medium-to-complex frontend React tasks where         │
│            performance + architecture matter.                    │
│                                                                  │
│  Agents in this specialist:                                     │
│   ✓ planner                  opus    (planning phase)           │
│   ✓ code-analyzer            sonnet  (context phase)            │
│   ✓ logic-reviewer           opus    (planning, implementation) │
│   ✓ challenger-reviewer      opus    (implementation)           │
│   ✓ style-reviewer           haiku   (implementation)           │
│   ✓ performance-reviewer     opus    (implementation)           │
│   ✓ acceptance               haiku   (validation)               │
│                                                                  │
│  References injected:                                            │
│   • perf-react.md                                                │
│   • react19.md                                                   │
│   • arch-patterns.md                                             │
│                                                                  │
│  Default flow: medium                                            │
│  Default operating mode: curator-mediated                       │
│                                                                  │
│  Used in teams: frontend-team, senior-engineering-team           │
│                                                                  │
│  [Clone as new]   [Edit agents]   [Edit refs]   [Run task ↗]    │
└─────────────────────────────────────────────────────────────────┘
```

Specialists are first-class entities. Stored as `specialists/<name>.yaml` (or SQLite row). Plugin framework picks them up similar to flows.

### Phase: v2.3 (templates/presets foundation) + v2.6 (marketplace)

v2.3 introduces the **templates/presets system** — specialists are presets. v2.6 adds **marketplace** for sharing specialists between users (commercial: "Senior Backend Python Specialist" curated by trusted author, free or paid).

## Layer 3 — Team Composer

A **team** is a set of specialists + routing rules + channel bindings + autonomous-mode config. Think of it as your AI engineering org chart.

### Team workspace dashboard (sketch)

```
┌─────────────────────────────────────────────────────────────────┐
│  Teams › frontend-team                            [Settings ⚙]  │
├─────────────────────────────────────────────────────────────────┤
│  4 specialists  ·  3 active  ·  curator-mediated mode           │
│                                                                  │
│  ┌──────────────────────┬────────────────────────────────────┐  │
│  │ Specialists (4)      │ Routing rules (auto-dispatch)      │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ • react-architect    │ Task mentions "perf" or "render"   │  │
│  │   (8 tasks/wk)       │   → react-architect                │  │
│  │ • a11y-specialist    │ Task touches /a11y/ or "aria"      │  │
│  │   (3 tasks/wk)       │   → a11y-specialist                │  │
│  │ • bundle-optimizer   │ Task mentions "bundle" or "lazy"   │  │
│  │   (2 tasks/wk)       │   → bundle-optimizer               │  │
│  │ • generalist-react   │ everything else                    │  │
│  │   (12 tasks/wk)      │   → generalist-react               │  │
│  └──────────────────────┴────────────────────────────────────┘  │
│                                                                  │
│  Channels listening:                                             │
│   ✓ Jira (project FE, label: ai-eligible)                       │
│   ✓ Slack (#frontend-tasks, /pipeline command)                  │
│   ✓ Console (CLI on team-leader's machine)                      │
│                                                                  │
│  Autonomous mode:                                                │
│   ✓ simple complexity → fully autonomous                        │
│   ✓ medium → curator-mediated (DM escalation)                   │
│   ✓ complex → human-required on Gate 2                          │
│   ✓ security_needed=true → ALWAYS human-required                │
│                                                                  │
│  Last 7d: 28 tasks → 24 auto-completed · 4 escalated to human   │
│  ─────────────────────────────────────────────────────────────  │
│  [Active tasks] [Completed] [Escalations] [Settings]            │
└─────────────────────────────────────────────────────────────────┘
```

### Phase: v2.6 (curator + autonomous mode primitives)

Team composition + routing rules + channel bindings + per-complexity autonomous policy = v2.6 territory. Requires curator agent + AutoGatePolicy + TriggerSource + OutputRouting plugin contracts (see [`product-vision.md`](product-vision.md) "Trigger sources & autonomous mode" section).

## Layer 4 — Curator

A **curator** is an AgentPlugin with elevated responsibilities. Not a regular code-review agent — it's a *meta-agent* that:

1. **Reads inbound task** from a channel adapter
2. **Classifies** complexity + domain + urgency + security-sensitivity
3. **Picks specialist** from the team using routing rules + LLM judgment for ambiguous cases
4. **Watches the pipeline run** (subscribes to events)
5. **Applies AutoGatePolicy** at each gate (auto-approve or escalate)
6. **Synthesizes results** at completion (compact summary, not raw audit dump)
7. **Routes output** (PR comment, Slack DM, Jira update, etc.)

### Curator decision queue (sketch — what the human sees)

```
┌─────────────────────────────────────────────────────────────────┐
│  Curator queue · frontend-team                                  │
├─────────────────────────────────────────────────────────────────┤
│  ⚠ ESCALATIONS (need your decision) — 3                          │
│                                                                  │
│   🔴 t-2026-05-15-passwordform   [Gate 2 — Accept or reject?]   │
│   Specialist: senior-react-architect                            │
│   Reviewers: 5/5 APPROVE · acceptance PASS                      │
│   Curator note: "Security reviewer found 1 non-blocking         │
│   concern (rate-limit relies on backend; client-side has no     │
│   throttle). All AC pass. Recommending accept."                 │
│   [Accept]  [Reject + feedback]  [Read full review ↗]           │
│                                                                  │
│   🟡 t-2026-05-15-bundleopt      [Gate 1 — plan approval]       │
│   Curator note: "Plan introduces new dep (react-virtual). Per   │
│   team policy, new deps need explicit approval."                │
│   [Approve plan]  [Reject + revise]  [Read plan ↗]              │
│                                                                  │
│   🟡 t-2026-05-15-a11ycheck      [Gate 0 — classification]      │
│   Curator note: "Task pattern matches a11y-specialist but task  │
│   text also mentions analytics. Confidence 60%."                │
│   [Accept assignment]  [Reassign...]  [Reroute]                 │
│                                                                  │
│  ───────────────────────────────────────────────────────────    │
│  ✓ COMPLETED (informational) — 12 in last 7d                    │
│                                                                  │
│   • t-2026-05-15-loginbtn  · accepted · 24min · $0.18           │
│   • t-2026-05-14-modal     · accepted · 31min · $0.23           │
│   • t-2026-05-14-toolbar   · accepted · 18min · $0.12           │
│   [Show all]                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Phase: v2.6

Curator agent implementation. Likely a new AgentPlugin **kind** (not just instance) because:
- Doesn't emit findings (no output_schema = reviewer/validator)
- Subscribes to events from the FSM instead of being spawned by it
- Has tool access to MCP `pipeline_*` tools for state inspection
- Can call SpawnProvider.query for routine classifications

May warrant an 8th plugin contract: `MetaAgentPlugin` or `OrchestratorAgentPlugin`. Defer to v2.6 design.

## Layer 5 — Human Console

The **human console** is the Web UI surface where the human spends time when NOT building agents/specialists. Three primary screens:

1. **Inbox** — curator escalations + completion summaries (above)
2. **Live tasks** — what's running right now across all teams (similar to the team workspace dashboard, but multi-team)
3. **Analytics** — cost trends, blocker rates per specialist, curator accuracy (was an escalation actually non-routine?), team throughput

Plus settings:
- **Notification channels**: email, web push, Slack DM, Telegram. Per-severity routing (🔴 escalations → push + Slack DM, 🟢 completions → daily digest email).
- **Escalation timeout**: if you don't respond to a Gate 2 ask in N hours, what happens? Options: auto-approve, auto-reject, fallback to designated second human, hold indefinitely.
- **Mute schedules**: do-not-disturb hours; vacation mode.

### Phase: v2.3 (basic inbox + live tasks) → v2.6 (curator escalations) → v3.0 (multi-team analytics)

v2.3 ships the shell + inbox + live-tasks screens for the **single-team / single-user** case. v2.6 adds curator escalations + notification routing. v3.0 makes it multi-team / multi-user with shared workspace concept.

## Layer 6 — Channel Adapters

Inbound and outbound channels:

| Adapter | Inbound | Outbound | Phase |
|---|---|---|---|
| **Console / CLI** | `claude-team task "..."` | stdout summary | v2.3 |
| **Web chat** (in-Web-UI) | text input → /tasks | live thread updates | v2.3 |
| **Jira** | poll `label:ai-eligible AND status:todo` | comment with PR link | v2.6 |
| **Slack** | events API `/pipeline run "..."` | DM escalations + thread replies | v2.6 |
| **Telegram** | bot webhook | DM via bot | v2.6 (or P5) |
| **GitHub** (Issues) | webhook on issue label add | PR open + issue comment | v2.6 |
| **Cron / scheduled** | scheduled re-runs | n/a | v2.6 |

Each is a `TriggerSourcePlugin` (in) + `OutputRoutingPlugin` (out) pair (see [`product-vision.md`](product-vision.md) "Trigger sources & autonomous mode").

## End-to-end story (what the human's day looks like)

**Morning (5 minutes):**
- Opens Web UI → Inbox.
- 3 escalations: 2 Gate-2 approvals (curator says "5/5 reviewers approve, recommending accept") and 1 Gate-1 plan that introduces a new dep.
- Skims summaries. Approves the 2 Gate-2 in 1 click each. Rejects the new-dep plan with feedback ("use existing fast-sort, no new dep").
- Closes the tab.

**Throughout the day (zero attention):**
- Jira tickets labeled `ai-eligible` get picked up by frontend-team curator.
- Curator dispatches each ticket to the right specialist (react-architect / a11y-specialist / generalist-react).
- 18 tickets land. 14 auto-complete (simple/medium, curator-mediated → auto-approve), PRs open in GitHub, ticket comments update.
- 4 escalations queue in the human's inbox.

**Evening (10 minutes):**
- Reviews the 4 evening escalations + reviews the 14 auto-completed tasks (skim PR summaries in inbox).
- 1 auto-completed task had a curator concern noted ("rate-limit relies on backend") — human flags it as follow-up Jira ticket.
- Closes the tab.

**Throughput:** ~20 tasks/day, ~15 minutes of human attention. Equivalent to a team of 3-5 humans without the AI layer.

## Mapping to roadmap phases

| Layer | Phase | What lands in phase |
|---|---|---|
| Agent + Ref Builder | v2.3 | Web UI form-based CRUD; serialize to disk/SQLite |
| Specialist Composer | v2.3 (foundation) + v2.6 (marketplace) | Presets system in v2.3; sharing/buying in v2.6 |
| Team Composer | v2.6 | Routing rules + channel bindings + autonomous mode primitives |
| Curator | v2.6 | Meta-agent kind; AutoGatePolicy plugin; result synthesizer |
| Human Console (inbox, live tasks) | v2.3 → v2.6 → v3.0 | Shell in v2.3, curator integration v2.6, multi-team v3.0 |
| Channel Adapters | v2.6 | TriggerSource + OutputRouting plugin contracts |
| Fleet (multi-team / multi-instance) | v3.0 | Multi-tenancy, shared workspace, fleet dispatch |

## Operating modes — implementation thinking

Modes are an **AutoGatePolicy** thing, not a new state. The gate handlers already exist; what changes is *who answers them*.

```typescript
// Pseudocode for AutoGatePolicy
interface AutoGatePolicyPlugin {
  decide(state, gate, context): "auto-approve" | "human-required";
}

// "Full-autonomous" policy
const fullAutonomous: AutoGatePolicyPlugin = {
  decide: () => "auto-approve",
};

// "Curator-mediated" policy
const curatorMediated: AutoGatePolicyPlugin = {
  decide: (state, gate, ctx) => {
    if (state.complexity === "simple") return "auto-approve";
    if (gate === "gate-2") return "human-required";        // final ack
    if (state.security_needed) return "human-required";    // safety
    if (ctx.disagreements > 0) return "human-required";    // dissent
    return "auto-approve";
  },
};

// "Full-supervised" policy (today's behavior)
const fullSupervised: AutoGatePolicyPlugin = {
  decide: () => "human-required",
};
```

Curator listens to the FSM events. When a gate fires:
1. AutoGatePolicy decides.
2. `auto-approve` → curator computes the answer + posts to `pipeline_continue_task` directly.
3. `human-required` → curator builds a compact escalation message + routes to human's notification channels + holds the FSM until human responds (or escalation timeout fires).

## Open questions (decide when phase docs detail it)

1. **Specialist as preset or as plugin?** Two options: (a) preset = YAML config that references existing AgentPlugins, (b) specialist = a higher-order plugin that wraps AgentPlugins. Option (a) is simpler; (b) is more composable. Lean toward (a) until concrete need for (b).

2. **Storage: SQLite or filesystem?** v2.3 introduces SQLite for queryable state. Agents/refs/specialists/teams could live in SQLite (query-friendly, multi-process safe) OR continue as markdown/YAML files (git-friendly, transparent, no migration). Probably both: SQLite as cache, filesystem as source of truth. Sync via daemon.

3. **Curator persona — single or multiple?** One curator per team, or a curator persona per task type (e.g., "security-cautious curator" vs "throughput-maximizing curator")? Defer; ship single curator first.

4. **Channel adapter authorization model.** Who can dispatch tasks via Jira/Slack? Per-reporter allowlist? Per-channel? Combination. Defer to v2.6 with explicit threat model.

5. **Autonomous mode trust ramp.** New team starts at full-supervised. After N successful auto-completions, eligible for curator-mediated. After M more, eligible for full-autonomous. What are N, M? Defer; ship manual mode-flip first, add automatic trust ramp later if real users find it useful.

6. **UI tech stack.** React + (Mantine / shadcn / Chakra)? Solid? Svelte? Defer to v2.3 implementation. Web UI shell is a big enough decision to get a dedicated mini-spec.

7. **Cost visibility.** Inbox / completed-task views show `$0.18` per task. Where does this number come from? v2.5 multi-provider routing's cost tracking. So cost UI lands in v2.5, but the inbox surface can hide it gracefully until then (just show wall time).

## What this is NOT (UX anti-goals)

- ❌ **Drag-and-drop visual workflow builder** (think n8n / Zapier). The pipeline is FSM-driven, not user-flowchart-driven. Users compose specialists from agents; they don't draw step graphs.
- ❌ **Chat interface as primary UX.** Web UI's chat surface (Layer 6) is for ad-hoc tasks; the primary UX is form-based building + inbox-based reviewing.
- ❌ **Code editor / IDE inside the Web UI.** Out of scope; that's Cursor's job. We're a team coordinator, not an editor.
- ❌ **Generic chatbot personas.** Specialists are scoped to development tasks; we don't ship "marketing copywriter specialist" out of the box.
- ❌ **No-code escape hatch.** Power users can still edit `agents/*.md` directly; UI is a convenience layer, not a wall. Forms serialize to the same files that CLI editors can touch.

## Why this UX is the differentiator

Looking at the AI-tooling landscape:

| Tool | UX model | Multi-agent? | Team / curator? | Channel pickup? |
|---|---|---|---|---|
| Cursor / Claude Code | Chat in editor | No | No | No |
| Devin / Cognition | Chat with one autonomous agent | Single agent | No | Limited |
| CrewAI / AutoGen | Code-driven (build a Python script) | Yes | Limited | Code-level |
| GitHub Copilot Workspace | Issue → PR | No | No | GitHub issues only |
| **claude-pipeline (this vision)** | **Form-based building + inbox-based reviewing** | **Yes** | **Yes** | **Multi-channel** |

**No existing tool has the "form-based agent builder + team curator + multi-channel pickup + autonomous-toggle" combination.** That's the niche the RTS positioning (see [`product-vision.md`](product-vision.md)) is claiming.

## See also

- [`product-vision.md`](product-vision.md) — positioning, target users, pricing tiers, commercial trajectory
- [`v3-productization-roadmap.md`](v3-productization-roadmap.md) — phase index
- [`phases/v2.3-daemon-webui.md`](phases/v2.3-daemon-webui.md) — daemon + Web UI shell (Layer 1 builder + inbox foundation)
- [`phases/v2.6-marketplace.md`](phases/v2.6-marketplace.md) — plugin marketplace + curator (Layers 3-6)
- [`open-backlog.md`](open-backlog.md) — Q-items including Q40 (domain bundles) which generalizes specialists across domains
