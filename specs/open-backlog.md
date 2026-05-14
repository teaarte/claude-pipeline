# Open backlog

Active Q-items not yet shipped. Updated when new bugs surface from real-task validation OR existing items change status (e.g., Q41 partial → fully shipped when v2.3 daemon activates LLM path).

For closed items, see [`closed-q-items.md`](closed-q-items.md). For pipeline phase plans, see [`phases/`](phases/).

## Currently open

| Q | Severity | Status | Notes |
|---|---|---|---|
| Q41 | 🟡 MEDIUM | **partial** | refs-to-load LLM-driven path inactive in prod (shuttle leaves `query?()` undefined). Regex fallback active. Activation requires v2.3 daemon's non-shuttle SpawnProvider (Anthropic SDK direct). No code change needed in refs-to-load when v2.3 lands. |
| Q44 | 🟡 MEDIUM | open | **`antipattern-candidates.md` near-100% false-positive rate.** `anti-pattern-grep` hook uses word-overlap matching: tokenizes CLAUDE.md "What NOT to Do" rule text (`return`, `from`, `services`, `error`, `catch`, `create`, etc.) and searches diff for those tokens. Common English words appear in every TypeScript diff → every rule matches → reviewer ignores the file → infrastructure cost without value. **Fix options:** (a) **preferred** — CLAUDE.md rules get optional explicit `Pattern: <regex>` line; hook reads pattern instead of tokenizing rule text. (b) Hook generates pattern via small LLM classification call (extract formal regex from rule text), caches. **Effort:** ~2-3h (option a) or ~1d (option b). Filed from wandr-be techdebt-cleanup run 2026-05-14. | `mcp/src/driver/bundles/code/hooks/anti-pattern-grep.ts` (after v2.2.5; currently `builtin/hooks/`) + CLAUDE.md format docs. |
| Q45 | 🟡 MEDIUM | open | **`refs-to-load` regex fallback is English-only.** Q41 LLM path is inactive in prod (waits for v2.3 daemon's non-shuttle SpawnProvider). Until then, regex fallback matches keywords like `architecture\|service\|cache\|auth\|api\|...` — purely English. Real-task on `wandr-be` had Russian task description ("посмотри кб и почитай что у нас в техническом долге") → zero regex matches → `refs_to_load: []` → reviewers spawned without domain refs. Similar fate awaits Spanish / Chinese / French / etc. users running pipeline in their native language. **Fix options:** (a) extend regex patterns with multilingual keyword sets (русские/español/中文/etc.) — viable but maintenance burden; (b) **preferred** — when regex returns `[]` AND task length > N chars, emit audit entry `error_class: "regex-fallback-empty"` so the gap is observable; full fix waits for Q41 LLM path. (c) Document as known limitation in `commands/task.md`. **Effort:** ~1h (option b). Filed from wandr-be run 2026-05-14. | `mcp/src/driver/bundles/code/decisions/refs-to-load.ts` (after v2.2.5). |
| Q46 | 🟡 MEDIUM | open | **Non-Latin task description → useless `task_id` slug.** Real-task on `wandr-be` had Russian task → `sanitizeTaskIdSlug` strips non-`[a-z0-9]` → empty string → Q7 fallback pads with random hex → final `task_id: "t-2026-05-14-31fb"`. The 4-hex slug carries zero semantic information about the task — cross-task grep by task_id useless for non-English-speaking users. Affects Cyrillic, Greek, Chinese, Korean, Japanese, Arabic, Hebrew tasks. **Fix:** transliterate before slug strip. Use ICU transliteration OR a lib like `transliteration` npm package OR a small inline `cyrillic-to-latin` map for the common case. "посмотри кб" → "posmotri-kb" → slug `posmotrikb`. **Effort:** ~1-2h + 1 small dep + tests. Filed from wandr-be run 2026-05-14. | `mcp/src/lib/ids.ts` `sanitizeTaskIdSlug` + add unicode-aware transliteration step. |

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

Q-numbers monotonically increase (next: Q47). Numbers are stable across closures — once Q39 was filed, it stays Q39 even after fix.
