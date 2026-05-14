# v3 Productization Roadmap

**Status:** strategic — not committed
**Prerequisite:** v2 hardening shipped (`specs/hardening-v2.md` complete)
**Purpose:** convert `claude-pipeline` from personal tooling into a usable product. Each phase is independently shippable.

This document is **strategic, not tactical**. Each phase here gets its own detailed spec when it's time to execute. Phases are sized in days/weeks of focused work, not specific commits.

> **Version-numbering note (2026-05-14):** phase numbers compacted from gappy `v2.5/v2.6/v2.7/v2.8` to consecutive `v2.3/v2.4/v2.5/v2.6`. **Mapping:**
> - old `v2.5` (daemon + Web UI) → **`v2.3`**
> - old `v2.6` (Docker isolation) → **`v2.4`**
> - old `v2.7` (cost-aware multi-provider routing) → **`v2.5`**
> - old `v2.8` (plugin marketplace + curator) → **`v2.6`**
> - **`v3.0`** reserved for fleet + multi-tenancy + commercial launch
>
> Old gaps were sigil-y signaling without semantic meaning. Compact numbering is cleaner for a single-author project pre-external-users. Strict semver (breaking changes = major bump) will be adopted once external alpha users + version pinning become real concerns — likely at v2.3 daemon launch. See `specs/product-vision.md` for the full product trajectory and commercial phasing.

---

## Where v2 leaves us

v2 has shipped (commit range `67d736f`…`128ab51`, 13 spec items + handoff commits + **4 code-review fix commits** `20a626e`/`ed828f8`/`817a09d`/`128ab51`). Actual delivered state:

- **Plugin framework architecture:** all 7 plugin contracts in `mcp/src/driver/types/plugin.ts` (`StepPlugin`, `AgentPlugin`, `FlowPlugin`, `GatePlugin`, `DecisionPlugin`, `HookPlugin`, `SpawnProviderPlugin`) + `PLUGIN_API_VERSION = "1.0"`.
- **Built-in plugins:** 23 steps, 20 agents, 3 flows, 3 gates, 6 decisions, 3 hooks, 1 spawn provider (`shuttle`). All spec minima met.
- **MCP-enforced state invariants:** `INV_001`–`INV_012` (added INV_012 open-spawn leak in Item 3).
- **MCP tool count:** **20** (initial 19 at v2 ship + `pipeline_fix_task_id` added in v2.1-hotfix Q15).
- **Audit log:** per-project (`.claude/mcp-audit.jsonl`) + global (`~/.claude/metrics/mcp-audit.jsonl`).
- **Test infrastructure:** vitest + fast-check property tests + CI workflow. **209 tests across 33 files** (post-v2.1-hotfix: was 179/29 at v2 ship, +30 tests from hotfix bundle). 94%+ line coverage maintained.
- **Protocol versioning:** `PLUGIN_API_VERSION = "1.0"`, `mcp/package.json 2.0.0`, frontmatter pin `mcp_protocol_required: "^2.0"` in `commands/task.md`.
- **Recovery paths:** `pipeline_abandon` + `pipeline_cancel_spawn` + `commands/done.md` (21 lines) with INV_001–INV_012 + stale-spawn recovery hints inline.
- **Guard hook hardened:** Item 4 added marker-based scoping (`.mcp-managed`), TTL bypass via `.mcp-bypass-allowed`, regex coverage expansion. **Code review extended this to 20 evasion fixtures** all blocked, including: `bash -c "rm ..."`, command substitution `$(rm ...)`, `os.system('rm ...')`, `subprocess.*`, `find -delete`, `find -exec rm`, relative paths (resolved against `$PWD`), split-form `find /x/.claude -name pipeline-state.json -delete`, `gzip/bzip2/xz/zstd` in-place, `pwsh -Command "Remove-Item"`, attempts to delete `.mcp-managed` itself. Protected basenames now include `driver-state.json`, `.mcp-managed`, `.mcp-bypass-allowed` (so the marker files protect themselves). **Bypass marker forgery prevented** via `issued_at + TTL cap` check (3600s max from issue time; `pipeline_unlock_writes` refuses to extend active marker without `force=true`). **Path traversal blocked** by new `mcp/src/lib/project-dir.ts:assertProjectDirAllowed()` (restricts `project_dir` to cwd / `TMPDIR` / `~/.claude/settings.json:pipeline.allowed_project_roots`).
- **Foundation for later phases** already in place (no need to redo in v2.3+):
  - `mcp/src/driver/types/config.ts` exports `ClaudePipelineConfig` with `default_models_by_phase`, `agent_overrides`, `gate_policy`, `notification_targets`, `plugin_enabled`.
  - `mcp/src/driver/builtin/agents/resolve-model.ts` implements the `agent_overrides[name].model ?? default_models_by_phase[phase] ?? plugin.default_model` cascade. **Phase is passed explicitly from caller** (review fix L2 — no more string-matching `template_path` heuristic).
  - State IO encapsulated: `pipeline-state.json`, `findings.jsonl`, `mcp-audit.jsonl`, `driver-state.json` written ONLY inside `mcp/src/tools/*` and `mcp/src/driver/core/state.ts`.
  - Driver transport-agnostic: `runFSM(state, registry)` in `driver/core/fsm.ts` does not depend on MCP; `pipeline_run_task` and `pipeline_continue_task` are thin wrappers.
  - **Driver↔pipeline-state wiring closed (review fix arch01/02):** `pipelineRunTask` calls `pipelineInit`; `runFSM` accepts an injected `SpawnRecorder`; `mcpSpawnRecorder` routes every `beginSpawn` through `pipelineBeginAgent`; `pipelineContinueTask` calls `pipelineRecordAgentRun`/`pipelineRecordNonreviewAgent` for `agent-result` / `agents-results` — `open_spawns[]` close correctly.
  - **Concurrency-safe (review fix conc01):** both `pipelineRunTask` and `pipelineContinueTask` wrapped in `withDriverStateLock`; concurrent invocations cannot clobber driver state. `pipelineRunTask` refuses to overwrite in-flight state (returns `IN_FLIGHT_TASK` shuttle response with recovery options).
  - **`lib/ids.ts` consolidates** `makeFindingId`, `makeFeedbackId`, `makeAgentRunId`, `AGENT_RUN_ID_PATTERN`. v2.3+ should import from here, not reinvent.
  - **`lib/audit.ts` is concurrency-safe and bounded:** `proper-lockfile.lock` around read-trim-rename; stat-based fast path skips read when file fits in 3MB; global stream redacts `project_dir`/`task`/`task_short`/`reason` to length markers (`redactForGlobal`); per-project stream capped at 50k entries; IO errors go to stderr (not silent).
  - **`lib/parse-json-header.ts` bounded:** `LENIENT_OBJECT_CEILING=128KB`, `LENIENT_RETRY_CAP=5` — patological inputs no longer cause O(n²).

### Known follow-ups from v2 execution (defer to v2.3 or v2.1 hot-fix)

