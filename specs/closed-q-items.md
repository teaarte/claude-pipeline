# Closed Q-items — historical record

Validation-driven Q-items that have shipped. Read-only history. Source for cross-task analysis (which bug class recurred, which bundle landed which fix). For full prose of each fix, see the corresponding commit message — referenced below.

For ACTIVE backlog, see [`open-backlog.md`](open-backlog.md).
For pipeline phase plans, see [`phases/`](phases/).

## Summary

- **46 validation-driven Q-items closed** across 6 bundles (v2.1-hotfix, v2.1-polish-bundle, v2.2-clear-bundle, v2.2a-review-completeness, v2.2.5-bundle-foundation + followups, v2.2.6-stack-classifier).
- **10 real-task validation runs** across s3-panel + wandr-be + frontend-core — see [`../validation-log.md`](../validation-log.md) and per-task files in [`../validation/closed-tasks/`](../validation/closed-tasks/).

## v2.1-hotfix bundle (2026-05-14, pre-bundle hot-fixes)

| Q | Severity | Commit | What |
|---|---|---|---|
| Q7 | 🔴 HIGH | `4ea0c9f` | `pipeline_init` slug sanitizer — strip non-alphanumeric, lowercase, truncate; blocks `/done` if slug invalid |
| Q12 | 🟡 MEDIUM | `4e2527b` | `/done` cleanup wraps with `pipeline_unlock_writes` / `pipeline_relock_writes` (Plan A — later retired by Q23) |
| Q13 | 🟢 LOW | (subsumed by Q12) | `.mcp-bypass-allowed` orphan after `/done` — `pipeline_relock_writes` already unlinks the marker |
| Q15 | 🟡 MEDIUM | `baa253e` | `pipeline_fix_task_id` MCP tool for clean recovery when slug malformed (Q7 backstop) |
| Q16 | 🔴 CRITICAL | `98b9f45` | `subagent_type` forced to `"general-purpose"`; agent role embedded in prompt. Unblocks ALL spawns. |

## v2.1-polish-bundle (PR #1, merged `f0ede51`)

| Q | Severity | Commit | What |
|---|---|---|---|
| Q8 | 🟡 MEDIUM | (in PR) | Gate decisions mirrored from `driver-state.scratch` to `pipeline-state.gates` via `pipelineSetGate` in `pipelineContinueTask` |
| Q11 | 🟢 LOW | (in PR) | `AuditEntry.error_class` field (5 classes); `withAudit` auto-classifies thrown errors |
| Q14 | 🟢 LOW | subsumed by Q23 | `mcp-audit.jsonl` regenerates during `/done` cleanup — closed by Q23 |
| Q17 | 🟡 MEDIUM | (in PR) | Stack auto-detection via `decisions/stack-detect.ts` (package.json + pyproject + pubspec + Cargo + go.mod) |
| Q18 | 🟡 MEDIUM | (in PR) | Vocab embedded inline in spawn prompts — no more `find`-hunting for `category-vocab.json` |
| Q19 | 🟡 MEDIUM | (in PR) | `SpawnRecorder` carries `model?`; `mcpSpawnRecorder` forwards to `pipeline_begin_agent` |
| Q20 | 🟢 LOW | (in PR) | `reviewer_verdicts[].phase` field added (additive optional) |
| Q21 | 🟡 MEDIUM | (in PR) | Output-constraints bullet list on 13 reviewer/validator templates (`summary_line` ≤100, `id` regex, `summary` ≤200) |
| Q22 | 🟡 MEDIUM | (in PR) | Metrics row extraction in `tools/finish.ts` — `tests_mode`, `impl_iters`, `plan_iters`, `acceptance_first_pass` derived from authoritative sources |
| Q23 | 🟡 MEDIUM | (in PR) | `pipeline_done_cleanup` MCP tool (21st, registered via new `registerNoAudit` path). Replaces Q12 Plan A. Closes Q14. |
| Q24 | 🟡 MEDIUM | `3afcb36` | Stop hook silent when `pending_user_answer` set (gate awaiting human input) |
| Q36 | 🟢 LOW | `d6f7438` | Stop hook positive message after Gate 2 accept (vs scary "in flight") |

## v2.2-clear-bundle (PR #2, merged `b994710`)

