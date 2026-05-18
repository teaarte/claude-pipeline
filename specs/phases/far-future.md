# Far-future phases (P1, P3-P5) — sketches only

Phases not on the immediate execution path. Sketched here for direction; concrete planning happens when v2.6 commercial layer is real and the relevant trigger arrives. Do not treat as commitment.

## Phases included

- **P1** — Open source + npm distribution (OSS posture, license, package layout)
- **P3** — Team / collaboration features (Pro → Team tier)
- **P4** — Hosted tier (commercialization — opt-in cloud, billing, SLA)
- **P5** — Editor integrations beyond Claude Code (Cursor, VS Code extension)

Phase **P2** (plugin marketplace) is split into its own file as it maps to v2.6 in compact numbering — see [phases/v2.6-marketplace.md](v2.6-marketplace.md).

---

# Phase P1 — Open source + npm distribution

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

**Goal:** run from environments other than Claude Code chat. Multi-LLM provider support lives in v2.5 (shipped before this phase).

### P5.1 — Editor integrations beyond Claude Code

- VS Code extension that exposes `/task` via command palette.
- JetBrains plugin.
- Both run the same TS driver under the hood.

**Phase P5 effort:** 6–8 weeks.

**Phase P5 success signal:** ≥30% of usage is outside Claude Code.

---

## Phase P-K — Knowledge-as-data (post-v2.6, v3+ territory)

**Goal:** turn knowledge that today lives in filesystem artifacts into queryable, editable, versioned data.

Today's refs catalog (`agents/references/*.md`), candidate lists (`templates/stack-candidates.yaml`), anti-pattern rules (per-project CLAUDE.md), and agent templates (`agents/*.md`) are filesystem artifacts. v2.6 marketplace adds plugin-as-npm-package; that's filesystem too.

Long-term direction: this content moves to a **knowledge store** (SQLite locally; Postgres for hosted Team tier) so:

- Editing a ref / rule in the Web UI applies to next `/task` without a release.
- Per-project overrides without forking the repo.
- Team-shared knowledge with versioning + curator-controlled promotion (extends `state.team_knowledge_refs` from v2.2.5 Item 7).
- Cross-project pattern mining (categories of bugs that recur across projects → auto-emitted anti-pattern rules).

### Implementation prerequisites (in order)

1. `StateStorePlugin` from v2.3 generalizes to `KnowledgeStorePlugin`.
2. Candidate lists migrate from YAML files (`templates/stack-candidates.yaml`) to DB rows — low-risk first step, schema is already structured.
3. Refs catalog migrates: each ref becomes a row with frontmatter + content + version + author. Reviewer agents query by `agent_hints` + `when_to_load`.
4. Anti-pattern rules migrate per-project: from CLAUDE.md sections to per-project rule rows + global rule library.
5. Agent templates migrate last — they're the highest-risk migration since they're the model contract; prose changes there directly shift agent behaviour.

### Migration shape

Migration is **gradual** — each artifact type can move independently. Filesystem fallback retained throughout. A project without DB access stays fully functional on filesystem artifacts.

### Trigger

Not scheduled. Activates when (a) editing knowledge in UI becomes a felt need (probably after first hosted-tier customer asks "can I curate the refs?"), OR (b) Team tier shipping requires shared knowledge primitives.

**Phase P-K effort:** open-ended; one artifact-type per release.

---