1. **`agents/*.md` cleanup** — 4 files still mention "orchestrator" (Item 10 was light-touch). Template loading verified working; cosmetic cleanup deferred. Fold into v2.3 (when agents/*.md gets new model-resolution metadata anyway).
2. **`pipelines/` symlink in `~/.claude/`** — pointed at deleted `repo/pipelines/`. Removed during v2 post-flight. New installs won't have this issue.
3. **`pipeline-guard.sh` is a copy in `~/.claude/hooks/`** (not a symlink to repo). Means hook updates require manual sync. Consider symlinking in v2.3 (or document `ln -sf` in install script).
4. **`set-phase-status.ts` coercion** — Item 7 spec named this file as a coercion site, but it has no integer args today. Left untouched.

### Deliberately deferred from code review (track for v2.3+)

These were flagged in the v2 code review and consciously deferred — fix when their cost/benefit improves:

1. **Sec sec005 — nested-project marker walk.** `find_marker_dir` takes the NEAREST `.mcp-managed`. No real leak (bypass marker reads from same dir as `.mcp-managed`), but documented edge case if user has nested projects with conflicting markers.
2. **Perf I2 — `get-past-misses` reads whole `pipeline.jsonl`.** Fine at <5MB scale (~500KB per 1000 tasks). Convert to streaming tail-N when file grows. v2.3+ candidate.
3. **Challenger #8 — audit reads pipeline-state on every call.** 5-15ms on hot cache. Threading `task_id` through 20 tool signatures was not justified at v2. Revisit when audit becomes a hot path (P3 team-scale era).

### Code quality follow-ups from architecture review

The v2 codebase passes all functional acceptance criteria (180 tests green, 94% line coverage, grep-gate clean) but a post-shipping architecture review surfaced refinement opportunities. None are blocking; each is a bounded improvement that raises the bar without rewriting anything. Group them as a **v2.1 code-polish round** before starting v2.3.

| # | Issue | Effort | Where |
|---|-------|--------|-------|
| Q1 | **`: any` usage too high (33 occurrences).** Plugin registry maps, parsed JSON, and a few deserialization sites use `: any` where proper generics or `unknown` + narrowing would catch real bugs. Target: <10. | ~1 day | `grep -rn ": any\b" src` — audit each, replace with `unknown` / specific generic / proper type. |
| Q2 | **Split monolithic `steps/index.ts` (364 lines, 23 steps).** Single file = future conflicts hotspot. Pattern is well-defined; one StepPlugin per file is the framework's own example for external plugins, so built-ins should follow it. | ~1 day | `mcp/src/driver/builtin/steps/{classify,plan,review,...}.ts` + barrel re-export from `index.ts`. |
| Q3 | **Typed `DriverState.scratch`.** Currently `Record<string, unknown>` — convenient but loses type safety on `agent_output_<id>` / `__spawn_issued_<step>` conventions. Discriminated union for known scratch shapes catches "step assumes key X but writer used key Y" bugs at compile time. | ~1-2 days | New `DriverScratch` type in `driver/types/plugin.ts`; gradual refactor in each step. |
| Q4 | **Lean into `satisfies` for typed const literals.** Only 1 file uses TS 4.9+ `satisfies` today. `as const satisfies StepPlugin` for built-in registrations + flow definitions would catch shape drift at compile time without runtime cost. | ~0.5 day | `mcp/src/driver/builtin/{flows,gates,decisions}/index.ts`, `loaders/builtins.ts`. |
| Q5 | **CI threshold for test:source ratio.** Currently 76% (3535 test : 4654 source). Add a `pnpm metrics:ratio` check that fails if ratio drops below 60%. Prevents regression as the codebase grows. | ~0.5 day | `scripts/test-source-ratio.ts` + GitHub Actions step. |
| Q6 | **Single source of truth for agent output examples.** Each `agents/*.md` currently inlines a 30-50-line JSON example template; structurally identical across 14 reviewer/validator agents. Schema-validation already enforces correctness — the duplication is cosmetic but high-maintenance (schema change → 14 file edits). Consolidate: each agent's "Output" section becomes a 5-line reference to `templates/agent-output-formats.md` (canonical structure) + the agent-specific category list (kept inline — LLM-friendly). Saves ~500 lines total; eliminates drift risk on field ordering / placeholder strings. **Defer triggers:** before adding any new reviewer/validator agent, OR if real-use validation surfaces multiple `schema validation failed` MCP errors from agent output (indicates drift hurting production). | ~1-2h | All 14 reviewer/validator `agents/*.md` files; verify `templates/agent-output-formats.md` is the canonical reference. |

**Total effort: ~5-6 days. Bundle as a v2.1 code-polish PR before v2.3 kicks off.**

### Validation-driven v2.1 backlog (real-task findings)

These are bugs surfaced by **actual** real-project use of v2, not by code review or smoke tests. Source-of-truth: `validation-log.md` at repo root. Each Q-item below references the validation-log entry it came from.

| # | Severity | Issue | Effort | Where | First seen |
|---|----------|-------|--------|-------|------------|
| Q7 | 🔴 HIGH | **`pipeline_init` slug sanitizer broken.** Generated `task_id` like `t-2026-05-13-gateway-ui-gateway-orval-tanstaack-query` — hyphens in slug violate `^t-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,}$` schema pattern. Also preserves typos from user input. Blocks `pipeline_finish` (INV_SCHEMA_STATE). Fix: slugifier must lowercase + strip all non-alphanumeric + truncate to reasonable length. **Fixed: v2.1-hotfix Q7** — slugifier lives in `mcp/src/lib/ids.ts` (`sanitizeTaskIdSlug`, `makeTaskId`, `TASK_ID_PATTERN`). The real call site was `mcp/src/driver/tools/run-task.ts:deriveTaskId` (not `tools/init.ts` as the v2.1 prompt guessed); it now delegates to `makeTaskId`. 18 unit tests in `test/lib/ids.test.ts` cover the hyphen/typo regression, cyrillic, empty, single-char, all-punctuation, and explicit-task_id paths. | ~30min | `mcp/src/tools/init.ts` — slug generation. Add unit test for malformed task descriptions (hyphens, typos, unicode, long strings, empty). | t-2026-05-13-gateway... |
| Q8 | 🟡 MEDIUM | **Gate decisions stored in driver scratch but not mirrored to `pipeline_set_gate`.** `driver-state.scratch` has `gate-0_decision` and `gate-1_decision` after user answers, but `pipeline-state.gates` stays `"pending"`. Metrics row computed by `pipeline_finish` loses `gate1_revisions` count; INV_005/INV_006 can't fire. Fix: gate steps in `builtin/steps/index.ts` must call `pipelineSetGate({gate, decision, feedback})` immediately after capturing user-answer. | ~1h | `mcp/src/driver/builtin/steps/index.ts` — gate step impl + add audit-log entries proving the mirror happens. | t-2026-05-13-gateway... |
| Q9 | 🟡 MEDIUM | **Code review under-spawned.** MEDIUM flow per spec spawns 5 parallel reviewers (logic + challenger + style + security + performance) at `review` step. Real run produced only logic-reviewer in implementation phase (1/5). Root cause unclear — three hypotheses: (a) `applies_to` predicates too aggressive (`security_needed` returned false for non-auth diff — plausible), (b) review step calls `spawnOne` instead of `spawnAgentsParallel`, (c) Gate 1 plan revision reset `decisions` causing `applies_to` re-evaluation on stale state. Audit: inspect `review` step + dump `applies_to` decisions to audit log so it's visible. | ~2-3h | `mcp/src/driver/builtin/steps/index.ts` `review` step + add per-spawn rationale log line `{agent, applies_to_result, reason}`. | t-2026-05-13-gateway... |
| Q10 | 🟢 LOW | **`pipeline-state.current_step` stays stale.** Shows `"STEP 1"` while phases progress to `completed`/`in_progress`. v1 field that v2 driver doesn't update. Either: (a) v2 driver mirrors `driver-state.step_index` + flow_name into a derived `current_step` string, or (b) remove field from `pipeline-state.schema.json` as obsolete. Recommend (b) for clean break — `driver-state.json` is the live source of truth. | ~30min | `templates/schemas/pipeline-state.schema.json` + `templates/pipeline-state.json` + any tool that reads `current_step`. | t-2026-05-13-gateway... |
| Q11 | 🟢 LOW | **High `pipeline_continue_task` error rate (10/21 = 48% in first run).** Mix of expected swallowed retries (`closePriorPhases` swallowing INV_002/010/011, JSON parser repairs) and possibly real signal. Need categorization: each `verdict: "error"` audit entry should carry an `error_class` field (e.g., `"swallowed-inv"`, `"retry-recovered"`, `"genuine-failure"`) so post-hoc analysis can distinguish noise from problems. Currently every error looks the same in audit. | ~1h | `mcp/src/lib/audit.ts` add `error_class` field + emit from call sites; classify the ~5 known patterns. | t-2026-05-13-gateway... |
| Q12 | 🟡 MEDIUM | **`/done` cleanup blocked by guard hook (chicken-and-egg).** `commands/done.md` skill runs `rm -f .claude/pipeline-state.json ...` — guard correctly denies. Recovery requires `pipeline_unlock_writes` → `rm` → `pipeline_relock_writes` manual dance. Either: (a) update skill markdown to call unlock_writes before rm, or (b) **preferred:** add `pipeline_done_cleanup({project_dir})` MCP tool that does deletion server-side without guard interaction. **Fixed: v2.1-hotfix Q12** — plan A. `commands/done.md` step 5 now opens a 300s window via `pipeline_unlock_writes({reason:"/done cleanup"})` before the `rm` block and closes with `pipeline_relock_writes` (which also unlinks `.mcp-bypass-allowed`, removing the Q13 orphan path). Regression test: `mcp/test/tools/done-cleanup-sequence.test.ts`. **Plan A retired by Q23 (v2.1-polish-bundle) — current implementation is Plan B (dedicated `pipeline_done_cleanup` MCP tool, no guard dance).** | ~1h | `commands/done.md` markdown + optionally new `mcp/src/tools/done-cleanup.ts`. | t-2026-05-13-gwarchspec |
| Q13 | 🟢 LOW | **`.mcp-bypass-allowed` orphan after `/done`.** Cleanup list in `commands/done.md` doesn't include this filename. Required separate `rm`. Fix: add to cleanup list OR ensure `pipeline_relock_writes` auto-deletes the marker. Likely subsumed by Q12 implementation. **Subsumed by Q12** — `pipeline_relock_writes` already `unlink`s the marker (verified in `mcp/src/tools/unlock-writes.ts:pipelineRelockWrites`); the Q12 fix wires `/done` step 5 to call it on the way out, so the orphan can't happen anymore. The cleanup file list still names `.mcp-bypass-allowed` defensively in case relock is ever skipped. | ~10min | `commands/done.md` cleanup file list. | t-2026-05-13-gwarchspec |
| Q14 | 🟢 LOW | **`mcp-audit.jsonl` regenerates during `/done` cleanup (267-byte stub orphan).** Every MCP call during cleanup itself (unlock/relock/finish) re-appends to the project-local audit jsonl. Deleting it early in cleanup → subsequent MCP calls re-create the file. Fix: delete `mcp-audit.jsonl` LAST after all MCP calls done, OR have a `pipeline_done_cleanup` MCP tool (Q12) do file deletion atomically without re-emitting audit until after. | ~30min | Same as Q12 — bundled fix. | t-2026-05-13-gwarchspec |
| Q15 | 🟡 MEDIUM | **No clean recovery primitive for malformed `task_id`.** Q7 prevents the bug at init; this addresses the case where it slips through. Currently recovery requires: `pipeline_unlock_writes` → `python3` JSON-edit hack → `pipeline_relock_writes` → re-`pipeline_finish` (4 manual steps). Add `pipeline_fix_task_id({project_dir, new_task_id, reason})` MCP tool: validates new id against schema, mutates state under lock, audits the change. **Fixed: v2.1-hotfix Q15** — new `mcp/src/tools/fix-task-id.ts`, registered as the 20th MCP tool. Uses `withStateLock`, regenerates summary, rejects bad new_task_id / too-short reason. 5 unit tests in `test/tools/fix-task-id.test.ts`. `commands/done.md` Recovery section now points operators to it. | ~1h | New `mcp/src/tools/fix-task-id.ts` + register in `server.ts`. | t-2026-05-13-gwarchspec |
| Q43 | 🟢 LOW | **`impl_iters` derivation overcounts when same reviewer ran in earlier phases.** Real-task evidence (2026-05-14, `t-...-addauthtokendecodert`): metrics row shows `impl_iters: 2` for a task where implementation review loop was a single pass (logic-reviewer APPROVE first try in implementation). Root cause: iteration counter on `reviewer_verdicts[]` is **global per agent across phases**, not per-phase. logic-reviewer ran iter=1 in `planning` (REQUEST_CHANGES caught a real issue), then iter=2 in `implementation` (APPROVE) — iter=2 means "2nd time this agent ran on this task overall", not "2nd iteration of implementation review loop". Q22 derive (`max(iteration) WHERE phase=implementation`) reads 2, which is semantically wrong as "impl_iters". **Fix options:** (A) **cleaner** — reset iteration counter per-phase entry; logic-reviewer in implementation should be iter=1 not iter=2. (B) **simpler** — change Q22 derivation from `max(iteration)` to `count(verdicts WHERE phase=X)`. Same answer when single-phase but correct under cross-phase appearances. Recommend B (~30min in `tools/finish.ts`) since iteration field isn't read elsewhere meaningfully and changing record-time semantics is more invasive. Bundle into v2.2a alongside Q9 fix (review surface work). | ~30min | `mcp/src/tools/finish.ts` `extractMetricsRow` impl_iters/plan_iters derivation + extend test fixtures with cross-phase same-agent scenario. | t-2026-05-14-addauthtokendecodert |
| Q42 | 🟡 MEDIUM | **`task_id` slug collision between different tasks with same preamble.** Real-task evidence (2026-05-14): three consecutive `/task` runs on s3-panel produced two different tasks (Step 3 Identity contract, Step 4 _demo-contract) with **identical `task_id: t-2026-05-14-contextreadfirstinth`**. Root cause: slug derivation in `mcp/src/lib/ids.ts:makeTaskId` grabs leading alphanumeric chars; user's `/task` invocations consistently start with `## Context (read first, in this order)` preamble inserted by the Orchestrator skill → first slug-friendly token-run is always `contextreadfirstinth`. Q7 fixed slug FORMAT (schema-valid); Q42 fixes slug SEMANTICS (uniqueness). **Effect:** `~/.claude/metrics/pipeline.jsonl` has two rows with same `task_id` but different `task_short` — cross-task aggregation by `task_id` (via `/learn`) silently joins unrelated tasks; per-task grep impossible. **Fix options:** (a) strip known preamble patterns (`## Context...`, `Working directory:...`, `Read first...`) before slugification, then re-check collision against recent `~/.claude/metrics/pipeline.jsonl` task_ids; (b) **preferred** — append short-hash suffix when collision detected against existing tasks: `t-2026-05-14-contextreadfirstinth-a3f9`. Preserves readability when slug is unique; guarantees uniqueness otherwise. ~1h fix in `mcp/src/lib/ids.ts:makeTaskId` + collision-check helper + extend `test/lib/ids.test.ts` with collision scenarios. **Promoted from cross-cutting observation** (had 3 supporting data points; deferred decision now triggered by concrete metric collision). | ~1h | `mcp/src/lib/ids.ts` + `mcp/src/tools/init.ts` (call collision-check) + test. | t-2026-05-14 three consecutive s3-panel runs |
| Q41 | 🟡 MEDIUM | **`refs-to-load` decision is stack-blind — picks backend refs for frontend tasks.** Real-task evidence (2026-05-14, s3-panel Phase 0.5 Step 4): TypeScript monorepo frontend task produced `decisions.refs_to_load: [arch-patterns.md, db-postgres.md, redis.md, api-design.md, concurrency.md]` — all backend-only refs. Root cause: `mcp/src/driver/builtin/decisions/refs-to-load.ts` uses **only task-text regex matching**, ignores `state.stack` entirely. Task text matched `service` (11×, "ServiceFactory/ServiceDeps") + `contract` (28×, "domain-contract") + `concurrent` (1×) → triggered backend-only regex branches. **Effect:** agents spawned with wrong reference material — review quality degraded silently even though refs-to-load technically fires. Combined with Q30 (result not persisted to pipeline-state.refs_loaded) means review surface lacks BOTH (a) any refs in pipeline-state AND (b) the right refs in driver-state. **Architectural fix (chosen over hardcoded stack-conditional matrix):** refs become self-describing via YAML frontmatter (`tags`, `stack_signals`, `summary`, `when_to_load`, `agent_hints`); `refs-to-load` decision becomes async + LLM-driven — small classification call (haiku in v2.5 routing, opus default for now) over candidate refs' metadata + task context + active agents list, returns ranked top-N. Adding new refs = drop file with frontmatter, zero code changes. Scales naturally to Q40 bundle abstraction (refs from different domains coexist; LLM filters by context). Cost ≈ $0.001-0.05 per task. **Requires DecisionPlugin contract evolution to support async (`decide()` returns `T \| Promise<T>`)** — mechanical, existing decisions wrap in `Promise.resolve(...)`. **Optional companion:** `AgentPlugin.ref_categories?: string[]` field as soft hint LLM weighs ("logic-reviewer prefers arch/perf refs"). Bundles into v2.2a alongside Q9 + Q27 + Q30 — all about review surface inputs. | ~1d | (1) YAML frontmatter on all 20 `agents/references/*.md` (~3h one-time, contributors can extend); (2) `mcp/src/driver/types/plugin.ts` — DecisionPlugin contract evolution; (3) `mcp/src/driver/builtin/decisions/refs-to-load.ts` rewrite; (4) `SpawnProviderPlugin.query()` lightweight method or reuse `.spawn()` in classification mode; (5) tests with mock provider + frontmatter fixtures. | t-2026-05-14 s3-panel Step 4 mid-flight observation |
| Q40 | future-architecture | **Domain bundle abstraction** — current `loaders/builtins.ts` hardcodes the code-domain plugin set (20 agents, 6 decisions, 3 flows, 3 gates, 3 hooks, all code-specific). When a second domain becomes a concrete need (photo / video / research / VFX / etc.), refactor: (1) plugins declare `meta.domain: string` (field already added in profilactic commit — optional, defaults to "code"), (2) loader accepts `bundle: string` parameter and filters plugins by `plugin.meta.domain === bundle`, (3) project declares its bundle in `<project>/.claude/pipeline.config.json` (e.g. `{"bundle": "code"}`), (4) `builtin/` directory reorganized into `builtin/<domain>/` subdirs. **Stays out-of-scope until trigger:** proof-of-concept fork on a side project showing a non-code domain works value-wise. Pre-emptive abstraction without that signal is over-engineering — type system would complicate, code-domain DX would degrade, and we'd be designing for an imagined use case. **Effort when trigger arrives:** ~1-2 days for the loader change + directory reorg (NOT 2 weeks — state schema enums like `Phase` / `complexity` stay code-only initially; bundles are about plugin SET, not schema shape; cross-domain schema generalization is a separate later concern). See `specs/product-vision.md` "Domain Boundary" section. | ~1-2d (when triggered) | `mcp/src/driver/loaders/builtins.ts` + `mcp/src/driver/types/plugin.ts` (already prepped) + reorg `mcp/src/driver/builtin/` → `builtin/<domain>/`. | architectural discussion 2026-05-14 |
| Q38 | 🟢 LOW | **Terminal-tab auto-rename from pipeline — deferred to v2.3 Web UI.** Idea was to emit OSC-0 escape (`\033]0;<title>\007`) from a `scripts/set-tab-title.sh` invoked via Bash tool at task start / gate transitions, so the user's terminal tab reflects `<project> · <task_id>` automatically. **Smoke test on 2026-05-14 revealed Claude Code's Bash tool subprocess has no TTY** (`/dev/tty: Device not configured`) — child_process.spawn'd with pipes, no PTY allocation. Therefore: emitting OSC-0 from inside the Bash tool subprocess is a guaranteed no-op. The script was prototyped, smoke-tested, and removed before shipping. **Future home:** v2.3 Web UI solves the underlying user need (*"what's running where, on which task"*) more comprehensively — tabs in browser with project + status + progress. Native, no terminal-escape tricks needed. Alternative DIY for now: user can write a shell function in `.zshrc` that reads `.claude/pipeline-state.json` and emits OSC-0 from a real TTY context. **Lesson logged** (validation-log cross-cutting observation 2026-05-14): assumptions about Bash tool subprocess inheriting TTY are wrong; design implication: cannot use stdout/stderr/tty side-channels from skill-invoked scripts to reach the user's terminal. | n/a (deferred) | n/a | smoke test 2026-05-14 |
| Q37 | 🟡 MEDIUM | **`pipeline.jsonl` metrics row carries `stack: null` despite `pipeline-state.stack` being populated.** Real-task `t-2026-05-14-contextreadfirstinth` post-`/done` row: `stack: null` even though `pipeline-state.stack` had `{language:"typescript", package_manager:"pnpm", ...}` populated by Q17 fix. `pipeline_finish` extraction in `mcp/src/tools/finish.ts` doesn't copy `state.stack` to the metrics row. **Effect:** `/learn` cross-stack aggregation impossible — cannot answer *"reviewer-X miss-rate broken down by language"* or *"frontend tasks vs backend tasks: complexity distribution"*. v2.5 cost-aware routing needs historical stack data to learn routing decisions per language. Same shape as the Q22 family — Q22 fix the in-state→in-row threading for `tests_mode` / `impl_iters` / `acceptance_first_pass`, but missed `stack`. **Fix:** in `extractMetricsRow` (or equivalent), copy `state.stack` directly into the row's `stack` field. ~5 LOC + 1 unit test. | ~30min | `mcp/src/tools/finish.ts` + `mcp/test/tools/finish.test.ts`. | t-2026-05-14-contextreadfirstinth post-/done |
| Q36 | 🟢 LOW | **Stop hook scary message after Gate 2 acceptance** (now fixed in v2.1-polish-bundle). After user accepted Gate 2 but before `/done` ran, the Stop hook treated this state identically to "in flight no progress" and emitted *"Pipeline is in flight at step STEP 1 with verdict=null. Run /done..."* — alarming wording that suggested the user broke something. Reality: task is approved, only `/done` finalization pending. Q24 covered the silent-at-gate case; Q36 covers the positive-message-after-accept case. **Fixed: v2.1-polish-bundle Q36** — `hooks/pipeline-stop.sh` parses `gates.gate2`; when `verdict=null` + no `pending_user_answer` + `gate2 ∈ {"approved","accepted"}`, blocks with positive framing *"Task accepted at Gate 2 — one step left to finalize. Run /done..."* Data-loss prevention preserved; "you broke it" tone removed. 3 new vitest tests. | ~30min | `hooks/pipeline-stop.sh` + extend `mcp/test/hooks/pipeline-stop.test.ts`. | t-2026-05-14-contextreadfirstinth |
| Q34 | 🟢 LOW | **`phases.planning.grounding_check` field always `null` despite plan-grounding-check having run.** Real-task `t-2026-05-14-contextreadfirstinth` shows `phases.planning.grounding_check: null, grounding_mismatches: 0`, yet `reviewer_verdicts[]` contains plan-grounding-check with `verdict: "GROUNDED", phase: "planning"`. The verdict was correctly recorded in the verdicts array, but the legacy per-phase summary field wasn't synced. Same class as Q31/Q32 — v1-era state fields not maintained by v2 driver. **Fix:** either populate `phases.planning.grounding_check` from the most-recent grounding-check verdict (1-line in `pipeline_record_agent_run`), or deprecate from schema (cleaner — `reviewer_verdicts[]` is the source of truth). Recommend deprecation as part of Q35 schema hygiene. | ~15min | `templates/schemas/pipeline-state.schema.json` — remove field OR `mcp/src/tools/record-agent-run.ts` — populate. | t-2026-05-14-contextreadfirstinth |
| Q33 | 🟡 MEDIUM | **`state.files.created` and `state.files.modified` arrays always empty.** Real-task run had real git diff (2 files modified: `docs/ROADMAP.md` + `packages/module-contract/src/index.ts`), but `state.files = {created: [], modified: []}` post-implementation. Fields defined in schema, populated by v1 markdown-orchestrator, **never written by v2 driver**. **Effect:** `/learn` cross-task aggregation loses file-level signal — cannot answer *"which modules are touched most often?"*, *"which files have highest blocker rate?"*, *"what's the correlation between files and category-of-issues?"*. Directly affects v2.5 cost-aware routing — without file-level history, can't make data-driven decisions about which files need which reviewer fan-out. **Fix:** in the implementation phase (or in `pipeline_set_phase_status` when closing implementation), parse `git diff --name-status` (which the orchestrator already runs for `.claude/diff.txt` per Global Rule #10 — Q27) and persist into `state.files.created` (A status) / `state.files.modified` (M status). Add unit test asserting `state.files.modified` is non-empty after a synthetic implementation step that produced a diff. | ~1h | `mcp/src/driver/builtin/steps/` (implementation step or close-phase hook) + `mcp/src/tools/set-phase-status.ts` (optional) + test. | t-2026-05-14-contextreadfirstinth |
| Q32 | 🟢 LOW | **`phases.validation.acceptance_first_pass: false` is a stale legacy field that Q22 bypassed.** Real-task run had acceptance iter1 with verdict PASS — derived `acceptance_first_pass` for metrics row correctly = `true` (Q22 fix), but the source field `phases.validation.acceptance_first_pass` remained `false` (initial template default). Q22 fix derives the value at extract time from `reviewer_verdicts[]` filter, bypassing the source field entirely. **Effect:** misleading when reading state directly (e.g. validate-pipeline skill, post-mortem inspection). **Fix:** either (a) keep field but populate it correctly when acceptance verdict lands (1-line addition in `pipeline_record_agent_run`); or (b) **preferred** — deprecate field, remove from schema, since Q22 derive-from-verdicts is the canonical path. Recommend (b) as part of Q35 schema hygiene. | ~15min | `templates/schemas/pipeline-state.schema.json` (remove field) OR `mcp/src/tools/record-agent-run.ts` (populate). | t-2026-05-14-contextreadfirstinth |
| Q31 | 🟡 MEDIUM | **`phases.X.iterations` never increments — always 0 despite reviewer iterations happening.** Real-task run: `phases.planning.iterations = 0` and `phases.implementation.iterations = 0`, yet `reviewer_verdicts[]` clearly shows `logic-reviewer iteration: 1` in both phases. Same v1-legacy field that Q22 (metrics row `impl_iters`) sidestepped by deriving from `reviewer_verdicts[]` directly. **Effect:** post-mortem state inspection misleading (validate-pipeline, debugging); any external consumer reading the legacy field gets `0` instead of real iteration count. **Fix:** sync `phases.X.iterations` with `max(reviewer_verdicts[].iteration)` filtered by phase whenever `pipeline_record_agent_run` writes a verdict. Alternative: deprecate the field (same as Q32/Q34). Recommend population for now (cheap, observable) + deprecate as part of Q35 schema hygiene later. | ~30min | `mcp/src/tools/record-agent-run.ts` — recompute and write `phases.<phase>.iterations` on each verdict. | t-2026-05-14-contextreadfirstinth |
| Q30 | 🟡 MEDIUM | **`refs_loaded` and `refs_dropped_due_to_cap` always empty across runs.** Real-task `t-2026-05-14-contextreadfirstinth` (TypeScript frontend project — s3-panel) produced `state.refs_loaded: []` and `state.refs_dropped_due_to_cap: []`. Per Global Rule #13 + `DecisionPlugin` `refs-to-load`, the driver is supposed to inject relevant reference files (`agents/references/*.md` — `perf-react.md`, `security-frontend.md`, etc.) into agent prompts based on detected stack + diff. **None did.** A frontend TS project should have at minimum injected `perf-react.md` + `security-frontend.md`. **Effect:** agents lack domain-specific knowledge baseline — reviewers don't know React-perf patterns, frontend-security gotchas, accessibility checklists. Same architectural class as Q27 (pre-review infrastructure missing). Likely root cause: `DecisionPlugin` `refs-to-load` exists in `mcp/src/driver/builtin/decisions/` but: (a) not registered in `loaders/builtins.ts`, OR (b) not invoked by any step in `builtin/flows/medium.ts`, OR (c) registered but its output isn't persisted to `state.refs_loaded`. **Bundles naturally with Q9 + Q27 into "v2.2-review-completeness"** — review surface needs fan-out (Q9) + supporting input files (Q27) + injected domain knowledge (Q30). | ~2-3h | `mcp/src/driver/builtin/decisions/refs-to-load.ts` + `loaders/builtins.ts` + `builtin/flows/{medium,complex}.ts` step wiring + persistence into `state.refs_loaded`. | t-2026-05-14-contextreadfirstinth |
| Q29 | 🟢 LOW | **Logic-reviewer overuses `category: "other"` — vocab gap.** Real-task `t-2026-05-14-contextreadfirstinth` produced 5 findings, **4 of which were `category: "other"`**. Inspecting the summaries, the natural categories that the agent wanted are not in `templates/schemas/category-vocab.json` `logic-reviewer` vocab: `spec-deviation` / `inconsistent-spec` (e.g., "SPEC.md §3.2 declares Identity at src/identity.ts but colocated in src/index.ts"), `scope-creep` (e.g., "lint/format added beyond DoD"), `coverage-gap` / `missing-test-case` (e.g., "Tests cover createModuleWrapper spread path but not createModule MF bridge path"). Q18 fixed inline-resolution of the vocab path; the vocab itself needs expansion. Pattern likely affects other reviewer agents too. **Fix:** add 3-5 new categories to `logic-reviewer` vocab (start with `spec-deviation`, `scope-creep`, `coverage-gap`); audit other reviewer vocabs against real-task findings; document the vocab-evolution loop (real-run → log → expand vocab → commit). | ~30min | `templates/schemas/category-vocab.json` — extend reviewer vocabs. | t-2026-05-14-contextreadfirstinth |
| Q28 | 🟢 LOW | **`schema_version` missing in per-finding entries (Q21 extension).** Real-task run produced one `verdict:error` audit entry: `Agent header failed reviewer-output.schema.json validation: /findings/0: must have required property 'schema_version'`. Q21 added a "## Output constraints (hard validation)" bullet list to all reviewer/validator templates covering `summary_line` ≤100, `findings[].id` regex, `summary` ≤200 — but did not enforce the per-finding `schema_version` requirement. Agent forgot to set it, retry-recovered. **Fix:** extend the Q21 bullet list in all 13 reviewer/validator `agents/*.md` templates with a fourth rule: *"`findings[].schema_version`: required, value `'1.0'`"*. Also extend the inline JSON example to show `"schema_version": "1.0"` on a finding. Connects to Q21 (same prompt-engineering channel) and Q11 (this was the one `schema-validation` error_class entry in the run). | ~30min | All 13 `agents/*.md` reviewer/validator templates. | t-2026-05-14-contextreadfirstinth |
| Q27 | 🟡 MEDIUM | **Pre-review infrastructure files missing — `diff.txt` / `caller-context.md` / `antipattern-candidates.md` / `past-misses-*.md` not generated.** Real-task `t-2026-05-14-contextreadfirstinth` (MEDIUM) had `.claude/` with NONE of the four documented pre-review artifacts present: (a) `.claude/diff.txt` per Global Rule #10 (file-pointer mode for diff-scoped review), (b) `.claude/caller-context.md` per Global Rule #19 (MEDIUM/COMPLEX caller-context expansion), (c) `.claude/antipattern-candidates.md` per Global Rule #16 (all complexities, grep CLAUDE.md "What NOT to Do" against diff), (d) `.claude/past-misses-*.md` per Global Rule #15 (cached at pipeline start, per reviewer agent). Confirmed via state: **`past_misses_applied: 0` for ALL 5 reviewer_verdicts** — past-misses injection isn't running at all. **Combined with Q9 (under-spawning):** the 1/5 reviewer that actually fires reviews **blind to 4 expected input files** — no diff scoping, no caller usage context, no anti-pattern signals, no historical-miss data. Reviewer is essentially context-free. **Real value of current review is well below the already-low Q9 baseline.** Probable root cause: HookPlugins for these artifacts not registered in `loaders/builtins.ts`, OR steps in `builtin/flows/medium.ts` don't include their emission, OR `applies_to` predicates skip them. Same class of bug as Q9 — review surface infrastructure not wired. **Top priority for v2.2 polish bundle alongside Q9** — fixing review-surface without fixing inputs is incomplete. | ~3-4h | `mcp/src/driver/builtin/hooks/` (verify load-past-misses, anti-pattern-grep, caller-context-expand exist + registered) + `mcp/src/driver/builtin/flows/medium.ts` (verify hook events are wired) + integration test that asserts the 4 files exist after implementation phase. | t-2026-05-14-contextreadfirstinth |
| Q26 | 🟡 MEDIUM | **Q17 stack-detector ignores CLAUDE.md "Validation Commands" priority — returns wrong commands and wrong project_type.** Real-task run on s3-panel (which has explicit `Lint: pnpm -r lint`, `Test: pnpm -r test`, `Build: pnpm -r build` in CLAUDE.md) produced `state.stack = { language:"typescript", package_manager:"pnpm", test_command:"npm run test", lint_command:"npm run lint", build_command:"npm run build", project_type:"library" }`. Two distinct problems: **(a) priority chain violated** — Q17 spec said *"CLAUDE.md 'Validation Commands' wins over package.json scripts"*, but the detector skipped CLAUDE.md parsing and fell straight to package.json scripts (where it derived `npm run X` defaults instead of the actual `pnpm -r X` commands documented in CLAUDE.md). **(b) Monorepo classification wrong** — s3-panel root is a `pnpm-workspace.yaml` monorepo with `apps/`, `gateways/`, `modules/`, `packages/`. The detector at root saw no `next.config.*` / `vite.config.*` / `rsbuild.config.*` (those live in `apps/core/`) → fell back to `project_type:"library"`. Real classification: workspace root is **neither** `frontend-app` nor `library` — it's a monorepo with frontend-app inside. **Fix:** (a) restore CLAUDE.md parsing in `stack-detect.ts` — read `## Validation Commands` block, extract Lint/Test/Build lines, override package.json scripts; (b) for monorepo detection (presence of `pnpm-workspace.yaml` / `lerna.json` / `nx.json` / `turbo.json`), add a 4th `project_type` value (`"monorepo"`) OR walk one level deeper into `apps/*` and aggregate. Recommend (a) immediate; (b) defer until monorepo gains a real consumer signal. | ~1-2h | `mcp/src/driver/builtin/decisions/stack-detect.ts` — add CLAUDE.md parsing branch with priority over package.json; add unit test fixture mimicking s3-panel layout. | t-2026-05-14-contextreadfirstinth |
| Q25 | 🟢 LOW | **Onboarding friction: Claude Code asks user to approve every Write to `<project>/.claude/*`.** Each `/task` run spawns agents that write 8-12 working artifacts under `<project>/.claude/` (`context-doc.md`, `plan.md`, `analyzer-claims.json`, `diff.txt`, `caller-context.md`, `antipattern-candidates.md`, `past-misses-*.md`, `reviews/<agent>-<iter>.md`, etc.). These are NOT in the guard hook's protected basename list (`hooks/pipeline-guard.sh:33`) — by design they are working artifacts, not state. **But** Claude Code's per-session permission system still asks the user to confirm each Write that hasn't been pre-approved in `<project>/.claude/settings.local.json`. Result: first-time pipeline users on a new project click "Yes" ~10 times per `/task`. **Fix options** (pick one or stack): (a) docs-only — add a section to `README.md` and `commands/task.md` recommending users add `{"permissions": {"allow": ["Write(.claude/**)"]}}` to `settings.local.json` before first run; (b) automation — `pipeline_init` MCP tool merges the rule into `settings.local.json` (carefully — don't clobber existing user rules); (c) bootstrap — `pipeline_install` setup-time tool (if such a thing lands in v2.3 daemon). **Recommendation:** ship (a) immediately (~30min), defer (b)/(c) until v2.3 when there's a coherent onboarding story. Connects to Q23 (server-side cleanup already side-steps this problem for `/done` — but spawn-phase Writes still hit it). Connects to Q24 (similar class: friction from CC ↔ pipeline integration that isn't a bug per se). **Defer for now** — file only, don't fix in v2.1-polish-bundle. | ~30min (option a) / ~2h (option b) | `README.md` + `commands/task.md` + optionally `mcp/src/tools/init.ts`. | v2.1-polish-bundle real-run (s3-panel, 2026-05-15) |
| Q24 | 🟡 MEDIUM | **Stop hook falsely warns "Pipeline is in flight" at every gate pause.** `hooks/pipeline-stop.sh:42-52` blocks Stop whenever `pipeline-state.verdict=null`, without checking `driver-state.pending_user_answer` — which marks legitimate gate-pauses awaiting user input (Gate 0/1/2). User sees scary `decision: "block"` payload text *"Pipeline is in flight at step \"STEP 1\" with verdict=null. Run /done to finalize..."* on every gate question. Made worse by **Q10 recurrence** (`current_step` stale → message reads "STEP 1" even when `step_index=3`). Surfaced during `v2.1-polish-bundle` real-run validation on s3-panel. **Fixed: v2.1-polish-bundle Q24** — `hooks/pipeline-stop.sh` reads `driver-state.json:pending_user_answer`; Case 2 block guard becomes `if [ -z "$verdict" ] && [ -z "$pending_user_answer" ]`. 6 vitest tests in `mcp/test/hooks/pipeline-stop.test.ts` cover: in-flight no-pause → blocks, paused-at-gate → silent (Q24 happy path), missing driver-state → blocks (degraded-safe), completed task → silent, stop_hook_active → stderr fallback, agents_count=0 violation → stderr. | ~30min | `hooks/pipeline-stop.sh` — add driver-state.pending_user_answer check before the block decision. | v2.1-polish-bundle real-run |
| Q23 | 🟡 MEDIUM | **`/done` cleanup should go through a dedicated MCP tool, not Bash `rm` via guard-unlock window (supersedes Q12 Plan A; closes Q14).** Current Q12 fix kept cleanup in `commands/done.md` markdown: `pipeline_unlock_writes` (300s bypass window) → `Bash rm -f .claude/...` → `pipeline_relock_writes`. Real `/done` run on `t-2026-05-14-workingdirectoryuser` confirmed three correlated issues: (a) user-visible `Bash(rm -f ...)` invocation contradicts guard-hook design (we exist to *prevent* raw writes, then open a window to do raw writes anyway); (b) **Q14 recurrence verified** — 267-byte `mcp-audit.jsonl` stub left after cleanup because `pipeline_relock_writes` audits itself AFTER `rm` deleted the file; (c) cleanup file-list lives in markdown and will drift from server-side reality as new state files are added. **Original Q12 spec acknowledged Plan B (`pipeline_done_cleanup({project_dir})`) as "preferred" but deferred for ship velocity.** Plan B implementation: server-side atomic delete of all known state files; `mcp-audit.jsonl` deleted LAST after all internal logging; no guard bypass needed (MCP-internal op). Shrinks `commands/done.md` cleanup block to ~5 lines (single MCP call). Closes Q14 automatically. | ~2-3h | New `mcp/src/tools/done-cleanup.ts` + register in `server.ts` + revise `commands/done.md` to call it + remove the unlock/relock dance from cleanup step. Update `mcp/README.md` tool count (21st tool). | t-2026-05-14-workingdirectoryuser |
| Q22 | 🟡 MEDIUM | **`pipeline.jsonl` metrics row has null/wrong fields after `pipeline_finish`.** Post-`/done` inspection of the row written for `t-2026-05-14-workingdirectoryuser`: `tests_mode: null` (should be `"regression-only"` — auto-detected at `/task` time), `impl_iters: 0` (should be `≥1` — logic-reviewer ran iter1 REQUEST_CHANGES → iter2 APPROVE = 1 revision happened), `acceptance_first_pass: false` (semantically confusing — acceptance ran ONCE with PASS verdict; the `false` likely encodes "code review needed iteration" but the field name implies acceptance itself failed). `gate1_revisions: 0` is a known Q8 recurrence (gate state never mirrored). **Effect:** any cross-run aggregation by `tests_mode` distribution, average `impl_iters` per complexity, or `acceptance_first_pass` rate produces wrong numbers. Likely root cause: `pipeline_finish` mechanical extraction in `mcp/src/tools/finish.ts` either reads from un-maintained pipeline-state fields, OR the extraction logic is bugged (e.g., `impl_iters` derivation doesn't count `reviewer_verdicts` iterations correctly). Need audit of `extractMetricsRow` (or equivalent) against the schema definitions in `templates/schemas/`. Possibly rename/clarify `acceptance_first_pass` semantics in the schema. | ~1-2h | `mcp/src/tools/finish.ts` extraction logic + `templates/schemas/pipeline.jsonl-row.schema.json` (if exists, else the inline schema in finish.ts) + unit test asserting row matches real run state. | t-2026-05-14-workingdirectoryuser |
| Q21 | 🟡 MEDIUM | **Agents systematically violate output-header schema.** Real-task runs show recurring `Agent header failed validator/reviewer-output.schema.json validation` errors in `mcp-audit.jsonl`. Two concrete patterns seen across runs: (a) `summary_line` exceeds 100 char limit; (b) `findings[].id` does not match `^f-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$`; (c) `findings[].summary` exceeds 200 chars. Pipeline retry-recovers, but each retry wastes a Task-tool invocation and pollutes audit. Root cause: canonical output examples in `agents/*.md` either omit explicit constraint text, or the examples themselves don't visibly violate the constraint, so the LLM has no signal that 100 chars is a hard limit. **Two-prong fix:** (a) revise agent prompt templates so the inline example shows a deliberately-truncated `summary_line` and a regex-valid `findings.id`; (b) consider relaxing the schema if 100 chars proves too tight in practice (the constraint was set without empirical data). Connects to **Q6** (consolidate output examples to a single reference file) and **Q11** (error_class would mark these as `"agent-retry-recovered"` distinct from genuine failures). | ~1-2h | `agents/*.md` (14 reviewer/validator templates) + optionally `templates/schemas/{reviewer,validator}-output.schema.json`. | t-2026-05-14-workingdirectoryuser |
| Q20 | 🟢 LOW | **`reviewer_verdicts[].phase` field missing from pipeline-state.** Real-task `pipeline-state.json.reviewer_verdicts[]` entries carry `{agent, iteration, verdict, blocking_issues, non_blocking, past_misses_applied, past_miss_matches, categories_seen}` — **no `phase` field**. Same agent can run in multiple phases (e.g. logic-reviewer runs in `planning` for plan review and again in `implementation` for code review); the two verdicts become indistinguishable without external timestamp correlation. Affects observability and post-hoc analysis (e.g. "which phase caused the longest review loop?"). **Fix:** add `phase: Phase` to `templates/schemas/pipeline-state.schema.json` `reviewer_verdicts` item shape; populate from `pipeline_record_agent_run` (the call site already knows the phase). 1-line schema change + 1-line tool change + regression test. | ~30min | `templates/schemas/pipeline-state.schema.json` + `mcp/src/tools/record-agent-run.ts` + test. | t-2026-05-14-workingdirectoryuser |
| Q19 | 🟡 MEDIUM | **`open_spawns[].model` always `null`.** Real-task `pipeline-state.json` shows every entry in `phases.<phase>.open_spawns[]` with `"model": null` (e.g. `{id: "ar-...", agent: "implementer", model: null, started_at: "..."}`). Root cause traced: `SpawnRecorder` type signature in `mcp/src/driver/core/fsm.ts:28-32` only accepts `{project_dir, phase, agent}` — no `model` field. `mcpSpawnRecorder` in `mcp/src/driver/tools/run-task.ts:33-40` calls `pipelineBeginAgent` without a `model` argument, and `pipelineBeginAgent` (`mcp/src/tools/begin-agent.ts:54`) defaults `model: input.model ?? null`. The model resolved by `resolveAgentModel(plugin, phase, config)` somewhere upstream is dropped on the floor before reaching the open_spawn record. **Effect:** post-hoc cost analysis impossible (which model ran which spawn); audit trail loses model info; v2.5 cost-aware routing has no historical data to learn from; `pipeline.jsonl` metrics row carries useless per-spawn model data. **Fix scope ~1h:** (a) extend `SpawnRecorder` signature with `model?: "haiku" \| "sonnet" \| "opus" \| null`; (b) thread `resolveAgentModel(...)` result through the spawn step call site (likely `mcp/src/driver/builtin/steps/index.ts` `spawn`/`review` steps); (c) `mcpSpawnRecorder` forwards model to `pipelineBeginAgent`. Add unit test asserting `open_spawn.model` equals resolved value (not null) for each complexity level. | ~1h | `mcp/src/driver/core/fsm.ts` + `mcp/src/driver/tools/run-task.ts` + `mcp/src/driver/builtin/steps/index.ts` + test. | t-2026-05-14 real-task run |
| Q16 | 🔴 **CRITICAL** | **`subagent_type` mismatch breaks spawning for non-builtin agent names.** Driver returns `claude_code_task.subagent_type: "<agent name>"` (e.g. `"code-analyzer"`), but Claude Code's `Task` tool only accepts its own internal subagent_types: `general-purpose`, `Explore`, `Plan`, `runtime-debug-agent`, `test-all-agent`, `fe-test-all-agent`, `statusline-setup`, `claude-code-guide`. Error: `Agent type 'code-analyzer' not found`. **Per v2 design intent**, `subagent_type` should always be `"general-purpose"` (or detected from Claude Code's catalog), and the actual AgentPlugin role/template should be embedded in the `prompt` text. Currently this mapping is wrong somewhere — most likely `ShuttleSpawnProvider` or a step using `agent.name` as `subagent_type`. Blocks spawn for any agent whose name isn't accidentally a Claude Code subagent_type (= most of them). **HIGHEST PRIORITY v2.1 fix — without it, ~90% of pipeline tasks will fail at context-enrichment phase.** **Fixed: v2.1-hotfix Q16** — `shuttle-provider.ts` now pins `subagent_type="general-purpose"`, reads the AgentPlugin's `template_path` and embeds it (plus a self-id header + spawn context) into the Task tool prompt. `AgentSpawnRequest.template_path` added so non-shuttle providers can do the same. 5 unit tests in `test/driver/builtin/spawn/shuttle-provider.test.ts`. | ~1-2h | `mcp/src/driver/builtin/spawn/shuttle-provider.ts` — force `subagent_type: "general-purpose"` always; ensure prompt contains the agent template content + role context. Add unit test asserting subagent_type is one of CC's accepted values. | t-2026-05-14-...-blocked |

### Validation-driven backlog status (post v2.1-hotfix)

**Shipped — v2.1-hotfix bundle (4 commits, 2026-05-14):**

| Q | Commit | Status |
|---|--------|--------|
| Q7 | `4ea0c9f` | ✓ Fixed — slug sanitizer in `mcp/src/lib/ids.ts`; 18 tests |
| Q12 | `4e2527b` | ✓ Fixed — `/done` cleanup wraps with `pipeline_unlock_writes` / `pipeline_relock_writes`; 1 test |
| Q13 | — | ✓ Subsumed by Q12 (`pipeline_relock_writes` unlinks `.mcp-bypass-allowed`) |
| Q15 | `baa253e` | ✓ Fixed — new `pipeline_fix_task_id` tool (MCP tool #20); 5 tests |
| Q16 | `98b9f45` | ✓ Fixed — `ShuttleSpawnProvider` pins `subagent_type="general-purpose"`; 5 tests |

5 of 10 validation-driven items closed. Pipeline can now run real tasks end-to-end.

**Remaining for v2.1 polish bundle (Q1-Q6 code quality + 6 leftover validation-driven):**

| Q | Severity | Status | Notes |
|---|----------|--------|-------|
| Q8 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | Gate decisions not mirrored to `pipeline_set_gate`. Observability loss. Done in v2.1-polish-bundle: `pipelineContinueTask` now resolves the gate via `gate.validate_response` on every `user-answer` event and calls `pipelineSetGate` to mirror the decision (approved/rejected; changes_requested → rejected). Idempotent flag `${gate}_mirrored` in scratch; gate1 rejections also bump `scratch.gate1_revision_count` for Q22. Emits `pipeline_gate_mirror` audit entries (per-mirror, captures `error_class`-style verdict). 4 tests in `test/driver/builtin/steps/gate-mirror.test.ts`. |
| Q9 | 🟡 MEDIUM | ✓ fixed (v2.2a-review-completeness) | **Code review under-spawning — WIRING BUG.** Investigation on `t-...-addauthtokendecodert` (5th recurrence) revealed `driver-state.decisions` lacked `security_needed`/`ui_touched`/`api_touched` because no flow step invoked them. **Fixed: v2.2a-review-completeness Q9** — extended `PRE_REVIEW` step to invoke all three decisions (runs in implementation phase, after git-diff, so diff-aware predicates can see scratch.diff_text when populated). Extended `REVIEW` step to fan out to all eligible reviewer agents (logic + challenger + style + security + performance) via `spawnAgentsParallel` for non-simple flows, respecting each AgentPlugin's `applies_to` predicate. SIMPLE flow keeps single logic-reviewer (no behavior change). 8 new tests covering decision wiring + fan-out branches (security on / off / advance-after-results). |
| Q10 | 🟢 LOW | ✓ fixed (v2.2-clear-bundle) | `current_step` field stale. Either update v2 driver or remove from schema. |
| Q11 | 🟢 LOW | ✓ fixed (v2.1-polish-bundle) | Audit `error_class` field for verdict=error categorization. Done in v2.1-polish-bundle: `AuditEntry` carries optional `error_class: "swallowed-inv" \| "retry-recovered" \| "schema-validation" \| "vocab-rejected" \| "genuine-failure"`. `withAudit` auto-classifies thrown errors by message regex; `record-agent-run` explicitly emits `retry-recovered` when the lenient JSON parser repairs the header. 7 new tests covering the classifier + round-trip + auto-classification. |
| Q14 | 🟢 LOW | ✓ subsumed by Q23 (v2.1-polish-bundle) | `mcp-audit.jsonl` regenerates during `/done` cleanup. May be subsumed by Q12 — verify on next real-task run. **Closed by Q23 in v2.1-polish-bundle:** `pipeline_done_cleanup` deletes `mcp-audit.jsonl` LAST, and is registered without `withAudit` so no post-impl audit entry can re-create the file. |
| Q17 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | **`pipeline-state.json:stack` never populated.** After every `/task` run, `state.stack` shows all `null`/`"unknown"` for `language`/`package_manager`/`test_command`/`lint_command`/`build_command`/`project_type`. `pipeline_init` accepts a `stack` param (verified in `smoke.ts` fixture) but the driver entry (`mcp/src/driver/tools/run-task.ts`) doesn't run stack-detection pre-flight and calls `pipeline_init` without it. The `classify` step / `decisions/tests-mode.ts` do partial detection (frontend vs backend) but don't write back to `state.stack`. **Effect:** agents receive `project_stack` as all-null context → reference files like `perf-react.md` rely on indirect indicators; `pipeline.jsonl` metrics row carries useless stack data for cross-stack `/learn` drift analysis. **Fix scope ~2-4h:** add stack-detection helper (`mcp/src/driver/builtin/decisions/stack-detect.ts` reading CLAUDE.md "Validation Commands" + `package.json`/`pyproject.toml`/`pubspec.yaml`/etc.); call it in driver run-task before `pipeline_init`; OR add `pipeline_set_stack` MCP tool + classify step. Done in v2.1-polish-bundle: `mcp/src/driver/builtin/decisions/stack-detect.ts` inspects CLAUDE.md "Validation Commands", `package.json` (Node/JS/TS), `pyproject.toml` (Python), `pubspec.yaml`, `Cargo.toml`, `go.mod`. Project type detected via `next.config.*`/`vite.config.*`/`angular.json` or `dependencies` (next/react-dom → frontend-app, @nestjs/core/fastify/express → backend). `pipelineRunTask` calls it before `pipeline_init` when no explicit `stack` was passed. `pipeline_set_stack` was intentionally skipped to keep Q23's 21-tool milestone clean — manual override stays through `pipeline_unlock_writes` + JSON edit. 8 unit tests covering Node, Python, Rust, Go, CLAUDE.md override, empty dir, nest backend, monorepo fixture. |
| Q19 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | **`open_spawns[].model` always `null`.** `SpawnRecorder` signature drops the resolved model before it reaches `pipeline_begin_agent`. Blocks cost analysis + v2.5 historical training data. Fix: extend `SpawnRecorder` type with `model?` field; thread `resolveAgentModel` result through. Done in v2.1-polish-bundle: `SpawnRecorder` + `StepContext.beginSpawn` + `state.pending_spawns` carry `model`; `mcpSpawnRecorder` forwards it to `pipeline_begin_agent`. 5 new tests in `begin-agent.test.ts` and `driver/core/spawn-recorder-model.test.ts`. |
| Q20 | 🟢 LOW | ✓ fixed (v2.1-polish-bundle) | **`reviewer_verdicts[].phase` field missing.** Same agent can run in multiple phases; verdicts indistinguishable without external timestamp correlation. Add `phase` field to schema + record-agent-run tool. Done in v2.1-polish-bundle: optional `phase` (enum of Phase) added to `templates/schemas/pipeline-state.schema.json:reviewer_verdicts.items.properties`; `pipelineRecordAgentRun` writes `input.phase` onto every appended verdict. Backward-compatible (legacy entries without `phase` still validate). |
| Q21 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | **Agents systematically violate output-header schema** (`summary_line` >100 chars, `findings.id` wrong pattern). Retry-recovered but wastes calls + pollutes audit. Fix: revise agent prompt examples to show constraint-respecting templates; optionally relax schema if 100 chars too tight. Done in v2.1-polish-bundle: all 13 reviewer/validator templates now end with a "## Output constraints (hard validation)" bullet list naming the three rules (`summary_line` ≤100, `findings[].id` regex with example, `summary` ≤200). 18 schema-validation tests in `mcp/test/agents/output-constraints.test.ts` cover boundary cases (100/101 chars) and bad id shape. **Prong B not exercised** — schemas left at 100/200 limits per risk register; only re-evaluate if next validation run still shows retries on natural prose. |
| Q22 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | **Metrics row in `pipeline.jsonl` has null/wrong fields** after `pipeline_finish`. `tests_mode=null`, `impl_iters=0` despite 1 revision happened, `acceptance_first_pass` semantics confusing. Cross-run aggregation broken. Fix: audit `extractMetricsRow` in `mcp/src/tools/finish.ts`. Done in v2.1-polish-bundle: row now carries `tests_mode` from `state.tests_mode`; `impl_iters` and `plan_iters` come from `max(iteration)` over `reviewer_verdicts` filtered by Q20 `phase` field (with `phases.<x>.iterations` as legacy fallback); `acceptance_first_pass` derives from iter-1 acceptance verdict (PASS/FAIL) instead of an unmaintained `phases.validation.acceptance_first_pass` flag. Reviewer-verdicts in the row also include `phase`. 4 new tests in `finish.test.ts`. |
| Q23 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | **`/done` cleanup should go through a dedicated MCP tool** (supersedes Q12 Plan A; closes Q14). Current `Bash rm` via guard-unlock window contradicts guard design + leaves Q14 audit-regen stub. Plan B: `pipeline_done_cleanup({project_dir})` — server-side atomic, no bypass, no audit regen. Shrinks `commands/done.md` to one MCP call. Done in v2.1-polish-bundle: `mcp/src/tools/done-cleanup.ts` registered as the 21st tool via a new `registerNoAudit` path in `server.ts`. Deletes 18 named static files + 4 glob patterns + `reviews/` directory + `mcp-audit.jsonl` last. `commands/done.md` step 5 is now a single MCP call. 5 unit tests. Q12 Plan A retired by Q23 — current implementation is Plan B. |
| Q25 | 🟢 LOW | ✓ fixed (v2.2-clear-bundle) | **Onboarding friction: CC permission prompt on every Write to `<project>/.claude/*`.** Working artifacts (context-doc, plan, analyzer-claims, ...) aren't in the guard's protected list — by design — but CC's per-session permission system still asks. ~10 clicks per first `/task`. Fix: docs recommendation to pre-approve `Write(.claude/**)` in `settings.local.json`, optionally automated by `pipeline_init`. Deferred for now. |
| Q26 | 🟡 MEDIUM | ✓ fixed (v2.2-clear-bundle) | **Q17 stack-detector returns wrong values** — CLAUDE.md "Validation Commands" priority not honored; falls to package.json scripts and emits `npm run X` defaults. Monorepo root mis-classified as `library`. Confirmed on real s3-panel run. Fix: parse CLAUDE.md first; consider `monorepo` project_type. |
| Q27 | 🟡 MEDIUM | open | **Pre-review infrastructure files missing** (`diff.txt`, `caller-context.md`, `antipattern-candidates.md`, `past-misses-*.md`). `past_misses_applied: 0` across all reviewers. The 1/5 reviewer that fires (Q9) is reviewing blind to 4 expected input files. **Top priority for v2.2 alongside Q9** — review surface needs both fan-out AND inputs. |
| Q28 | 🟢 LOW | ✓ fixed (v2.2-clear-bundle) | **`schema_version` missing in per-finding entries.** Q21 bullet list didn't cover it; agents emit findings without `schema_version` → reviewer-output schema validation fails (retry-recovered). Extend Q21 templates with the 4th rule + show `"schema_version":"1.0"` in inline example. |
| Q29 | 🟢 LOW | ✓ fixed (v2.2-clear-bundle) | **Logic-reviewer overuses `category: "other"`** — 4/5 findings on real-task run. Vocab gap: needs `spec-deviation`, `scope-creep`, `coverage-gap` (or similar). Q18 fixed path resolution; vocab itself needs expansion. Audit other reviewer vocabs too. |
| Q30 | 🟡 MEDIUM | open | **`refs_loaded` always empty.** `DecisionPlugin` refs-to-load not wired/persisting — agents missing domain-specific knowledge (perf-react.md, security-frontend.md). Bundle with Q9 + Q27 into "v2.2-review-completeness". |
| Q31 | 🟡 MEDIUM | ✓ fixed (v2.2-clear-bundle) | **`phases.X.iterations` never increments.** Legacy field unmaintained; reviewer_verdicts[].iteration is correct but phase-level summary stays at 0. Fix by sync OR deprecate (Q35). |
| Q32 | 🟢 LOW | ✓ fixed (v2.2-clear-bundle) | **`phases.validation.acceptance_first_pass` stale.** Q22 bypassed this field by deriving from reviewer_verdicts. Source field still `false` despite acceptance PASS. Either populate or deprecate (Q35). |
| Q33 | 🟡 MEDIUM | ✓ fixed (v2.2-clear-bundle) | **`state.files.created/modified` never populated.** Schema has fields, v1 wrote them, v2 driver doesn't. /learn loses file-level signal. Affects v2.5 cost-aware routing data. |
| Q34 | 🟢 LOW | ✓ fixed (v2.2-clear-bundle) | **`phases.planning.grounding_check: null`** despite plan-grounding-check having run with verdict GROUNDED. Legacy field not synced. Deprecate (Q35). |
| Q36 | 🟢 LOW | ✓ fixed (v2.1-polish-bundle) | **Stop hook scary message after Gate 2 accept** — treated post-accept state as "in flight". Now: positive framing *"Task accepted at Gate 2 — one step left to finalize"*. Data-loss prevention preserved. |
| Q37 | 🟡 MEDIUM | ✓ fixed (v2.2-clear-bundle) | **`pipeline.jsonl` metrics row has `stack: null`** despite Q17 populating `pipeline-state.stack`. `pipeline_finish` extraction doesn't copy state.stack into row. Same shape as Q22 family — Q22 fix missed this field. ~30min fix in `tools/finish.ts`. |
| Q24 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | **Stop hook falsely warns "Pipeline is in flight" at every gate pause.** Surfaced during real-run validation of the polish bundle itself. Done in v2.1-polish-bundle: `hooks/pipeline-stop.sh` now reads `driver-state.pending_user_answer`; Case 2 block guard requires both `verdict` empty AND no pending answer. 6 vitest tests in `mcp/test/hooks/pipeline-stop.test.ts`. Made Q10 (current_step stale) more visible — Q10 still open. |
| Q38 | 🟢 LOW | deferred (v2.3 Web UI) | **Terminal-tab auto-rename via OSC-0** — prototyped + smoke-tested 2026-05-14; doesn't work because Claude Code Bash tool subprocess has no TTY. Underlying need (*"what's running where"*) solved natively by v2.3 Web UI. Lesson logged in validation-log cross-cutting observations. |
| Q40 | future-arch | deferred (no trigger) | **Domain bundle abstraction** — when a second domain (photo/video/research/VFX) becomes concrete, refactor loaders to accept `bundle: string` and filter plugins by `meta.domain`. `PluginMeta.domain` field already added prophylactically (forward-compatible, default "code"). See product-vision.md "Domain Boundary" section. ~1-2d when triggered. |
| Q41 | 🟡 MEDIUM | ✓ fixed (v2.2a-review-completeness) | **`refs-to-load` decision is stack-blind** — uses task-text regex only, picks backend refs for frontend tasks. **Fixed: v2.2a-review-completeness Q41** — refs are now self-describing via YAML frontmatter on all 25 `agents/references/*.md` files (tags, stack_signals, summary, when_to_load, agent_hints). `DecisionPlugin.decide(state, ctx?)` contract evolved with optional `DecisionContext{active_agents, spawn_provider}` — existing decisions unchanged. `SpawnProviderPlugin.query?()` added as optional one-shot LLM classification method. `refs-to-load.ts` rewritten: LLM-driven when `ctx.spawn_provider.query` is present, regex fallback otherwise (≥ pre-Q41 quality always). Frontmatter parser in `mcp/src/lib/parse-frontmatter.ts` (hand-rolled, no dep). `classify` step passes `{active_agents: flow.steps, spawn_provider}` through. 19 new tests (parser, refs-metadata loader scanning all 25 real ref files, refs-to-load LLM path / fallback / cap / hallucination filter / cached / malformed-output, prompt builder, parsePickedRefs). |
| Q42 | 🟡 MEDIUM | ✓ fixed (v2.2a-review-completeness) | **`task_id` slug collision** — two different tasks (Step 3 Identity, Step 4 _demo-contract) on s3-panel produced same `task_id: t-2026-05-14-contextreadfirstinth` because both start with `## Context (read first, in this order)` preamble. **Fixed: v2.2a-review-completeness Q42** — new async `makeUniqueTaskId()` in `mcp/src/lib/ids.ts` reads the last 50 task_ids from `~/.claude/metrics/pipeline.jsonl`; if the sanitized slug collides with any of them, appends a `-[a-f0-9]{4}` suffix (`crypto.randomBytes(2)`). `TASK_ID_PATTERN` relaxed to allow the optional collision suffix; matching change in `templates/schemas/pipeline-state.schema.json` and `mcp/src/tools/init.ts` zod schema. Explicit caller-provided `task_id` bypasses collision detection. `driver/tools/run-task.ts` now calls `makeUniqueTaskId`. 7 new tests in `test/lib/ids.test.ts` (no-collision, with-collision, missing-file, malformed-lines, schema validation, explicit-bypass, explicit-with-suffix). |
| Q43 | 🟢 LOW | ✓ fixed (v2.2a-review-completeness) | **`impl_iters` overcounts on cross-phase same-agent.** Iteration counter is global-per-agent (logic-reviewer iter=2 = "2nd time this agent ran overall", not "2nd iter of implementation review"). Q22 derive `max(iteration) WHERE phase=X` reads wrong value. **Fixed: v2.2a-review-completeness Q43** — `mcp/src/tools/finish.ts` now uses `verdicts.filter(v => v.phase === X).length` instead of `max(iteration)`. Legacy `phases.<x>.iterations` fallback removed. 2 new tests in `finish.test.ts` (cross-phase same-agent, empty-phase). |
| Q18 | 🟡 MEDIUM | ✓ fixed (v2.1-polish-bundle) | **Agents waste tool calls hunting for `templates/schemas/category-vocab.json`.** Real-task audit logs show reviewer/validator agents (e.g. logic-reviewer) running multiple `find` commands trying to locate vocab — including `find / -path "*/templates/schemas/category-vocab.json"` (filesystem-wide!). Root cause: agent prompts reference the file by **relative path** (e.g. `agents/logic-reviewer.md` says *"Every `category` value MUST be drawn from `templates/schemas/category-vocab.json` under `vocab["logic-reviewer"]`"*). That relative path only resolves from the claude-pipeline repo root — but the agent is spawned in the user's project dir (e.g. `s3-panel/`), so the path is unresolvable. Agent falls back to `find`, which wastes tokens + risks slow whole-filesystem walks. **Architectural fix:** driver should embed the agent's vocab inline in the prompt at spawn build time — agent should never do file I/O for vocab; it's metadata the driver already has. Implementation: in `ShuttleSpawnProvider.spawn` (or shared prompt builder), read `templates/schemas/category-vocab.json` once (cache in registry), extract `vocab[agent.name]`, inject as markdown list `Allowed categories: race-condition, off-by-one, ...`. Update affected `agents/*.md` to expect inline vocab instead of file path. **Connects to Q6** (single source of truth for agent output examples — same direction: give agents resolved context, not file paths). **Effort ~1-2h.** Done in v2.1-polish-bundle: `ShuttleSpawnProvider` lazily loads `templates/schemas/category-vocab.json` (cached after first read; `__resetVocabCacheForTests` exported for the test harness). When a spawn request's agent has a vocab entry the prompt now contains `## Allowed \`category\` values for findings` with the inline allowlist. All 13 affected `agents/*.md` templates updated — no remaining `templates/schemas/category-vocab.json` path references (`grep -rl "templates/schemas/category-vocab.json" agents/` → 0 results). 3 new shuttle-provider tests assert vocab presence for logic-reviewer + security and absence for planner. |

**Backlog status post v2.2-clear-bundle merge (2026-05-14):**
- **Closed in v2.1-polish-bundle (11):** Q8, Q11, Q14, Q17-Q24, Q36.
- **Closed in v2.2-clear-bundle (10):** Q10, Q25, Q26, Q28, Q29, Q31, Q32, Q33, Q34, Q37.
- **Still open (6):** Q9 (under-spawning, **root cause: wiring**), Q27 (pre-review infra missing), Q30 (refs-to-load persistence), Q41 (refs-to-load stack-blind), Q42 (task_id slug collision), Q43 (impl_iters overcount). All bundled into **v2.2a "review-completeness"** (~6-9d).
- **Deferred (2):** Q38 (terminal-tab rename — solved natively by v2.3 Web UI). Q40 (domain bundle abstraction — needs second-domain trigger before refactor pays off).
- **Separate bundle:** Q1-Q6 code-quality items → `v2.2-code-polish` when convenient.

Total validation-driven backlog: 28 items surfaced across 5 real-task runs (auth-decoder added Q43, narrowed Q9 root cause). 21 closed, 6 open (v2.2a review-completeness), 2 deferred.

**Production-verified in Step 4 run (2026-05-14, `t-...contextreadfirstinth` Step 4):** Q17/Q26/Q37 stack threading end-to-end; Q22 metrics row populates correctly; Q23 cleanup leaves only `settings.local.json`; Q24/Q36 Stop hook tri-state working (`flow=medium step=21` not stale "STEP 1"); **Q29 vocab expansion in production** — `categories_seen: ["spec-deviation", "scope-creep", "other"]` — both new categories from Q29 used by logic-reviewer.

### v2.2 sub-bundle plan (surfaced by real-task runs on s3-panel)

The 12 open items split naturally into 4 themed sub-bundles. Recommended ship order:

**v2.2a — Review Completeness** (~6-8d, top priority)
Review surface needs fan-out AND inputs AND domain-knowledge — fixing one without the others is incomplete.
- Q9 — fix under-spawning (5 reviewers fire in implementation, plan-conformance + UI/API in validation)
- Q27 — wire pre-review infra (diff.txt, caller-context.md, antipattern-candidates.md, past-misses-*.md)
- Q30 — persist refs-to-load decision output to `pipeline-state.refs_loaded`
- Q41 — refs-to-load LLM-driven + self-describing refs (YAML frontmatter); DecisionPlugin async contract evolution; depends on Q30 (persistence) but together they form one coherent fix
- Q42 — task_id slug collision fix (hash-suffix on collision) — bundles here since metric aggregation correctness is review-related

**v2.2b — State Hygiene** (~1-2d)
Q31/Q32/Q34 are the same shape: v1-era state fields unmaintained by v2 driver. **Q35 umbrella ticket**: audit `templates/schemas/pipeline-state.schema.json` against v2 driver write-sites. Decide per field: deprecate (remove from schema, bump major) OR populate (sync from authoritative source). Q33 is similar shape but with clear "populate" answer (files.created/modified is high-value).
- Q31 + Q32 + Q34 — deprecate or sync (pick one strategy)
- Q33 — populate from `git diff --name-status` at implementation close
- Q10 — same class (current_step stale) — fold here

**v2.2c — Detector Polish** (~2-3h)
- Q26 — Q17 stack-detector honor CLAUDE.md "Validation Commands" priority; handle monorepo project_type

**v2.2d — Prompt + Vocab Polish** (~1h)
- Q28 — extend Q21 bullet list with schema_version per-finding rule
- Q29 — expand vocab (logic-reviewer at minimum)
- Q25 — docs recommendation for settings.local.json pre-approval
- **Q37** — `tools/finish.ts` copy state.stack into metrics row (~30min; fold here since it's the same surface as Q22 and equally mechanical)

**Total v2.2 effort: ~6-9d bundled.** Ship in order a → b → c → d. Each sub-bundle leaves main green and is independently mergeable.

### How to add new validation-driven Q-items

When real-task validation surfaces a new bug class:

1. Add entry to `validation-log.md` describing the bug with task_id reference + objective signals from logs.
2. Add a new Q-row to the table above with severity, effort estimate, file location, and link to the validation-log entry that surfaced it.
3. Don't fix immediately. Wait for the v2.1 bundled PR — fixing as you go fragments the polish round into N small commits and you lose the opportunity to spot patterns across bugs.

**Exception:** if a bug **blocks further validation** (e.g., `/done` can't run, `/task` won't start), fix it as v2.1 hotfix on its own and continue.

The review also called out two architectural decisions that are documented-and-acceptable (not bugs):
- `closePriorPhases` deliberately swallows `INV_002/010/011` errors during phase transitions, with rationale comment pointing to `pipeline_finish` as the real enforcement point. Keep as is.
- Two state files (`pipeline-state.json` + `driver-state.json`) are necessary: canonical state (MCP-owned) vs FSM scratchpad (driver-owned). Keep as is.

### Overall code quality assessment (architecture review, post-v2)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Plugin contracts | 9/10 | 7 interfaces, single-responsibility, JSDoc-rich, generic where appropriate |
| Core FSM | 9/10 | 141 lines, transport-agnostic via `SpawnRecorder`, exhaustive switch with `satisfies never` |
| Invariant enforcement | 9/10 | 12 INV codes with recovery paths; force=true with audit |
| Type safety | 7/10 | 33 `any` is too many — see Q1 above |
| Test discipline | 8/10 | 76% test:source ratio, property tests, security regressions, branch-coverage targeted |
| Error handling | 8/10 | Structured shuttle errors; deliberate swallows documented |
| Comments | 9/10 | "Why" comments everywhere, references to specific reviewer findings |
| Modularity | 7/10 | Clean layering; `steps/index.ts` is the one hot file — see Q2 |
| Security | 9/10 | Audit redaction, 20 guard-evasion fixtures, marker forgery prevention, path traversal blocked |
| Performance | 8/10 | Stat-based fast paths, lock-safe append, FIFO truncation |
| Extensibility | 9/10 | Plugin framework actually works; grep gate enforces; synthetic plugin smoke test proves |
| Dependencies | 10/10 | 5 runtime deps (MCP SDK, ajv, ajv-formats, proper-lockfile, zod); all justified |
| Coherence | 9/10 | Names + layout + semantics aligned |

**Overall: 8.5 / 10.** Production-grade for an early-stage OSS framework. Above-average for OSS dev tools of this age; comparable to early Mastra / Inngest / Trigger.dev; not as polished as Vercel-era libraries (those have years of refactoring behind them).

Particularly rare-for-the-stage qualities:
- 12 explicit INV codes with documented recovery paths
- Audit log with redaction in global stream
- 20 guard-evasion regression fixtures
- Property-based tests beside unit tests
- Grep gate as an architectural invariant
- Injectable `SpawnRecorder` for testability and future transports

What's missing for **product**:

- Discoverability — only known to the author
- Onboarding — assumes deep familiarity with Claude Code internals
- Distribution — manual git clone + symlink + MCP registration
- Plugin trust model — any plugin has full system access
- Multi-user / team story — single-user assumptions everywhere
- Hosted services — no shared metrics, no cross-team learning, no plugin marketplace
- Brand + docs site — no public face

The roadmap below addresses these gaps in order of leverage.

---

## Phase v2.3 — Daemon + Web UI + Multi-provider foundation

**Prerequisite:** v2 shipped (confirmed at commit `95f3f90`).
**Goal:** turn the in-process MCP-tool driver into a **long-running daemon** with HTTP API + minimal Web UI for configuration. Add the first non-shuttle `SpawnProviderPlugin` (Anthropic SDK direct) so model selection becomes meaningful. Keep Claude Code as a first-class entry point.

This phase is the bridge from "personal tool used in a Claude Code chat" to "self-hosted dev tool with multiple entry points and configurable LLM backends".

### What's already in place from v2 (don't redo)

These pieces were nudged into v2 ahead of time so v2.3 doesn't need rework:

- ✓ `ClaudePipelineConfig` type in `mcp/src/driver/types/config.ts` — the schema Web UI will edit.
- ✓ `resolveAgentModel(plugin, phase, config)` cascade — phase passed explicitly (no template_path heuristic).
- ✓ State IO encapsulated through `tools/*.ts` + `driver/core/state.ts` — SQLite swap is a state-layer-only change.
- ✓ Driver transport-agnostic (`runFSM(state, registry)` accepts injected `SpawnRecorder`; HTTP API will inject its own).
- ✓ Driver↔pipeline-state fully wired via `mcpSpawnRecorder` — open spawns close correctly through `pipelineBeginAgent` + `pipelineRecord*`.
- ✓ Concurrency-safe driver (`withDriverStateLock` on both `pipelineRunTask` and `pipelineContinueTask`).
- ✓ `pipeline_set_pattern_confidence` MCP tool (Item 11) — past-misses confidence override already works.
- ✓ `pipeline_meta` MCP tool (Item 12) — Web UI can call this to discover protocol version + tool list.
- ✓ `lib/ids.ts` consolidates id generators (don't write new ones; import).
- ✓ `lib/audit.ts` is lock-safe + bounded + redacted in global stream.
- ✓ `lib/project-dir.ts:assertProjectDirAllowed()` — **MUST be used by HTTP API in v2.3.3 for every incoming `project_dir`** (Web UI is a path-traversal vector otherwise).
- ✓ Bypass marker is forgery-resistant (`issued_at + TTL cap` ≤ 3600s) — Web UI "Unlock writes" button calls existing `pipeline_unlock_writes`; do not reinvent the marker format.

v2.3 builds **on top of** these; reuse them, don't reinvent.

### Security must-haves carried over from v2

1. **HTTP API endpoints accepting `project_dir`** (POST /api/tasks, GET /api/tasks/:id, etc.): wrap every `project_dir` extraction through `assertProjectDirAllowed()` before passing to MCP tools. Without this, a malicious request can target paths outside the user's projects (e.g. `~/.ssh/`).
2. **Web UI "Unlock writes" button**: bound TTL to the same 3600s max enforced by `pipeline_unlock_writes`. Don't bypass.
3. **HTTP API task submission must use the SAME `mcpSpawnRecorder`** as MCP entry points — guarantees pipeline-state stays consistent regardless of which client submitted.
4. **`INV_012` fires on both `completed` AND `skipped`** (review fix L3). If v2.3 adds gate-policy plugins that auto-skip phases, they MUST cancel open spawns first or hit this invariant.

### Target architecture after v2.3

```
┌─────────────────────────────────────────────────────────────┐
│ ENTRY POINTS (equally first-class)                          │
│   Web UI (SvelteKit/Astro SPA, localhost:5173)              │
│   Claude Code chat (/task via MCP, unchanged from v2)        │
│   CLI (claude-pipeline submit/status/tail/queue)             │
└─────────────────────────────────────────────────────────────┘
                ↓ HTTP/SSE  ↓ MCP stdio  ↓ direct
┌─────────────────────────────────────────────────────────────┐
│ DAEMON (long-running Node, started via launchd/systemd/CLI)  │
│   ├─ HTTP server (Fastify): /api/{config,tasks,agents,...}   │
│   ├─ MCP server (stdio): unchanged from v2                   │
│   ├─ Driver: v2 FSM + plugin framework, shared by all entry  │
│   └─ Persistence: SQLite (config + history) + JSONL (audit) │
└─────────────────────────────────────────────────────────────┘
```

### v2.3.1 — Daemon lifecycle

- `claude-pipeline daemon start|stop|status|restart` CLI commands.
- PID file in `~/.claude-pipeline/daemon.pid`, log file in `~/.claude-pipeline/daemon.log`.
- Optional: `launchd` plist for macOS / `systemd` unit for Linux to autostart.
- Daemon process owns the singleton `PluginRegistry` + driver. All entry points connect to the same daemon.
- Health endpoint `GET /healthz` returns daemon uptime + plugin counts.

**Effort:** ~1 day.

### v2.3.2 — SQLite migration for queryable state

JSONL is great for audit (append-only stream) but bad for "list my last 50 tasks". Migrate:

| Data | Stays as | Becomes |
|------|----------|---------|
| `~/.claude/metrics/pipeline.jsonl` | JSONL (append-only) | Mirrored to SQLite `tasks` table for queries |
| `~/.claude/metrics/agent-feedback.jsonl` | JSONL | Mirrored to SQLite `past_misses` table |
| `~/.claude/metrics/mcp-audit.jsonl` | JSONL | Stays JSONL only (high volume, append-only) |
| Per-agent config | n/a | New: SQLite `agent_configs` table |
| Pipeline config | n/a | New: SQLite `pipeline_config` table (single row) |
| Plugin registry state | n/a | New: SQLite `plugins` table (enabled/disabled, version) |
| **Per-spawn cost** | n/a | New: SQLite `spawn_costs` table — provider, model, input_tokens, output_tokens, est_cost_usd, ts, task_id, agent |
| **Task budgets** | n/a | New: SQLite `task_budgets` table — limit_usd, spent_usd, status |

New `StateStorePlugin` contract (8th plugin type):

```typescript
export interface StateStorePlugin extends PluginMeta {
  name: string;
  loadConfig(): Promise<ClaudePipelineConfig>;
  saveConfig(c: ClaudePipelineConfig): Promise<void>;
  loadAgentConfig(agent: string): Promise<AgentConfig | null>;
  saveAgentConfig(agent: string, c: AgentConfig): Promise<void>;
  listTasks(filter): Promise<TaskSummary[]>;
  getTask(taskId): Promise<TaskFull | null>;
  // ...
}
```

Built-in: `SqliteStateStorePlugin` using `better-sqlite3` or Drizzle.
Driver consumes via `registry.state_store` — no direct DB knowledge.

**Effort:** ~1-2 days.

### v2.3.3 — HTTP API

Fastify server inside the daemon, mounting:

```
GET    /api/config                  → current pipeline config
PATCH  /api/config                  → update config
GET    /api/agents                  → list all agents with their configs
PATCH  /api/agents/:name            → update per-agent config (model, provider, model params)
GET    /api/providers               → list registered SpawnProviders + status
GET    /api/tasks                   → recent tasks (paginated)
POST   /api/tasks                   → submit new task (queues it)
GET    /api/tasks/:id               → single task with status, agents, findings
GET    /api/tasks/:id/stream        → SSE stream of live updates
DELETE /api/tasks/:id               → cancel a running task (via pipeline_abandon)
GET    /api/findings                → search findings by category/agent/file
GET    /api/audit                   → recent audit entries
GET    /api/metrics                 → aggregate metrics for /metrics-report UI
GET    /api/plugins                 → installed plugins + their manifests
```

OpenAPI spec auto-generated. All endpoints schema-validated via Zod (already a dependency).

**Effort:** ~1-2 days.

### v2.3.4 — Multi-provider SpawnProviders (first batch)

Implement the second `SpawnProviderPlugin` so model selection becomes meaningful:

1. **`AnthropicSdkSpawnProvider`** — uses `@anthropic-ai/sdk` directly. Requires `ANTHROPIC_API_KEY`. User specifies model per agent in config.
2. **`ClaudeCodeSubprocessSpawnProvider`** (optional) — invokes `claude` CLI with `--output-format stream-json` per agent (ralphex pattern). For users who want autonomous-from-Claude-Code-subprocess without needing API key.

Driver behavior:
- Reads `agent_config.provider` from SQLite (e.g. `"shuttle" | "anthropic-sdk" | "claude-code-subprocess"`).
- Looks up the matching `SpawnProviderPlugin` in registry.
- Hands off the spawn request.

**Effort:** ~2-3 days for SDK provider + ~1 day for subprocess provider.

### v2.3.5 — Minimal Web UI

**Stack:** SvelteKit or Astro (single-binary friendly, builds to static assets, served by daemon's HTTP). Tailwind via CDN for fast iteration.

**Pages (4, plus a shell):**

1. **Settings** — global pipeline config (default models per phase, complexity heuristic overrides, gate policy, notification preferences).
2. **Agents** — list of registered agents. Per-agent: provider dropdown, model dropdown (populated from provider capabilities), token/cost limit, timeout, enabled/disabled toggle.
3. **Tasks** — submit form + recent tasks list. Click task → detail view with timeline, agent spawns, findings, audit trail, SSE-live updates while running.
4. **Plugins** — list installed plugins with manifest, version, capabilities. Mostly read-only initially; enable/disable in v2.3 era; plugin marketplace in P2.

**Effort:** ~3-4 days.

### v2.3.6 — Auto-mode gates + notifications

By default after v2.3, gates auto-approve in the daemon (HTTP-submitted tasks run unattended). Interactive gates remain for Claude Code chat flow.

New plugin types:
- **`GatePolicyPlugin`** (variants: `auto-approve`, `escalate-on-blocker`, `interactive`).
- **`NotificationPlugin`** (built-ins: `desktop-notify`, `webhook`, `email-via-smtp`, `log-only`).

Per-task in submit form: choose gate policy + notification target.

**Effort:** ~1-2 days.

### v2.3.7 — Permission strategy for autonomous mode

Claude Code asks the user for permission before running Bash commands, editing files, calling MCP tools, etc. In interactive `/task` flow this is fine — user clicks through. In autonomous (daemon-submitted) tasks there's nobody to click. v2.3 must offer mechanisms that don't block on permission prompts.

**Background.** Claude Code permission system:
- `permissions.allow[]` in `~/.claude/settings.json` whitelists tools/commands.
- `defaultMode: "acceptEdits"` auto-approves file edits.
- `--dangerously-skip-permissions` CLI flag bypasses everything (used by ralphex).
- Task-spawned sub-agents inherit parent session's permission grants.

**Three strategies, configurable per task via `pipeline_config.permission_strategy`:**

#### Strategy B — Claude Code subprocess + skip-permissions (DEFAULT for autonomous mode)

`ClaudeCodeSubprocessSpawnProvider` invokes `claude --dangerously-skip-permissions --output-format stream-json --verbose` per agent (ralphex pattern). Bypasses all permission prompts.

**Why this is the default:** v2.4 makes Docker isolation the default execution environment for autonomous tasks. With the container as the blast-radius boundary, `--dangerously-skip-permissions` is safe — the agent can do whatever, but it can only do it inside the throwaway container. This combination = ralphex-grade autonomy + better isolation than ralphex (per-task containers vs ralphex's optional Docker wrapper).

**Pros:**
- Uses existing Claude Code subscription (no separate API key).
- Mirrors a battle-tested pattern (ralphex).
- Agent behavior is identical to interactive mode (no behavioral surprises).
- No permission-prompt deadlocks possible.

**Cons:**
- Requires `claude` CLI installed in the daemon's environment / Docker image (already true for our daemon container).
- "dangerously" is in the flag name — pair with Docker isolation always.

**Effort:** ~1 day, slots into v2.3.4 work.

#### Strategy A — Anthropic SDK direct (alternative for headless or API-first setups)

`AnthropicSdkSpawnProvider` calls `@anthropic-ai/sdk` directly. Claude Code permission system never engages because we're not using Claude Code at all for the spawn.

Tool surface is explicit in the SDK call:

```typescript
const response = await anthropic.messages.create({
  model: agentConfig.model,
  tools: BUILTIN_AGENT_TOOLS,  // Read, Edit, Bash (with shell filter), Grep, etc.
  messages: [...],
});
```

**When to use:** running daemon on a server without Claude Code CLI installed; CI integrations; cost monitoring through Anthropic console rather than Claude Code subscription; needs explicit per-tool audit.

**Pros:** explicit tool surface, no Claude Code CLI dependency, separate Anthropic billing visibility, foundation for multi-model providers in P5.
**Cons:** requires `ANTHROPIC_API_KEY`; separate billing from Claude Code subscription; agent tools must be defined explicitly (more work than just inheriting Claude Code's defaults).
**Effort:** already counted in v2.3.4.

#### Strategy C — Pre-warmed allowlist + shuttle (alternative for paranoid users)

For users who want subprocess mode WITHOUT `--dangerously-skip-permissions` even with Docker isolation: daemon generates `~/.claude-pipeline/auto-settings.json` per task with computed allowlist and spawns Claude Code subprocess with `--settings <path>`.

**When to use:** belt-and-suspenders security in environments where Docker isolation is considered insufficient (e.g., shared CI runners).

**Pros:** controlled blast radius even inside the container.
**Cons:** allowlist is a guess; tasks needing unexpected commands halt; complexity.
**Effort:** ~1-2 days, can be added later if A+B insufficient.

#### Configuration

```typescript
// ClaudePipelineConfig
permission_strategy: {
  // Default for autonomous tasks (HTTP submission, CLI submission).
  default_autonomous: "subprocess-skip",  // (Strategy B)

  // Default for interactive tasks (Claude Code /task chat).
  // "shuttle" = inherits Claude Code's permission system (user clicks through).
  default_interactive: "shuttle",

  // Per-agent overrides.
  per_agent_overrides?: Record<string, "shuttle" | "subprocess-skip" | "anthropic-sdk" | "subprocess-allowlist">,

  // For Strategy C only.
  subprocess_allowlist?: string[],
}
```

Web UI Settings page surfaces this as a radio choice per mode (autonomous/interactive) + per-agent override grid. The default values above are pre-selected; user can change but the safe defaults assume Docker isolation is on.

### v2.3.8 — Branch isolation + merge strategy (worktree + auto-merge)

Each autonomous task runs in a `git worktree` isolated from the main working tree:

```
<repo>/
  .git/                                    # main git dir
  src/                                     # main branch checkout
  .claude-pipeline/worktrees/
    t-2026-05-13-feature-x/                # worktree for autonomous task
      src/                                 # isolated checkout of task branch
      .claude/                             # task-local state
```

`pipeline_init` accepts `isolation: "worktree" | "in-place"` (default `in-place` for interactive Claude Code `/task`; default `worktree` for autonomous Web UI / CLI submissions).

#### Branch strategy (where task runs)

| Strategy | When | Behavior |
|----------|------|----------|
| `in-place` | Interactive `/task` in Claude Code chat (default) | Task runs on current branch. User sees changes immediately. No worktree. |
| `new-branch` | Autonomous Web UI submission (default) | Daemon creates `claude-pipeline/<task_id>` branch from configured base. Worktree checks it out. All commits land on this branch. |
| `existing-branch` | Submitter specifies target branch in submit form | Like `new-branch` but checks out an existing branch (e.g. resume work on a feature branch). |

Branch name pattern is configurable: `branch_name_template: "claude-pipeline/{task_id}"` (defaults shown; can be `"feat/{task_short}"` or whatever).

#### Merge strategy (what happens when task completes successfully)

User-selectable in **Web UI submit form** (overrides global default in Settings):

| Strategy | Behavior | When to use |
|----------|----------|-------------|
| `no-merge` (manual) | Task branch left untouched. UI shows "Merge ready" with link to open PR or merge locally. | Code review desired before integration. Default for first-time users. |
| `auto-merge` | After `pipeline_finish` succeeds, daemon `git merge --no-ff <task-branch>` into base (preserves task history). | Trusted autonomous flows where review already happened via in-pipeline reviewers. |
| `auto-squash-merge` | Same as `auto-merge` but `git merge --squash` + auto-commit with summary message. Loses individual task commits, keeps single "feat: <task description>" commit. | Clean linear history preferred. **Toggle in UI** as per user request. |
| `auto-rebase-merge` | `git rebase` task branch onto base, then fast-forward. | Linear history without explicit merge commits. |

#### Auto-merge safety preconditions (HARD)

Auto-merge ONLY proceeds when ALL of:

1. `pipeline_finish` returned successfully (`verdict: "accepted"`, no INV violations).
2. All gates were either approved or auto-approved per `GatePolicyPlugin`.
3. All tests in `phases.test_first.test_files_written` and `phases.validation` are green.
4. No `pipeline_violation` flag is set on state.
5. `git merge --no-commit` dry-run shows no conflicts with base.

If ANY of these fails → fall back to `no-merge` (manual), with notification explaining which precondition blocked.

Conflict on attempted merge → daemon aborts the merge cleanly (`git merge --abort`), leaves the task branch, and emits a `merge-conflict` notification with the conflict file list. User resolves manually.

#### UI surface

**Settings page (global defaults):**

```
Branch & Merge defaults
────────────────────────
Branch strategy (autonomous tasks):
  ◯ Stay on current branch (in-place)
  ◉ Create new branch (recommended)
  ◯ Resume existing branch (specified per submission)

Default base branch: [main ▼]
Branch name template: [claude-pipeline/{task_id}]

Merge strategy when task succeeds:
  ◉ Manual (notification only, no merge)
  ◯ Auto-merge (git merge --no-ff, preserves task commits)
  ◯ Auto-squash-merge (single commit with task summary)
  ◯ Auto-rebase-merge (linear history)

  ☐ Push to remote after merge (origin/main)
  ☐ Delete task branch after merge
```

**Task submit form (per-task override):**

```
Task: [_______________________________________]

▼ Advanced
  Base branch:   [main ▼]  (default from Settings)
  Merge:         [Manual ▼]   ← user request: dropdown overrides global
                  ├ Manual (notification only)
                  ├ Auto-merge
                  ├ Auto-squash-merge
                  └ Auto-rebase-merge
  ☑ Delete branch after merge
```

**Tasks list (per-task status):**

| Task | Branch | Status | Merge |
|------|--------|--------|-------|
| t-...-rename-foo | `claude-pipeline/t-...-rename-foo` | ✓ done | ✓ squash-merged into main |
| t-...-auth-fix | `feat/auth-overhaul` | ⏵ running | — |
| t-...-migrate | `claude-pipeline/t-...-migrate` | ✗ failed | ✗ branch preserved for inspection |

#### Configuration

```typescript
// ClaudePipelineConfig
branch_strategy: {
  default_autonomous: "new-branch",       // for Web UI / CLI submissions
  default_interactive: "in-place",         // for Claude Code /task chat
  base_branch: "main",                     // configurable
  branch_name_template: "claude-pipeline/{task_id}",
  delete_branch_after_merge: false,        // safety: off by default
  push_after_merge: false,                  // safety: off by default
},
merge_strategy: {
  default_on_success: "no-merge",          // safe default; user opts into auto-*
  per_task_override: true,                  // submit form can override
  fallback_on_precondition_fail: "no-merge", // never auto-merge unsafely
},
```

#### Per-merge audit

Every auto-merge attempt (success OR failure) appends to `~/.claude/metrics/mcp-audit.jsonl` via the existing `audit()` helper:

```json
{
  "schema_version": "1.0",
  "ts": "...",
  "tool": "branch:auto-merge",
  "task_id": "t-...",
  "args_summary": {
    "branch": "claude-pipeline/t-...",
    "base": "main",
    "strategy": "squash-merge",
    "preconditions_pass": true,
    "merge_result": "success" | "conflict" | "blocked-by-precondition"
  },
  "verdict": "ok"
}
```

This gives `/learn` data about which merge strategies users prefer + how often auto-merge gets blocked by preconditions.

**Pros:** multiple autonomous tasks run in parallel without branch conflicts; failed tasks discardable without affecting main; auto-merge is opt-in per task with safety preconditions.
**Cons:** worktree management adds complexity; merge conflicts on completion need handling (mitigated by dry-run + abort).
**Effort:** ~3-4 days (worktree management ~1d, branch strategies ~1d, merge strategies + safety ~1-2d, UI controls ~0.5d).

### v2.3 acceptance

1. `claude-pipeline daemon start` runs the daemon; `status` shows uptime + plugin counts.
2. `localhost:5173` (or chosen port) serves Web UI; Settings page reads and persists changes.
3. Per-agent model override in Web UI takes effect on next task spawn (proven by audit log).
4. Submitting a task via Web UI runs autonomously to completion; finding count + verdict appear in task detail view.
5. Same task submitted via Claude Code `/task` still works through shuttle (one daemon, two entry points).
6. SSE stream pushes live progress updates while a task runs.
7. SQLite contains `tasks`, `agent_configs`, `pipeline_config`, `plugins` tables; queryable via raw SQL for debugging.
8. At least one non-shuttle SpawnProvider works end-to-end (e.g., a task fully driven through `AnthropicSdkSpawnProvider`).
9. Auto-approve gate plugin lets tasks run unattended; notification fires on completion.
10. Autonomous task submitted with `merge: auto-squash-merge` selected in the UI: completes successfully → daemon creates squash merge commit on `main` with summary message, task branch deleted (if configured). Audit log records `tool: "branch:auto-merge"` entry.
11. Same task submitted with `merge: no-merge`: completes successfully → task branch preserved, notification shows "Merge ready: `claude-pipeline/<task_id>`" with a CTA. No write to base branch.
12. Auto-merge precondition guard works: deliberately break a test in a task with `auto-merge` selected → daemon detects failure, falls back to `no-merge`, notification explains "auto-merge blocked: tests not green".

### v2.3 total effort

**~12-15 focused days of agent work** (or 2.5-3 weeks in comfortable pace with reviews). Could be 3-4 Claude Code sessions due to scope. Grew from earlier ~10-13 estimate after expanding v2.3.8 to cover full branch + merge strategy with auto-merge safety preconditions, audit logging, and UI controls.

### Decision gates inside v2.3

- After v2.3.1 (daemon): does the daemon model feel right? If not, can fall back to per-invocation Node process. Skip v2.3.2+ if user finds daemon too heavy.
- After v2.3.4 (multi-provider): does provider switching actually help? If single provider (Claude Code) covers all needs, defer remaining providers indefinitely.
- After v2.3.5 (Web UI MVP): is the UI actually used vs `/task` in chat? If chat covers 90% of use, treat Web UI as read-only history viewer and stop adding write features.
- After v2.3.7 (permission strategy): which strategy gets the most use? If Strategy A dominates, can drop work on Strategy C.

---

## Phase v2.4 — Container isolation + Docker distribution

**Prerequisite:** v2.3 shipped (daemon + autonomous mode exist).
**Goal:** Docker isolation **is the default execution environment for autonomous tasks**, not opt-in. Ship daemon as Docker images. Per-task containers are spawned automatically. Combined with Strategy B (`--dangerously-skip-permissions` Claude Code subprocess), this gives ralphex-grade autonomy with stronger isolation than ralphex.

**Design philosophy:** `--dangerously-skip-permissions` is safe ONLY because Docker is the cage. The two defaults reinforce each other:
- Subprocess + skip-permissions → no permission prompts, fast execution, full agent capability.
- Docker container per task → blast radius is the ephemeral container, host filesystem untouched, network egress controlled.

Removing either one breaks the safety argument. Both must ship together as default.

Interactive mode (Claude Code chat `/task`) does NOT change — user is in the loop, no isolation needed by default, shuttle provider with normal permissions still works.

### v2.4.1 — Daemon-as-Docker-image

Build and publish Docker images:

```
ghcr.io/<org>/claude-pipeline:latest        # base — Node + daemon + MCP server
ghcr.io/<org>/claude-pipeline-ts:latest     # + TypeScript toolchain pre-installed
ghcr.io/<org>/claude-pipeline-py:latest     # + Python toolchain
ghcr.io/<org>/claude-pipeline-go:latest     # + Go toolchain
ghcr.io/<org>/claude-pipeline-flutter:latest # + Flutter SDK
```

Daemon listens on `:5173` (HTTP) inside the container; user maps to host port.

Standard run:

```bash
docker run -d \
  -p 5173:5173 \
  -v $HOME/projects:/projects \
  -v $HOME/.claude-pipeline:/data \
  -e ANTHROPIC_API_KEY=sk-... \
  ghcr.io/<org>/claude-pipeline-ts:latest
```

Docker Compose template included in `examples/` for common setups (with traefik for cleaner local URLs, with persistent SQLite volume, multi-project mount).

**Effort:** ~2 days. Dockerfile + GitHub Actions workflow for builds on tag.

### v2.4.2 — Per-task container isolation

Even when daemon runs on host, individual autonomous tasks can spawn in their own throwaway containers. New `ExecutionEnvironmentPlugin` (9th plugin type):

```typescript
export interface ExecutionEnvironmentPlugin extends PluginMeta {
  name: string;
  // Acquire an isolated working environment for one task.
  acquire(task: TaskHandle): Promise<{ workspace_path: string; cleanup: () => Promise<void> }>;
}
```

Built-in implementations:

- **`DockerContainerEnvironment`** (DEFAULT for autonomous tasks): spins up a fresh container per task. Volume-mounts a worktree as `/workspace`. Resource limits (CPU, memory) configurable. Network policy: default-deny outbound except `api.anthropic.com` + per-language package registries + git remotes. Container torn down after task finalizes (kept 60 min for inspection if task failed, configurable).
- **`InPlaceEnvironment`** (DEFAULT for interactive Claude Code chat tasks): uses `<project>/.claude-pipeline/worktrees/<task_id>/` from v2.3.8. No container — just git worktree on the host. Fast, no filesystem isolation. Safe because user is in the loop.
- **`FirecrackerEnvironment`** (P2 era — too heavy for v2.4): VM-level isolation. Skip for now.

Configuration with sane defaults:

```typescript
// ClaudePipelineConfig
execution_environment: {
  // Hardwired defaults reflecting the safety design:
  default_autonomous: "docker-container",   // mandatory isolation for unattended tasks
  default_interactive: "in-place",           // user-watched, no isolation needed

  docker: {
    image: "ghcr.io/<org>/claude-pipeline-ts:latest",  // matches detected project stack
    network: "allowlist",                    // default
    allowed_hosts: [
      "api.anthropic.com",
      "registry.npmjs.org",
      "pypi.org",
      "github.com",
      // + project's git remote auto-added
    ],
    cpu_limit: "1.0",
    memory_limit: "2g",
    keep_after_failure_minutes: 60,
    wall_time_limit_minutes: 120,
  },

  per_agent_overrides?: Record<string, "docker-container" | "in-place">,
}
```

Web UI Settings page exposes this but the defaults above are pre-selected. Changing `default_autonomous` away from `docker-container` shows a warning: *"Without container isolation, `--dangerously-skip-permissions` (Strategy B in permission settings) is unsafe. Consider switching permission strategy to Anthropic SDK (Strategy A) if you disable container isolation."*

**Effort:** ~3-4 days. Container lifecycle + network policy enforcement + volume mounts + cleanup.

### v2.4.3 — Network policy

Tasks executing in `DockerContainerEnvironment` get a default-deny network policy with a small allowlist:

- `api.anthropic.com` (always, for SDK provider)
- `registry.npmjs.org`, `pypi.org`, `proxy.golang.org`, etc. (per-language package managers)
- `github.com`, the project's git remote (for clone/push)

User can extend per-task or globally. Egress to anything else logged + denied. This protects against accidentally-malicious plugins or compromised dependencies trying to phone home.

Implementation: Docker network in `bridge` mode + iptables rules inside container, or external DNS+proxy. Start with iptables-in-container for simplicity.

**Effort:** ~2 days. Includes audit-log entries for each blocked egress attempt.

### v2.4.4 — Volume-mount strategy

Three tiers of access:

| Mount | Purpose | Default mode |
|-------|---------|--------------|
| `/workspace` | Worktree containing the actual code | rw |
| `/data` | Daemon's `~/.claude-pipeline/` | rw |
| `/secrets` | API keys, .env (only what task explicitly needs) | ro, via env injection |
| `/host` | Rest of host filesystem | NOT mounted by default |

Tasks NEVER see arbitrary host filesystem. `~/.ssh` etc. invisible unless user explicitly maps something.

If a task needs files outside the worktree (e.g., shared design system in a sibling dir), user must mount it explicitly.

**Effort:** ~1 day. Already mostly determined by the run script in v2.4.1; finalized here.

### v2.4.5 — Resource limits + escape valves

Per-task limits, enforced at container level:

- **CPU:** default `1.0` core; configurable per task or per agent.
- **Memory:** default `2GB`; configurable.
- **Disk:** default `5GB` ephemeral volume.
- **Wall time:** default `2 hours`; configurable. Hard kill on exceed (records `pipeline_violation: timeout`).
- **Network bandwidth:** optional rate limit (1 MB/s default).

If a task hits any limit, daemon surfaces it via SSE + audit log + notification. Recovery: same paths as other failures (Items 5 in v2 spec — abandon / force-close / retry).

**Effort:** ~1 day. Most of this is `docker run --cpus 1.0 --memory 2g` flags; some daemon-side enforcement for wall time.

### v2.4 total effort

**~9-11 focused days.** Could be 2 Claude Code sessions.

### v2.4 acceptance

1. `docker run ghcr.io/<org>/claude-pipeline-ts` starts a working daemon; Web UI accessible on mapped port.
2. **Autonomous tasks default to Docker container execution + Strategy B (subprocess-skip-permissions).** Verified: submit a task via HTTP without specifying environment → daemon spawns container + claude subprocess with skip-permissions → task completes → container torn down.
3. **Interactive tasks via Claude Code `/task` default to in-place + shuttle** (no container, normal permissions). Verified: same outcome as v2 when run through `/task`.
4. Disabling Docker default in Web UI shows the safety warning explaining the dependency on Strategy A.
5. Network policy blocks egress to non-allowlisted hosts; audit log records the attempt.
6. Wall-time timeout kills a runaway task; pipeline-state reflects timeout violation.
7. `--keep-container` flag preserves container for inspection after failure.
8. `ExecutionEnvironmentPlugin` is registered like other plugins; users can add custom environments without core changes.
9. Docker Compose template in `examples/` works end-to-end (daemon + persistent SQLite + multi-project mount).
10. Inside a v2.4 container, an agent doing `rm -rf /tmp/foo` only affects the container's `/tmp`, not the host (proves the isolation).

### v2.4 decision gates

- After v2.4.1 (daemon image): is anyone running the daemon-in-Docker? If only the author, the image is a distribution detail; per-task isolation (v2.4.2) is the main value.
- After v2.4.2 (per-task isolation): does container startup add significant latency? If >30s per task, consider container reuse (pool of warm containers) — separate optimization.

---

## Phase v2.5 — Cost-aware multi-provider routing

**Prerequisite:** v2.4 shipped (daemon + Docker isolation + at least Strategy A/B SpawnProviders).
**Goal:** make hybrid LLM routing economically viable. Premium models (Claude Opus/Sonnet) for quality-critical roles (planner, implementer, security). Cheap models (DeepSeek, Qwen via Ollama) for mechanical roles (style-reviewer, plan-conformance). Long-context models (Gemini 2.5 Pro) for diff-heavy roles (api-contract, ui-consistency). Cost tracking + budget caps so autonomous mode doesn't burn through money silently.

This phase is what makes autonomous mode **sustainable**. ~4-10× cost reduction on typical MEDIUM tasks while preserving quality on critical agents.

### Why now (before P1 open-source)

Once the tool is autonomous, the bill comes fast:
- Opus-only MEDIUM task: $8-15
- Sonnet-only: $3-5
- Tier-based hybrid: $1-2
- Hybrid with local Ollama for cheap tier: $0.5-1

For a personal tool used 5-10x/week → $50-150/month savings.
For any product use → the difference between viable and not.

### v2.5.1 — Additional SpawnProviderPlugins

Ship 5 more providers beyond v2.3's Anthropic SDK + Claude Code subprocess:

- **`OpenRouterSpawnProvider`** (RECOMMENDED for multi-provider users) — single API key, access to 200+ models (Anthropic, OpenAI, Google, DeepSeek, Mistral, Llama variants, etc.) via OpenAI-compatible API at `https://openrouter.ai/api/v1`. Eliminates need for separate provider integrations for 90% of users.
- **`OpenAiSpawnProvider`** — GPT-5.x via OpenAI Responses API directly. For users with existing OpenAI credits or who want direct billing.
- **`DeepSeekSpawnProvider`** — DeepSeek V3.x via DeepSeek's OpenAI-compatible API directly. For direct billing or when OpenRouter overhead matters.
- **`GeminiSpawnProvider`** — Gemini 2.5 Pro / Flash via Google AI Studio SDK directly. Special handling for huge context window (1M+ tokens).
- **`OllamaSpawnProvider`** — local models via Ollama HTTP API (`localhost:11434`). Auto-detects available models (`/api/tags`).

All cloud providers share a `BaseLLMSpawnProvider` abstract class (~150 LoC). Concrete adapters: OpenRouter and OpenAI essentially identical (different baseURL); DeepSeek = OpenAI with different baseURL; Gemini has its own SDK; Ollama uses fetch().

**Why OpenRouter as the recommended multi-provider entry point:**

| Aspect | Direct SDKs | OpenRouter |
|--------|-------------|------------|
| API keys to manage | 1 per provider | **1 total** |
| Billing dashboards | 1 per provider | **1 total** |
| Access to newly released models | Wait for SpawnProvider update | **Immediate** (change model string) |
| Auto-fallback on unavailable model | Manual | **Built-in** (`models: [...]` array) |
| Cost overhead | $0 | ~5-10% margin |
| Latency | Direct | One extra hop |
| OSS models (Llama, Qwen, etc.) | Need Ollama or Together/Groq | **Hosted natively** |

For users with high volume (>$50/mo on a single provider): direct SDK saves the OpenRouter margin. For everyone else: OpenRouter is the simpler choice.

**Recommended hybrid configuration** (subscription + OpenRouter + local):

```typescript
tiers: {
  // Subscription — $0 marginal cost
  premium:  { provider: "claude-code-subprocess", model: "claude-opus-4-7" },
  balanced: { provider: "claude-code-subprocess", model: "claude-sonnet-4-6" },

  // OpenRouter — one key, multiple models
  cheap:        { provider: "openrouter", model: "deepseek/deepseek-v3.2" },
  long_context: { provider: "openrouter", model: "google/gemini-2.5-pro" },

  // Local — free, requires GPU
  local: { provider: "ollama", model: "qwen3-coder:32b" },
}
```

**Effort:** ~3-4 days total. OpenRouter + OpenAI are essentially the same plugin (different baseURL); DeepSeek same again; only Gemini SDK and Ollama require unique code paths.

### v2.5.2 — Tier abstraction + routing decision

New config schema (lives in `ClaudePipelineConfig.routing`):

```typescript
type Tier =
  | "premium"      // Opus, GPT-5.5 Pro
  | "balanced"     // Sonnet, GPT-5.5
  | "cheap"        // DeepSeek V3, Qwen
  | "long_context" // Gemini 2.5 Pro
  | "local"        // Ollama local model
  | string;        // user-defined tier name

type TierConfig = {
  provider: string;          // SpawnProvider name
  model: string;             // model id
  max_tokens_per_spawn?: number;
  timeout_ms?: number;
};

type RoutingConfig = {
  tiers: Record<Tier, TierConfig>;
  agent_tiers: Record<string, Tier>;   // agent name → tier
  fallback_tier?: Tier;                 // when tier unreachable (e.g., Ollama down)
  cost_aware_downgrade?: {
    enabled: boolean;
    threshold_percent: number;          // 70% = downgrade tier when 70% of budget spent
    downgrade_map: Record<Tier, Tier>;  // premium → balanced, balanced → cheap, etc.
  };
};
```

New `DecisionPlugin<RouteSelection>` resolves an agent name + current state into `{provider, model}`:

```typescript
function decide({ agent, state, config }) {
  const tier = config.routing.agent_tiers[agent.name] ?? agent.default_tier ?? "balanced";

  // Cost-aware downgrade
  if (config.routing.cost_aware_downgrade?.enabled) {
    const spent_pct = state.task_costs.spent_usd / state.task_costs.limit_usd;
    if (spent_pct > config.routing.cost_aware_downgrade.threshold_percent / 100) {
      const downgraded = config.routing.cost_aware_downgrade.downgrade_map[tier];
      if (downgraded) tier = downgraded;
    }
  }

  return config.routing.tiers[tier];
}
```

Built-in default tiers + agent_tiers in `loaders/builtins.ts` reflecting the market reality (see preset below). User can override per-project via Web UI.

**Default preset (recommended starting point):**

```typescript
tiers: {
  premium:      { provider: "anthropic-sdk", model: "claude-opus-4-7" },
  balanced:     { provider: "anthropic-sdk", model: "claude-sonnet-4-6" },
  cheap:        { provider: "deepseek-sdk",  model: "deepseek-v3.2" },
  long_context: { provider: "gemini-sdk",    model: "gemini-2.5-pro" },
  local:        { provider: "ollama",        model: "qwen3-coder:32b" },
},
agent_tiers: {
  planner:               "balanced",     // quality matters
  implementer:           "balanced",
  architect:             "premium",
  logic-reviewer:        "balanced",
  challenger-reviewer:   "balanced",
  security:              "premium",
  performance:           "premium",
  style-reviewer:        "cheap",        // mechanical
  acceptance:            "cheap",
  plan-conformance:      "cheap",
  plan-grounding-check:  "cheap",
  context-doc-verifier:  "cheap",
  api-contract:          "long_context", // big diffs
  ui-consistency:        "long_context",
  research:              "balanced",
  migration:             "premium",
  code-analyzer:         "balanced",
  dependency-auditor:    "cheap",
  test:                  "balanced",
  playwright:            "balanced",
}
```

**Effort:** ~2 days.

### v2.5.3 — Cost tracking infrastructure

Already partly added in v2.3.2 (SQLite `spawn_costs` and `task_budgets` tables). v2.5.3 wires them up:

**HookPlugin: `costTrackingHook`** (event=`after-agent-result`):
- Receives spawn result with `usage: {input_tokens, output_tokens}` from the SpawnProvider.
- Looks up price per 1M tokens from `tiers` config (each TierConfig has `pricing: {input_per_1m_usd, output_per_1m_usd}`).
- Computes `est_cost_usd = (input_tokens / 1e6 * input_price) + (output_tokens / 1e6 * output_price)`.
- Appends to SQLite `spawn_costs` table.
- Updates `task_budgets.spent_usd` for the current task.

**HookPlugin: `budgetGuardHook`** (event=`before-agent-spawn`):
- Reads `task_budgets.spent_usd` and `limit_usd`.
- If `spent_usd >= limit_usd`: emit `status: "error"` with code `BUDGET_EXCEEDED`, recovery options `["raise-budget", "abandon", "downgrade-tier"]`.
- If `spent_usd >= 0.8 * limit_usd`: emit warning to audit log (no halt).

**MCP tools:**
- `pipeline_get_costs({task_id?, since?, group_by?})` → cost report (per task, per agent, per provider, per model).
- `pipeline_set_budget({task_id, limit_usd})` → set/update per-task budget.
- `pipeline_set_global_budget({limit_usd_per_day, limit_usd_per_month})` → global caps.

**Effort:** ~2 days.

### v2.5.4 — Cost dashboard in Web UI

New Web UI section (`/costs`):

- **Per-task cost breakdown:** waterfall chart showing each agent spawn with its cost.
- **Provider/model attribution:** pie chart — where the money goes.
- **Trend chart:** $/day, $/week over last N tasks.
- **Budget configuration:** per-task default budget, global daily/monthly caps.
- **Routing editor:** drag-and-drop matrix of [agent × tier]; preview cost estimate for a hypothetical MEDIUM task with current routing.

**Effort:** ~3-4 days.

### v2.5.5 — Local model integration (Ollama)

Special attention because local models have unique characteristics:

- Slower than cloud (no rate limits but limited by hardware).
- Free but capacity-constrained (one model at a time on consumer GPU; need queueing).
- Detection: daemon polls `localhost:11434/api/tags` on startup, auto-populates available models in Web UI.
- Fallback handling: if Ollama unreachable, fall back to `fallback_tier` (default: "cheap" → DeepSeek).

**Effort:** ~2 days. Mostly UX polish on top of v2.5.1's `OllamaSpawnProvider`.

### v2.5 total effort

**~10-13 days** focused work. Could be 2-3 Claude Code sessions.

### v2.5 acceptance

1. All 7 SpawnProvider plugins registered (`shuttle`, `claude-code-subprocess`, `anthropic-sdk`, `openrouter`, `openai-sdk`, `deepseek-sdk`, `gemini-sdk`, `ollama`).
2. Tier abstraction works end-to-end: changing `agent_tiers.style-reviewer` from "cheap" to "balanced" in Web UI causes next spawn of `style-reviewer` to use Claude Sonnet via `anthropic-sdk` provider (verified in audit log).
3. Cost tracking populates SQLite for every spawn; Web UI dashboard shows accurate per-task totals.
4. Setting `task_budget.limit_usd = 0.50` and running a task that would exceed it → driver halts at the spawn that would breach budget, surfaces error with recovery options.
5. Cost-aware downgrade works: when `spent_pct > 70%`, next spawn of a "premium" agent is automatically downgraded to "balanced" tier.
6. Ollama integration: with Ollama running locally and `qwen3-coder:32b` available, setting `agent_tiers.style-reviewer = "local"` routes that agent to local model; works offline.
7. Provider fallback: take Ollama down mid-task → next spawn requiring "local" tier falls back to `fallback_tier` and continues.
8. Cost dashboard shows ~80%+ correlation with actual provider billing (validated by cross-checking Anthropic console + DeepSeek dashboard at end of week).

### v2.5 decision gates

- After v2.5.1 (providers added): which providers does the user actually use? If only Anthropic + Ollama, defer OpenAI/Gemini work to P5 era.
- After v2.5.2 (tier routing): does the default preset hold up in practice? Re-tune based on real cost data after 2-4 weeks.
- After v2.5.5 (Ollama): is local model quality sufficient for "cheap" tier agents? If consistently producing junk findings, reroute "cheap" tier to DeepSeek cloud and demote local to opt-in only.

---

## Phase P1 — Open source + npm distribution

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

## Phase P2 — Plugin distribution + trust model

**Goal:** third-party plugins can be installed safely.

### P2.1 — Plugin discovery

- Plugin registry conventions:
  - `<project>/.claude-pipeline/plugins/*.ts` — project-local plugins (TS, runtime compiled via `tsx`)
  - `~/.claude-pipeline/plugins/*` — user-global plugins
  - npm packages with `claude-pipeline-plugin` keyword → auto-discovered if installed
- Plugin loader (`loaders/project-config.ts` becomes real, not stub):
  - Scans the three locations above
  - Validates `PLUGIN_API_VERSION` compatibility
  - Registers plugins into PluginRegistry
  - Reports clear errors for malformed plugins

### P2.2 — Plugin manifest

Each plugin must export a `manifest`:

```typescript
export const manifest: PluginManifest = {
  name: "@author/accessibility-reviewer",
  version: "1.2.0",
  api_version: "1.0",
  capabilities: [
    "spawn-agent",            // can call SpawnProvider
    "read-state",             // can call pipeline_state_get
    "write-finding",          // can emit findings via record_agent_run
    // NOT: "write-state-directly", "execute-shell", "network-egress"
  ],
  trusted_paths: ["agents/accessibility-reviewer.md"],  // only files this plugin reads
};
```

### P2.3 — Capability-based sandbox

- Plugins run with restricted MCP-tool access based on declared capabilities.
- Plugin trying to call a tool outside its declared capabilities → blocked + audit-logged.
- Reviewer plugins can't accidentally call `pipeline_finish`.
- Shell access for plugins is opt-in via `execute-shell` capability; defaults off.

### P2.4 — Plugin signing (optional, but recommended)

- Plugin manifests can be signed (sigstore / minisign).
- Project config has `trust_unsigned: false` option.
- Plugin loader refuses unsigned plugins when `trust_unsigned: false`.

**Phase P2 effort:** 2–3 weeks.

**Phase P2 success signal:** ≥3 third-party plugins exist that aren't ours.

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

## Cross-cutting concerns (apply throughout all phases)

These are not phases themselves — they're standing concerns that need investment continuously.

### Security

- Plugin sandbox (Phase P2).
- Secrets handling — agent prompts must never see env vars or .env content unless explicitly requested.
- Audit log retention + privacy controls.
- SBOM for npm package.

### Performance

- Driver should add <500ms latency per FSM step.
- Audit log writes must not block tool returns.
- Plugin loading should be cached after first invocation.

### Observability

- Structured logging (pino) replacing ad-hoc console output.
- OpenTelemetry traces — agent spawns as spans.
- Health endpoint for hosted backend.

### Compatibility

- Each major v3.x can break plugin API ONLY on intentional version bump.
- Test matrix: Node 20, 22, 24 / macOS, Linux / Claude Code stable + beta.

### Localization

- Currently English-only. Russian / Spanish / Chinese docs would unlock entire user pools.
- Agent prompts may need locale-aware variants (e.g. Russian commits in Russian repos).

---

## Order of execution (recommended)

Strict prerequisite order, but each phase is independently shippable:

```
v2 hardening (specs/hardening-v2.md) ← currently being implemented
  │
  ▼
v2.3 (daemon + Web UI + multi-provider basics)  ← week 1-3
  │
  ▼
v2.4 (Docker isolation, default for autonomous mode)  ← week 4-5
  │
  ▼
v2.5 (cost-aware multi-provider routing + cost dashboard)  ← week 6-8
  │  ↑ critical for autonomous mode economics
  │
  ▼
P1 (open source + npm + docs site)  ← week 9-12; biggest external leverage
  │
  ├──▶ P2 (plugin distribution + trust)  ← week 13-15
  │
  └──▶ P3 (team features)  ← week 16-21
         │
         ▼
       P4 (hosted tier + commercialization)  ← month 6-9
         │
         ▼
       P5 (editor integrations: VSCode/JetBrains)  ← month 10+
```

**Total horizon:**
- ~5-6 weeks to first usable autonomous mode with Web UI (v2.3).
- ~10-12 weeks to a financially sustainable autonomous tool with cost controls (v2.5).
- ~6 months to product with paying customers (P4).
- ~3 months with one collaborator working in parallel.

**Why v2.5 before P1:** going public (P1) with a tool that burns through API budget without controls = bad first impression + unhappy users. Cost-aware routing is what makes external adoption viable.

---

## Out of scope for this roadmap

- AI/ML for plugin recommendations ("you should add a Security reviewer based on diff patterns") — interesting but not core differentiation.
- Visual flow editor — niche. CLI/IDE-first audience.
- Mobile-first interface — not a fit for the user audience.

---

## Decision gates between phases

Don't progress to next phase unless prior phase signals:

| Phase | Signal to proceed | Signal to pause |
|-------|-------------------|------------------|
| P1 → P2 | ≥50 stars, ≥5 confirmed external users | <10 stars after 2 months → revisit positioning |
| P2 → P3 | ≥3 third-party plugins exist | No external interest in plugins → pivot to vertical-specific tooling |
| P3 → P4 | ≥1 team of 5+ actively using | Teams reject the workflow → simplify before scaling |
| P4 → P5 | ≥10 paying customers | <3 paying after 6 months → close hosted tier, stay OSS |

Each gate is a real decision point, not a celebration. Bail out is a valid option at every level.

---

## What this roadmap does NOT promise

- That the project should become commercial. Stay personal tooling forever is a legitimate choice.
- That timelines are accurate. They're starting estimates; multiply by 2-3x in practice.
- That competition won't catch up. Anthropic or a well-funded startup could ship something similar. The differentiators are: observability, self-improvement loop, plugin framework, audit discipline.
- That the user must follow this roadmap. It's one possible path. Skip any phase if it doesn't fit your goals.

---

## Concrete next step (when v2 ships)

Pick one of these to start P1:

1. **P1.1 — npm packaging** (3–4 days). Lowest effort, biggest UX win. Even before docs site.
2. **P1.4 — showcase repo** (1 week). Builds external evidence the tool works. Required for P1.2 to be credible.
3. **P1.2 — docs site** (1–2 weeks). Heavy effort but unlocks all downstream marketing.

Recommended start: **P1.1 + P1.4 in parallel**. Then P1.2. P1.3 (open source) happens implicitly along the way (license + README polish).

---

## Competitive analysis: ralphex (umputun/ralphex)

A Go-based autonomous executor for markdown plans with checkboxes. Different shape (subprocess-orchestrates-Claude-Code vs our native MCP integration), but several features worth porting once v2 ships. None of these require changes to the v2 spec — they all sit on top of the plugin framework.

### Features worth incorporating

#### P1.5 — `--dry-run` mode

ralphex has a `--dry-run` flag that previews what would happen without executing.

In our model: implement as `DryRunSpawnProvider` (alternative `SpawnProviderPlugin`) that logs every intended spawn + agent prompt to stdout but never invokes Claude. Driver state machine still runs through all transitions, gates auto-approve, no real agent work.

**Use cases:**
- Debug plugin behavior without burning API tokens.
- Predict what a complex task will do before committing.
- Onboarding/demos.

**Effort:** 2–3 days. Pure plugin addition, zero core changes. Slots into P1 alongside npm packaging.

#### P1.6 — Brew formula + Docker images

ralphex ships `brew install umputun/apps/ralphex`, `go install`, and Docker images (`ghcr.io/umputun/ralphex:latest`).

Equivalent for us:
- `brew install teaarte/tap/claude-pipeline`
- `ghcr.io/<org>/claude-pipeline:latest` (Node-based image with pre-built MCP)
- `ghcr.io/<org>/claude-pipeline-typescript:latest` and variants for stack-specific tooling baked in

**Effort:** 1 week. Parallel to P1.1 npm packaging.

#### P1.7 — Autonomous mode (no gates)

ralphex has zero human-in-the-loop by design. We have 3 gates by default. Add a `--auto` (or `headless` config option) that auto-approves gates after presenting their content to the audit log.

In our model: register an `AutoApprovingGateOverride` hook that satisfies `ask-user` responses programmatically. Or a new `GatePlugin` variant: `autoApproveGate0/1/2`.

**Use cases:**
- Overnight runs of long task lists.
- CI integration: run pipeline as part of automated PR validation.
- Power-user workflows trusting the planner output.

**Risk:** loses one of our quality differentiators. Should be opt-in per task, not a default. Audit log + summary email at completion mitigates.

**Effort:** 3–5 days. Plugin-only addition.

#### P2.5 — Worktree-isolated parallel pipelines

ralphex runs multiple plans in parallel via `git worktree`-isolated directories under `.ralphex/worktrees/<branch>`. We currently assume one pipeline per project.

In our model: add `pipeline_init` option `isolation: "worktree" | "in-place"` (default in-place). Worktree mode:
- Creates `.claude-pipeline/worktrees/<task_id>/` git worktree.
- All state files + agent work happens inside the worktree.
- `/done` merges back to source branch (with conflict surfacing).

**Use cases:**
- Run 3 tasks in parallel against the same repo (e.g., "refactor X", "add Y", "fix Z").
- Isolate experimental tasks that may need to be discarded.

**Effort:** 1–2 weeks. Touches initialization + cleanup paths but not core FSM.

#### P3.5 — Plan-as-markdown input flow

ralphex's primary input is a markdown plan with task checkboxes. Each `### Task N: ...` with `[ ]` runs in a fresh session, marked `[x]` on success.

Different from our flow (planner agent creates plan inside the pipeline), but legitimate alternative when the user already has a plan. Implement as a new `FlowPlugin`:

```typescript
export const executePlanFlow: FlowPlugin = {
  name: "execute-plan",
  complexity: "custom-execute-plan",
  steps: [
    "read-plan-file",       // parses markdown checkboxes
    "execute-next-task",    // spawns implementer for each unchecked
    "review-task",          // mini-review per task
    "mark-complete",        // [x] in the plan file
    "loop-or-finalize",
  ],
};
```

Routed via a new decision: `complexity == "execute-plan"` when user invokes `/task --plan path/to/plan.md`.

**Use cases:**
- Long plans drafted in advance, executed unattended.
- Reproducible task lists (e.g., "implement these 8 acceptance criteria from the spec").

**Effort:** 2 weeks. Pure plugin addition.

#### P4.5 — Real-time web dashboard with SSE

ralphex has a web dashboard that streams execution progress via Server-Sent Events. Powerful for visibility.

For us: web UI reading audit log + driver state in real time. Component of hosted tier (P4) but a local-only version could exist earlier as part of `claude-pipeline doctor` UX.

**Local version (P2 era):** `claude-pipeline watch` opens a local HTTP server on `:3000` reading `mcp-audit.jsonl` and showing live state.

**Hosted version (P4):** team-wide dashboard, multi-project view, historical metrics.

**Effort:** 1 week local, 4 weeks hosted.

#### P5.5 — External LLM provider integrations

ralphex bridges Codex, Copilot, Gemini via wrapper scripts that translate to Claude-compatible stream-json.

For us: implement as `SpawnProviderPlugin` variants:
- `OpenAISpawnProvider` — direct OpenAI Responses API
- `GeminiSpawnProvider` — Google Gemini
- `OllamaSpawnProvider` — local LLMs
- `MultiProviderSpawnProvider` — routes per-agent based on declared model preference

**Effort:** 1 week per provider after the first (the first one establishes the abstraction).

#### P2.6 — Stalemate / patience detection

ralphex has `--review-patience` that bails out of infinite review loops when agents keep disagreeing. We have iteration-counter limits but no explicit stalemate concept.

In our model: extend iterate step (`builtin/steps/iterate.ts`) with stalemate detection:
- Track whether the same blocking-finding category keeps reappearing across iterations.
- After N consecutive same-category iterations → emit `status: "ask-user"` with the loop description and recovery options.

**Effort:** 1–2 days. Pure step logic.

#### P2.7 — Config hierarchy (CLI flags > local > global > embedded)

ralphex resolves config from: CLI flags > local `.ralphex/config` > global `~/.config/ralphex/config` > embedded defaults.

We currently spread config across `~/.claude/settings.json`, scattered per-tool defaults. Standardize:

```
1. Driver invocation args (passed via pipeline_run_task)
2. Project: <project>/.claude-pipeline/config.{ts,json}
3. User global: ~/.claude-pipeline/config.{ts,json}
4. Embedded defaults in plugin code
```

`loaders/project-config.ts` (today a stub) becomes the canonical resolver.

**Effort:** 3–4 days. Plugin-only — touches the loader, not core.

### Summary table

| Inspired feature | Phase placement | Effort | Touches core? |
|------------------|------------------|--------|---------------|
| `--dry-run` mode | P1.5 | 2–3 days | No |
| Brew + Docker distribution | P1.6 | 1 week | No |
| Autonomous (no-gates) mode | P1.7 | 3–5 days | No |
| Worktree isolation | P2.5 | 1–2 weeks | Touches init |
| Plan-as-markdown input flow | P3.5 | 2 weeks | No |
| Real-time web dashboard | P4.5 (local: P2 era) | 1 wk local / 4 wk hosted | No |
| Multi-provider spawn | P5.5 | 1 week per provider | No |
| Stalemate detection | P2.6 | 1–2 days | No |
| Config hierarchy | P2.7 | 3–4 days | No |

**Architectural insight from this analysis:** the v2 plugin framework holds up. Every feature ralphex has that we'd want can be added as plugins without touching `mcp/src/driver/core/`. That's the framework working as intended.

### What we deliberately do NOT copy from ralphex

- **Full autonomy as default** — our Human Gates are a quality differentiator; opt-in `--auto` is the right balance.
- **Subprocess-Claude-Code architecture** — couples us to CLI behavior; MCP integration is cleaner and gives us the audit/invariant story.
- **Markdown-as-state** — checkbox files are human-friendly but lose typed structure; we keep JSON + schemas as canonical.
- **Per-task fresh sessions** — context degradation isn't our top problem (file-pointer mode + driver-managed state handles it).

ralphex and claude-pipeline target different audiences:
- ralphex: "I have a long plan, just execute it overnight."
- claude-pipeline: "Drive this complex task with feedback at key gates and audit afterwards."

Both valid. The `execute-plan` flow (P3.5) is the version of "ralphex inside claude-pipeline" if/when demand arises.