| Q | Severity | Commit | What |
|---|---|---|---|
| Q10 | 🟢 LOW | `bc02842` | `pipeline-state.current_step` field removed from schema (legacy v1 leftover) |
| Q25 | 🟢 LOW | `58d82cc` | Onboarding docs note: pre-approve `Write(.claude/**)` in `settings.local.json` |
| Q26 | 🟡 MEDIUM | `30c6def` | Stack-detect honors CLAUDE.md "Validation Commands" priority over `package.json` scripts; `monorepo` enum addition |
| Q28 | 🟢 LOW | `6f1b9d0` | `findings[].schema_version` rule added to Q21 output-constraints bullet list |
| Q29 | 🟢 LOW | `f087078` | `logic-reviewer` vocab expanded with `spec-deviation`, `scope-creep`, `coverage-gap` |
| Q31 | 🟡 MEDIUM | `ff13230` | `phases.X.iterations` legacy field removed; derive from `reviewer_verdicts[].iteration` |
| Q32 | 🟢 LOW | `f77f215` | `phases.validation.acceptance_first_pass` legacy field removed (Q22 derives directly) |
| Q33 | 🟡 MEDIUM | `4dc4ca2` | `state.files.created/modified` populated from `git diff --name-status` on implementation close |
| Q34 | 🟢 LOW | `1d33922` | `phases.planning.grounding_check` legacy field removed |
| Q37 | 🟡 MEDIUM | `4e5ef6d` | `extractMetricsRow` copies `state.stack` into metrics row (Q22 family extension) |

## v2.2a-review-completeness (PR #3, merged `bf39b09`)

| Q | Severity | Commit | What |
|---|---|---|---|
| Q9 | 🟡 MEDIUM | `f806977` | **5th recurrence root-caused + fixed.** PRE_REVIEW step invokes `security-needed`/`ui-touched`/`api-touched` decisions; REVIEW step fan-outs to 5 reviewers via `spawnAgentsParallel` for non-simple flows |
| Q27 | 🟡 MEDIUM | `da3952d` | Pre-review infrastructure hooks wired: emit `diff.txt`, `caller-context.md`, `antipattern-candidates.md`, `past-misses-*.md` |
| Q30 | 🟡 MEDIUM | `82cf886` | `driver-state.decisions.refs_to_load` persists to `pipeline-state.refs_loaded` at planning-phase close |
| Q41 | 🟡 MEDIUM | `a810dbe` | **Partial.** Refs become self-describing (25 ref files with YAML frontmatter); `DecisionPlugin.decide(state, ctx?)` contract evolved to async; `SpawnProviderPlugin.query?()` interface-only. LLM path inactive in prod (shuttle leaves query undefined); regex fallback live. Full activation pending v2.3 daemon's non-shuttle SpawnProvider. |
| Q42 | 🟡 MEDIUM | `39ff1a9` | `task_id` slug collision fix: hash-suffix `-[a-f0-9]{4}` when generated id matches recent metric row |
| Q43 | 🟢 LOW | `cda5046` | `impl_iters` / `plan_iters` derive by `count(verdicts WHERE phase=X)` instead of `max(iteration)` |

## v2.2.5-bundle-foundation (PR #4, merged `e3eb3d6`)

