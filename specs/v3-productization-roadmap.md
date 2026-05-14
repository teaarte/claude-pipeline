# v3 productization roadmap — index

**Status:** strategic — not committed. Each phase here gets its own detailed spec when it's time to execute. Phases are sized in days/weeks of focused work, not specific commits.

This file is the **navigation index**. Detailed phase plans live in [`phases/`](phases/). Q-item backlog lives in [`open-backlog.md`](open-backlog.md) + [`closed-q-items.md`](closed-q-items.md). Product positioning lives in [`product-vision.md`](product-vision.md).

> **Numbering note** (2026-05-14): phase numbers compacted from gappy `v2.5/v2.6/v2.7/v2.8` to consecutive `v2.3/v2.4/v2.5/v2.6`. **`v3.0`** is reserved for fleet + multi-tenancy + commercial launch. Strict semver adopted when external alpha users + version pinning matter — at v2.3 daemon ship. See `product-vision.md` for trajectory.

---

## Where we are (post v2.2a-review-completeness ship)

- **v2.0** shipped — TypeScript plugin framework, 21 MCP tools, 12 invariants, audit log, guard hook, 209 tests → 343 tests today.
- **v2.1** shipped (PR #1) — 11 validation-driven fixes (Q8/Q11/Q14/Q17-Q24/Q36 from real-task signal).
- **v2.2** shipped (PR #2) — schema hygiene + polish (Q10/Q25/Q26/Q28/Q29/Q31/Q32/Q33/Q34/Q37).
- **v2.2a** shipped (PR #3) — review surface unlocked (Q9/Q27/Q30/Q41 partial/Q42/Q43). 5 reviewers now fan out on non-simple flows; pre-review infrastructure files emitted; metric correctness fixed.
- **5 real-task validation runs** on s3-panel captured in [`../validation-log.md`](../validation-log.md) + per-task files in [`../validation/closed-tasks/`](../validation/closed-tasks/).

**Open backlog:** see [`open-backlog.md`](open-backlog.md). Tiny — Q41 partial (residual until v2.3) + Q38 deferred + Q40 deferred + Q1-Q6 code-polish.

**Tags:** [`v2.0`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.0), [`v2.1`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.1), [`v2.2`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2), [`v2.2a`](https://github.com/teaarte/claude-pipeline/releases/tag/v2.2a).

---

## Phase plans (active path)

| Phase | Status | Detail | Estimated effort |
|---|---|---|---|
| **v2.3** — Daemon + Web UI + Multi-provider foundation | next | [`phases/v2.3-daemon-webui.md`](phases/v2.3-daemon-webui.md) | ~1-2 weeks |
| **v2.4** — Container isolation + Docker distribution | scheduled | [`phases/v2.4-docker.md`](phases/v2.4-docker.md) | ~1 week |
| **v2.5** — Cost-aware multi-provider routing | scheduled | [`phases/v2.5-multiprovider.md`](phases/v2.5-multiprovider.md) | ~2-3 weeks |
| **v2.6** — Plugin marketplace + curator agent | scheduled | [`phases/v2.6-marketplace.md`](phases/v2.6-marketplace.md) | ~2-3 weeks |
| **v3.0** — Fleet + multi-tenancy + commercial launch | future | not yet detailed — see `product-vision.md` commercial trajectory | ~1-2 months |

Far-future P1/P3/P4/P5 phases (OSS distribution, team features, hosted tier, editor integrations) sketched in [`phases/far-future.md`](phases/far-future.md).

---

## Recommended execution order

1. **Validation pause** — before v2.3, run `/task` on 2-3 different projects (NOT s3-panel) to surface domain-genericity bugs. ~3-6h. See "Second-project validation" note below.
2. **v2.3** — daemon + Web UI on single instance. Activates Q41's LLM path automatically.
3. **v2.4** — Docker isolation (orthogonal to v2.3, can be parallel if energy permits).
4. **v2.5** — Cost-aware multi-provider routing. Commercial prerequisite (margin calculus). Activates haiku-routing for ~60% of agents.
5. **v2.6** — Plugin marketplace + curator agent. First Pro-tier feature.
6. **v3.0** — Fleet abstraction (multi-tenant, multi-machine, central metric store).

**Second-project validation rationale:** all 5 real-task runs to date have been on `s3-panel` (TypeScript pnpm-monorepo frontend). Generalizability to Python/Go/Rust/library/different-monorepo-shapes untested. Validating on 2-3 different projects before v2.3 is ~3-6h investment vs ~1-2 weeks on daemon — cheap signal acquisition.

---

## Cross-cutting concerns (apply throughout all phases)

These design constraints persist across phases — every phase plan respects them:

- **Plugin contracts stay stable.** Adding fields is OK if optional. Removing fields is a major version bump.
- **Schema versioning.** `schema_version` bumps only on breaking changes. v2.0 schema still validates v2.2a state files (additive only).
- **MCP tool count.** Stays at 21 unless a phase explicitly adds. Each addition is a registry entry + tool spec + tests + README update.
- **Audit log.** Every MCP tool call emits an entry. Redaction must hold for global stream (`~/.claude/metrics/mcp-audit.jsonl` strips `project_dir`).
- **Guard hook.** Protected basename list is the source of truth for what `.claude/*` files are MCP-managed. Additions require updating `pipeline-guard.sh:33` + 20 evasion fixtures.
- **Validation-driven discipline.** Every real-task run generates a per-task file in `validation/closed-tasks/`. Q-items get filed in `open-backlog.md`, moved to `closed-q-items.md` on merge.

---

## Out of scope (intentionally NOT in roadmap)

- **Build own LLM.** Use Anthropic / OpenAI / etc. as providers.
- **Generic AI chat interface.** Cursor / Claude Code own this.
- **Single autonomous agent.** Devin / Cognition own this. Pipeline's differentiation is multi-agent team.
- **IDE plugin (initial).** Headless / CLI / Web UI first. IDE plugin is P5 future.
- **Self-hosted multi-tenant SaaS.** Single-tenant self-hosted is v3.0; commercial SaaS is P4.

---

## What this roadmap does NOT promise

- **Specific dates.** Effort estimates only.
- **External user count.** Validation discipline applies; growth depends on distribution work that's a separate concern.
- **Feature completeness vs competitors.** Pipeline's bet is on architectural quality + niche positioning (RTS framing), not feature parity.
- **Stable plugin marketplace.** v2.6 ships a marketplace; trust model + signed publishers might take iterations to harden.

See [`product-vision.md`](product-vision.md) "Anti-goals" section for sharper bounds.

---

## Concrete next step

After v2.2a merge:

1. Real-task verification on a security + UI + API task (e.g., password-change form). Mid-flight check: `jq '.phases.implementation.agents' .claude/pipeline-state.json` should show 5+ reviewers, not just 2. If yes → Q9 fix unlocked. If not → file v2.2b items.
2. Second-project validation (2-3 different projects). Surface domain-genericity bugs.
3. Start [`phases/v2.3-daemon-webui.md`](phases/v2.3-daemon-webui.md) work when validation signal is stable.

---

## See also

- [`product-vision.md`](product-vision.md) — positioning, target users, pricing tiers, commercial trajectory, domain boundary, autonomous mode
- [`open-backlog.md`](open-backlog.md) — currently open + deferred + code-quality items
- [`closed-q-items.md`](closed-q-items.md) — historical Q-item record by bundle
- [`../validation-log.md`](../validation-log.md) — validation workflow + cross-cutting observations
- [`../validation/closed-tasks/`](../validation/closed-tasks/) — per-task validation entries
- [`done/`](done/) — archived launcher prompts (v2.1, v2.2, v2.2a)
