# Open backlog

Active Q-items not yet shipped. Updated when new bugs surface from real-task validation OR existing items change status (e.g., Q41 partial → fully shipped when v2.3 daemon activates LLM path).

For closed items, see [`closed-q-items.md`](closed-q-items.md). For pipeline phase plans, see [`phases/`](phases/).

## Currently open

| Q | Severity | Status | Notes |
|---|---|---|---|
| Q41 | 🟡 MEDIUM | **partial** | refs-to-load LLM-driven path inactive in prod (shuttle leaves `query?()` undefined). Regex fallback active. Activation requires v2.3 daemon's non-shuttle SpawnProvider (Anthropic SDK direct). No code change needed in refs-to-load when v2.3 lands. |

(Just one item — and even this isn't blocking. v2.2a closed all 6 review-completeness items; Q41 is the residual "contract present, LLM call needs daemon" piece.)

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

Q-numbers monotonically increase (next: Q44). Numbers are stable across closures — once Q39 was filed, it stays Q39 even after fix.