| Q | Severity | Commit | What |
|---|---|---|---|
| Q40 | architectural | (item 4 of v2.2.5) | **Bundle abstraction is first-class.** `BundleManifest` contract in `mcp/src/driver/types/bundle.ts`; `loadBundle(name, registry)` / `loadBundles([...], registry)` in `mcp/src/driver/loaders/bundles.ts`. Code-bundle manifest at `bundles/code/bundle.ts` enumerates all 20 agents / 23 steps / 3 flows / 3 gates / 4 hooks / 6 decisions / 1 spawn-provider. Manifest/index drift surfaces at load time. Cleanup commit (12f95b1) removed the loaders/builtins.ts shim; loadBundle is the only entry point. Closes the "stays deferred until trigger" status — virtual-teams-for-any-niche is no longer post-hoc retrofit. |
| Q57 | 🟡 MEDIUM | (item 8 of v2.2.5) | **Structured gate-answer protocol.** Free-text English-keyword regex at `gates/index.ts:7-17` (which silently treated Russian "да" as `changes_requested` in frontend-core 2026-05-17) replaced with binary `UserAnswer = {decision: "accept"\|"reject", message?: string}`. `pipeline_continue_task input` accepts the structured shape directly; no legacy adapter (solo-user, no migration). `parseDecision` is now a 5-line ternary, zero regex. Skill markdown documents the CLI parser (1/a/accept, 2/r/reject [msg]). Category 2 fix per architectural principle (restructure to eliminate classification). |
| Q47 | 🟢 LOW | (item 11 of v2.2.5) | **`gate1_revisions: 0` root-caused.** `pipelineSetGate` now persists the counter onto `phases.planning.gate1_revisions` directly when status=rejected (was previously incrementing a driver-state-scratch field that never crossed back to pipeline-state). Same fix added the symmetric `phases.implementation.gate2_revisions`. |
| Q48 | 🟡 MEDIUM | (item 11 of v2.2.5) | **Metric row observability gap.** `extractMetricsRow` now emits `force_used`, `pipeline_violation`, `started_at`, `ended_at`, `gate2_revisions`, `reviewer_count`. `pipeline_finish` stamps `state.ended_at` on first call so re-finish is idempotent. Schema bumps include the new field. |
| Q50 | 🟢 LOW | (item 10 of v2.2.5) | **`stack.test_command` trailing comment.** `parseClaudeMd` now strips `# trailing comment` after backtick/quote-strip. `test_command: "pnpm -r test  # vitest run"` collapses to `"pnpm -r test"`. |
| Q51 | 🟡 MEDIUM | (item 10 of v2.2.5) | **Multi-signal pnpm detection.** `detectNodePackageManager` now also checks `pnpm-workspace.yaml` AND `package.json.packageManager` field (e.g. `"pnpm@9.4.0"`), so projects without a lockfile-at-init-time still resolve to pnpm. |
| Q55 | 🟢 LOW | (item 10 of v2.2.5) | **`pipeline-state-summary.md` refresh on `pipeline_finish`.** Finish now rewrites the summary with the final verdict (previously stayed stale at the last set-phase snapshot). |
| Q60 | 🟢 LOW | (item 10 of v2.2.5) | **`BUILTIN_HOOKS` ordering invariant documented.** Comment-block above the export pins `git-diff-snapshot` first; consumers of `diff.txt` (`anti-pattern-grep`, `caller-context-expand`) annotated. Test asserts the ordering. |
| Q41 / Q44 / Q45 / Q46 / Q58 / Q59 / Q61 | 🟡 MEDIUM | (item 9 of v2.2.5) | **LLM-classification cluster — substrate landed.** New `pickFromCandidates` primitive (`mcp/src/lib/pick-from-candidates.ts`) abstracts the LLM-classification pattern (defensive parse, hallucination filter, cap). Classifier-agent template (`agents/classifier.md`) emits structured JSON validated against `classifier-output.schema.json`. Decisions `refs-to-load` + `security-needed` collapsed to pure getters reading from `state.decisions`. Anti-pattern-grep hook reads from `state.decisions.antipattern_rules_applicable` (no keyword overlap heuristic). New `<!-- antipattern -->` marker convention supported in CLAUDE.md (with English-header fallback). **Auto-spawning of classifier inside CLASSIFY step deferred to v2.2.6** — current shuttle pattern requires test rework on a scale that wasn't worth fitting in this bundle. Pure-getter decisions work today via explicit state setup; daemon `query()` will activate end-to-end when v2.3 lands. Closes Q41/Q44/Q45/Q46/Q58/Q59/Q61 substrate; Q59 marker convention fully shipped. |

## v2.2.6-stack-classifier (PR #5, merged `e16f64c`)

