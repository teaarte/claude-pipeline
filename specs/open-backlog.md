# Open backlog

Active Q-items not yet shipped. Updated when new bugs surface from real-task validation OR existing items change status (e.g., Q41 partial → fully shipped when v2.3 daemon activates LLM path).

For closed items, see [`closed-q-items.md`](closed-q-items.md). For pipeline phase plans, see [`phases/`](phases/).

## Currently open

| Q | Severity | Status | Notes |
|---|---|---|---|
| Q41 | 🟡 MEDIUM | **partial** | refs-to-load LLM-driven path inactive in prod (shuttle leaves `query?()` undefined). Regex fallback active. Activation requires v2.3 daemon's non-shuttle SpawnProvider (Anthropic SDK direct). No code change needed in refs-to-load when v2.3 lands. |
| Q44 | 🟡 MEDIUM | open (LLM-blocked) | **`antipattern-candidates.md` near-100% false-positive rate.** `anti-pattern-grep` hook uses naive word-overlap: tokenizes CLAUDE.md "What NOT to Do" rule text (`return`, `from`, `services`, `error`, `catch`, `create`, etc.) and searches diff for those tokens. Common English words appear in every TypeScript diff → every rule matches → reviewer ignores the file → infrastructure cost without value. **Architecturally correct fix:** classification problem, not pattern-matching. Hook should issue a small LLM classification call (`SpawnProviderPlugin.query?()`) per rule × diff: *"Given this rule text and this diff, list real violations as `file:line - <1-sentence>` OR `(none)`"*. High-precision results; reviewer trusts the file again. **Blocked on Q41 LLM-path activation** (waits for v2.3 daemon's non-shuttle SpawnProvider). Pragmatic interim fix: emit audit entry `error_class: "llm-classification-needed"` when hook fires AND `ctx.spawn_provider.query` is unavailable, so the cost-of-noise is visible. ~30min for observability fix; full LLM-driven fix ~2h after Q41 activates. Filed from wandr-be techdebt-cleanup run 2026-05-14. | `mcp/src/driver/bundles/code/hooks/anti-pattern-grep.ts` (after v2.2.5). |
| Q45 | 🟡 MEDIUM | open (LLM-blocked) | **`refs-to-load` regex fallback is English-only.** Real-task on `wandr-be` had Russian task description → zero regex matches → `refs_to_load: []`. **Not a separate bug from Q41.** Q41's LLM-driven path solves multilingual relevance for free; Q45 is the visible *manifestation* of Q41 being partial in production. **Architecturally:** picking refs is a classification problem (which N from list M are most relevant?) — LLM-tool, not regex pattern matching. Pragmatic interim: emit audit entry `error_class: "llm-classification-needed"` when regex returns `[]` AND task text length > N chars, so the gap is observable. ~30min. Full multilingual support comes with Q41 LLM-path activation in v2.3. **Do not** patch regex with multilingual keyword sets — that doubles maintenance burden of the wrong abstraction. Filed from wandr-be run 2026-05-14. | `mcp/src/driver/bundles/code/decisions/refs-to-load.ts` (after v2.2.5). |
| Q46 | 🟡 MEDIUM | open (LLM-blocked) | **Non-Latin task description → useless `task_id` slug.** Real-task on `wandr-be` had Russian task → `sanitizeTaskIdSlug` strips non-`[a-z0-9]` → empty → Q7 fallback pads with random hex → `task_id: "t-2026-05-14-31fb"`. **Architecturally:** generating a meaningful short identifier from arbitrary text is a classification/synthesis problem — LLM-tool, not transliteration libraries. Right fix: small `SpawnProviderPlugin.query?()` call — *"Generate a 8-15 char English semantic slug for this task description: '...'. Format: lowercase letters and digits, no separators. Output: <slug> only."* → output `"techdebtsweep"` or similar. Cost ~$0.0005/task on haiku tier. **Blocked on Q41 LLM-path activation.** Pragmatic interim: keep current hex fallback; emit audit entry `error_class: "llm-classification-needed"` when slug becomes pure hex (sanitize stripped > 50% of input) so the gap is observable. ~30min for observability; full LLM-driven fix ~1h after Q41 activates. **Do NOT** add transliteration libraries — covers Cyrillic but breaks for Chinese/Korean/Japanese/Arabic anyway. LLM call covers all scripts uniformly. Filed from wandr-be run 2026-05-14. | `mcp/src/lib/ids.ts` `sanitizeTaskIdSlug` + LLM-call hook for slug synthesis. |
| Q47 | 🟢 LOW | open | **`gate1_revisions: 0` in metrics row despite Gate 1 rejection cycle.** Real-task wandr-be: user rejected Gate 1 (7-bullet feedback for revision) → plan revised → Gate 1 approved on iter 2. Metrics row shows `gate1_revisions: 0`. Either (a) Q8 mirror doesn't bump `scratch.gate1_revision_count` on this specific code path (text-feedback rejection vs button-style), or (b) Q22 `extractMetricsRow` doesn't read the scratch counter. State cleaned post-`/done` — can't inspect without next reproduction. **Severity LOW** — single metric field, not pipeline-blocking. Investigation on next Gate 1 rejection run. Filed from wandr-be run 2026-05-14. | `mcp/src/driver/builtin/steps/index.ts` mirror branch + `mcp/src/tools/finish.ts` derivation. |

## Scheduled (was deferred)

| Q | Severity | Where it lands | Notes |
|---|---|---|---|
| Q40 | architectural | [`phases/v2.2.5-bundle-foundation.md`](phases/v2.2.5-bundle-foundation.md) | **Promoted from deferred 2026-05-14.** End-goal is virtual teams for any niche (code / content / marketing / research / VFX) per [`ui-vision.md`](ui-vision.md). Bundle abstraction becomes prerequisite for v2.3 daemon + Web UI rather than a post-hoc retrofit. Phase v2.2.5 (~5-7d) ships: `Bundle` first-class concept, directory move `builtin/` → `bundles/code/`, `loaders/bundles.ts`, `state.bundle` field, Phase enum → flow-declared, `pipeline.config.json` per project, skills bundle-parameterized, `MCPClientPlugin` contract (external MCP consumer), `state.team_knowledge_refs` slot. |

## Deferred (no trigger to fix yet)

| Q | Severity | Why deferred | Trigger to activate |
|---|---|---|---|
| Q38 | 🟢 LOW | Terminal-tab auto-rename via OSC-0 — Claude Code Bash tool subprocess has no TTY; can't reach user terminal. | Solved natively by v2.3 Web UI (browser tabs instead of terminal escape codes). No fix needed in pipeline. |

## Code-quality follow-ups (v2.2-code-polish bundle, separate)

Surfaced by architecture review post-v2 ship. Not validation-driven (no real-task data backs them). Bundle them whenever convenient — these don't unblock anything user-visible.

| Q | Severity | Effort | What |
|---|---|---|---|
| Q1 | code-quality | ~1d | Reduce 33 `any` types across `mcp/src/` to typed equivalents. Mostly `(state as any).field` patterns that have proper types if traced. |
| Q2 | code-quality | ~1d | `mcp/src/driver/builtin/steps/index.ts` is a 1000+ line hot file. Split per step-kind (review, gate, spawn, etc.) — each ~150 lines. |
| Q3 | code-quality | ~30min | Reviewer/validator agent output examples are 30-50 lines each, structurally identical across 13 files. Consolidate to single `templates/agent-output-formats.md` reference + per-agent category list. |
| Q4 | code-quality | ~30min | `mcp/src/driver/types/plugin.ts` is the only file >300 lines in types/. Split per contract (one file per plugin interface) for cleaner import boundaries. |
| Q5 | code-quality | ~30min | Add CI threshold for test:source ratio. Currently 76% (343 test : ~450 source). Fail if drops below 60%. |
| Q6 | code-quality | ~1-2h | Consolidate single source of truth for agent output examples (overlaps Q3 — possibly merge). |

**Total v2.2-code-polish bundle effort:** ~3-5 days. Ship when:
- Boredom strikes between feature work
- Before adding any new agent template (saves rework)
- As a "warm-up bundle" before a bigger phase

## Adding new Q-items

When real-task validation surfaces a new bug:

1. Add a row to this file's "Currently open" table with severity (🔴 HIGH / 🟡 MEDIUM / 🟢 LOW) + 1-line summary.
2. Add a per-task entry in [`../validation/closed-tasks/`](../validation/closed-tasks/) (or update existing one if mid-flight).
3. Reference the Q-number in commit messages when fixing.
4. On merge → move row to [`closed-q-items.md`](closed-q-items.md) under the relevant bundle, with commit SHA.

**Severity guide:**
- 🔴 HIGH — blocks further validation / breaks `/done` / corrupts state
- 🟡 MEDIUM — degrades correctness or observability silently
- 🟢 LOW — cosmetic / UX friction / non-blocking

Q-numbers monotonically increase (next: Q48). Numbers are stable across closures — once Q39 was filed, it stays Q39 even after fix.
