# hardening-v2 — Session 2 continuation prompt

> Paste the **PROMPT START / PROMPT END** block below as the FIRST message of a
> fresh Claude Code session opened at `/Users/teaarte/Programming/internal/claude-pipeline`.
> Optimized for quality over speed: each remaining item lands as a clean,
> tested, green-on-main commit.

---

## PROMPT START

You are resuming the v2 hardening of `claude-pipeline`. Session 1 completed
**items 1–7 of 13**. Items 8–13 are pending. Quality matters more than speed:
no half-baked commits, no skipped tests, no pushed changes.

### Source of truth (read FIRST, in this order)

1. **`specs/hardening-v2.session-progress.md`** — commits landed, current
   state, remaining items, forward-looking nudges. This is your starting
   context.
2. **`specs/hardening-v2.md`** — full spec for all 13 items. You will execute
   items 8–13 from this.
3. **`specs/hardening-v2.prompt.md`** — the original launcher. Skim sections
   "The plugin contract", "The shuttle protocol", "Implementation order",
   "Hard rules during execution", "What NOT to do", and "Final acceptance".
4. **`CLAUDE.md`** + **`mcp/README.md`** — current project conventions.

If anything in this prompt conflicts with the spec, **the spec wins**.

### Pre-flight checks (run all five before touching code)

1. `claude mcp list | grep claude-pipeline` shows `✓ Connected`.
2. `git log --oneline -10` includes commit `556c511` as the most recent
   (or near-most-recent). If not, you may be on the wrong branch.
3. `cd mcp && pnpm typecheck` passes.
4. `cd mcp && pnpm test` reports **117 cases passing**.
5. `cd mcp && pnpm smoke` passes.

If any check fails, STOP and surface to the user.

### Remaining items in order

| # | Title | Notes |
|---|-------|-------|
| 8 | TypeScript framework + plugins + driver MCP tools | The heart of v2. ~2200 LoC. Apply user nudges from session-progress.md. |
| 9 | Shuttle markdown `commands/task.md` ≤30 lines | Depends on item 8. |
| 10 | Markdown apocalypse | Delete `pipelines/`, shrink `commands/done.md` ≤30 lines, trim `agents/*.md`. |
| 11 | Past-misses decay | Score function + `pipeline_set_pattern_confidence` tool. |
| 12 | Protocol bump to 2.0 | `pipeline_meta` tool + `mcp/package.json` 2.0.0 + frontmatter. |
| 13 | Golden-state smoke | Local script + synthetic plugin proving extension. |

### Item 8 — internal sub-order (don't skip steps)

1. `mcp/src/driver/types/plugin.ts` + `mcp/src/driver/types/config.ts` +
   `mcp/src/driver/types/shuttle.ts`.
2. `mcp/src/driver/core/state.ts` + `core/registry.ts` + `core/shuttle.ts`.
3. `mcp/src/driver/core/fsm.ts` + `core/invoke-hooks.ts` — generic engine,
   ZERO plugin names. The grep
   `grep -rEi "planner|implementer|logic-reviewer|gate-[012]|simple-flow|medium-flow|complex-flow" mcp/src/driver/core/`
   MUST return nothing. Run it before committing.
4. `mcp/src/driver/builtin/decisions/*.ts` — pure functions, easiest to test.
5. `mcp/src/driver/builtin/agents/*.ts` — wrap each existing `agents/*.md`
   as an `AgentPlugin`. ≥20 of them. Include `resolveAgentModel(plugin, config)`
   helper in this directory.
6. `mcp/src/driver/builtin/gates/*.ts` — 3 of them.
7. `mcp/src/driver/builtin/steps/*.ts` — one per FSM step, ≥17 total.
8. `mcp/src/driver/builtin/hooks/*.ts` — 3 of them.
9. `mcp/src/driver/builtin/spawn/shuttle-provider.ts` — the only spawn provider.
10. `mcp/src/driver/builtin/flows/{simple,medium,complex}.ts` — 3 flows.
11. `mcp/src/driver/loaders/builtins.ts` + `loaders/project-config.ts`
    (stub returning empty overrides).
12. `mcp/src/driver/tools/run-task.ts` + `tools/continue-task.ts` — thin MCP
    wrappers that call `runFSM(state, registry)` from core/fsm.ts.
13. Tests for every plugin (one happy + one rejection per type at minimum)
    + property tests for FSM transitions and shuttle round-tripping.

### Hard rules (carry forward from session 1)

- **No backwards compatibility.** v1 state files don't load.
- **Tests-with-plugin.** Every plugin file ships with its own test file in
  the same commit. No "tests later".
- **Plugin-name-free core.** The grep gate above is enforced before each
  commit during item 8.
- **Plugins register only in `loaders/builtins.ts`.** No other file in
  `mcp/src/driver/core/` touches the registry.
- **Pre-commit gates.** `pnpm typecheck && pnpm test && pnpm build && pnpm smoke`
  all green. Each commit leaves main green.
- **One commit per item.** Conventional Commit subject. Footer:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **No push** without explicit user permission.

### Forward-looking nudges (already in session-progress.md, repeated here)

1. **`types/config.ts`** exports `ClaudePipelineConfig` with
   `default_models_by_phase`, `agent_overrides`, `gate_policy`,
   `notification_targets`, `plugin_enabled`. v2.5 Web UI's edit target.
2. **`AgentPlugin` model resolution** uses the cascade
   `agent_overrides[name].model ?? default_models_by_phase[phase] ?? plugin.default_model`.
   Helper `resolveAgentModel(plugin, config)` in `builtin/agents/`.
3. **Encapsulated state IO.** No `fs.writeFile` outside `tools/` or `driver/`.
4. **Transport-agnostic driver.** `runFSM(state, registry)` in
   `driver/core/fsm.ts` is independent of MCP transport. MCP tools are thin
   wrappers; the v2.5 HTTP API will call `runFSM` directly.

### Stop-conditions

If you're about to run out of context mid-item, STOP at the last clean
commit boundary. Update `specs/hardening-v2.session-progress.md` with:
- New SHA list.
- Which item is in-progress (if any) and what's done vs missing.
- Any new deviations from spec.

Hand off to another session with a similar prompt to this one.

### Output expected at the end

If you complete items 8–13: a short final report (≤500 words) covering:

- 13 commit SHAs in order (session 1 + session 2).
- Final `pnpm test` coverage (line + branch percentages).
- Defaults chosen for any remaining open questions.
- Deviations from spec, with reasoning.
- Confirmation that
  `grep -rEi "planner|implementer|logic-reviewer|gate-[012]" mcp/src/driver/core/`
  returns no matches.
- Compliance check for the four user nudges above (1–4).

If you only complete some items: update session-progress.md and stop.

## PROMPT END

---

## Best-practice notes for the human handing this off

1. **Open the new Claude Code session in the same directory** so working
   directory and git state match.
2. **Don't paste session 1 context.** This prompt + the session-progress.md
   are everything the next agent needs. Pasting more dilutes attention.
3. **If the agent asks clarifying questions about scope or quality
   tradeoffs**, prefer "ship fewer items at higher quality" over "ship more,
   lower quality". Session-progress.md will absorb whatever lands.
4. **Verify after each item commit** by spot-reading the diff, especially
   for item 8 (large surface). The grep gate is the single most important
   automated check — run it yourself if doubting.
5. **Don't push** until session 2 reports done and you've reviewed all
   13 commits. Items 8–13 are where the framework lives; a rebase later is
   much more painful than a careful review now.