| Q | Severity | Commit | What |
|---|---|---|---|
| Q63 | 🟡 MEDIUM | `38f35a8` (C7) | **Auto-close validation + final on clean success.** `record_agent_run` auto-closes `validation` when an `acceptance: PASS` reviewer-record lands with `open_spawns=0` (audit `auto-close-validation`). `pipeline_finish` auto-closes `final` when `verdict=accepted` AND `force` is falsy AND all prior phases are in `{completed, skipped}` AND `phases.final.status=pending` (audit `auto-close-final`). Genuine Q54 recovery path (`pipeline_set_phase_status final completed force=true`) still records `pipeline_violation: "phase-force-final"` — the auto-close only fires when no force was requested. Strict guard: only the exact string `"PASS"` triggers (risk-register: malformed verdicts that string-equal `"pass"`/`"PASSED"` are NOT auto-close-eligible). |
| Q64 | 🟡 MEDIUM | `8398764` (C8) | **Cross-session ownership safety.** New `state.owner_id: string \| null` field populated from generic env-var chain (`CLAUDE_PIPELINE_OWNER_ID` → `CLAUDE_SESSION_ID` → `SESSION_ID`) at `pipeline_run_task`. `lib/owner.ts` exposes `currentOwnerId()` + `ownerCheck()` + the `OWNER_MISMATCH` error code and `cross-owner-finalize` violation tag. `pipeline_finish` and `pipeline_abandon` refuse cross-owner calls unless `force_cross_owner: true` is passed; on force, `pipeline_violation` is stamped (preserved into the metric row). `hooks/pipeline-stop.sh` reads `session_id` from CC's payload and compares to `state.owner_id`: mismatch → INFO line to stderr + clean exit (does NOT block + does NOT suggest /done — running it from the non-owner window would clobber the owner's state). The only place referencing Claude Code's session_id directly is the Stop hook (it's a CC plugin event); the MCP server treats `owner_id` as an opaque string. Future transports (v2.3 daemon HTTP, CLI) set their own owner via env var. |
| (architecture) | n/a | `db6c754` (C1) | **Stack-detect reclassified Category 1 → Category 3 in `product-vision.md`.** Audit obligation added: future Category 1 entries that regex over human-authored text should be re-audited. `far-future.md` gains a P-K (Knowledge-as-data) sketch — long-term direction for moving refs / candidate lists / rules / agent templates from filesystem artifacts to a queryable knowledge store. |
| (architecture) | n/a | `1fbbeaf` (C2) + `ec41eb0` (C3) | **`stack-detect.ts` rewritten as candidate-driven.** New `templates/stack-candidates.yaml` is the single source of truth for languages / package managers / default commands / project-type heuristics. `mcp/src/lib/stack-candidates.ts` loads it with Zod validation + cross-reference checks. `stack-detect.ts` becomes two pure-ish functions: `gatherStackSignals(projectDir)` + `resolveStack(signals, candidates)`. Zero per-language conditional branches in TS. Adding a new ecosystem (C# / Svelte / Elixir / Dart / Crystal / Zig / Gleam / …) is now a YAML edit. 8 new ecosystems exercised by test fixtures. |
| (architecture) | n/a | `d5b8644` (C4) | **`classifier-output.schema.json` extended with `stack` + `change_kind`.** Schema-only substrate for v2.2.7 Item 1 (classifier auto-spawn) + Item 2 (reviewer selectivity by change_kind). `schema_version` widened to `["1.0", "1.1"]` so 1.0 outputs continue to parse. `agents/classifier.md` prompt documents how to pick stack from the candidate registry + the `change_kind` heuristics (`type-only` / `logic` / `ui` / `perf-sensitive` / `security-sensitive` / `config-only` / `docs-only`). |
| (architecture) | n/a | `f7d3eb6` (C5) | **`<!-- validation-commands -->` marker convention.** Parallel to the v2.2.5 `<!-- antipattern -->` marker — language-agnostic, parsed first, English-header fallback retained for deprecated authoring. `mcp/README.md` gains an "Authoring CLAUDE.md" section documenting both marker conventions as canonical. |
| (Item 6, no Q-number) | 🟡 MEDIUM | `52abb3f` (C6) | **Canonical `task_id` propagation.** Shuttle-provider's `buildPrompt` injects a `## Canonical identifiers` section BEFORE the role template, listing `task_id` + `driver_state_id` from `state`. 13 reviewer/validator templates gain the constraint under Output constraints (do NOT extract task_id from task description prose). `record_agent_run` adds a defensive runtime check: when `header.task_id` or any `finding.task_id` differs from `state.task_id`, rewrite to canonical + audit under `error_class: "task_id-rewrite"` with both values logged. Prerequisite for v2.2.7 Item 1 (classifier auto-spawn). |

## Patterns / lessons

**Recurrence value:** Q9 recurred 5× before root cause was concrete enough to fix. Validation discipline (capture every observation, even repeats) was load-bearing — without it the wiring bug would have stayed "hypothesis space" longer.

**Q-family clustering:** several items share an architectural root:
- **State hygiene cluster** (Q10/Q31/Q32/Q33/Q34) — v1-era legacy fields not maintained by v2 driver. Bundled in v2.2-clear-bundle as schema deprecations.
- **Metrics extraction cluster** (Q22/Q37/Q43) — `tools/finish.ts` derivation logic. Each iteration added one more field to thread through correctly.
- **Stop hook cluster** (Q24/Q36) — `hooks/pipeline-stop.sh` tri-state awareness (in-flight / gate-paused / accept-pending).
- **Refs cluster** (Q18/Q30/Q41) — refs-to-load decision evolution: inline vocab → persistence → LLM-driven (partial).

**Most valuable single fix:** Q23 (`pipeline_done_cleanup` MCP tool). It replaced a multi-step bash-rm dance that contradicted the guard hook's design, and subsumed Q14 (audit regen) for free. One commit → cleaner architecture + closed two open Q-items.
