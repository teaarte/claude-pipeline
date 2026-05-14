## t-2026-05-13-gateway-ui-gateway-orval-tanstaack-query — Phase 0.5 gateway scaffolding

> **✓ Bugs from this run resolved 2026-05-14 by v2.1-hotfix bundle:**
> Q7 (`4ea0c9f`), Q12 (`4e2527b`), Q15 (`baa253e`). Q13 subsumed by Q12.
> Remaining unfixed: Q8 (gate mirror), Q9 (review under-spawning), Q10 (current_step stale), Q11 (audit error_class), Q14 (audit regen) — bundled into v2.1 polish round.

- **Project:** `~/Work/AI-FACTORY/s3-panel`
- **Complexity (auto):** medium ✓
- **tests_mode (auto):** regression-only ✓ (frontend project, correct)
- **Wall time:** ~3 hours
- **Agents count:** 8 (context: 2, planning: 3, implementation: 2, validation: 1)
- **Verdict:** paused at Gate 2 (not yet closed — waiting for analysis)
- **Subjective rating:** 7/10 (first real run; system reached Gate 2 successfully but multiple v2 bugs surfaced)

### What worked
- Pipeline auto-classified complexity correctly (medium for gateway+orval+tanstack work).
- `tests_mode: regression-only` auto-detected for frontend repo — correct.
- 5 reviewer verdicts recorded (context-doc-verifier `VERIFIED`, plan-grounding-check `PASS_WITH_WARNINGS`, logic-reviewer × 2 `REQUEST_CHANGES`, acceptance `PASS`).
- Plan-revision loop triggered when user asked for clarification — 2nd logic-reviewer iteration ran.
- Atomic spawn-record contract worked — `open_spawns[]` empty in every phase, 8 agents cleanly accounted.
- 29 structured findings collected (5 blocking + 7 warn + 17 info).
- Audit log captured 21 MCP calls (~92K total, well under cap).
- Driver correctly paused at `gate-2` after impl + reviews + validation.

### Gate interaction (real conversation, not log)
- **Gate 0:** approved as-is (auto for SIMPLE; for MEDIUM was confirmed quickly).
- **Gate 1:** **rejected initial plan, asked for clarification + revision; pipeline re-ran planner; eventually accepted revised plan.** This caused 2× logic-reviewer iterations on the plan (correct behavior). May have contributed to under-spawning in code review phase (see bug #3 below).
- **Gate 2:** **pending — user noticed bugs in state before closing.**

### Bugs found

1. **🔴 HIGH — Q7: `pipeline_init` slug sanitization broken.**
   `task_id` came out as `t-2026-05-13-gateway-ui-gateway-orval-tanstaack-query` — contains hyphens (schema expects `[a-z0-9]{4,}` alphanumeric-only after date) AND has typo "tanstaack" instead of "tanstack". `pipeline_validate` already catches this as `INV_SCHEMA_STATE`. Will block `pipeline_finish` at `/done`. Fix: `mcp/src/tools/init.ts` slugifier must replace hyphens/underscores with empty string, lowercase, strip non-alphanumeric.

2. **🟡 MEDIUM — Q8: Gate decisions stored in driver scratch but not mirrored to `pipeline-state.gates` via `pipeline_set_gate`.**
   `driver-state.json:scratch` has `gate-0_decision` and `gate-1_decision` keys. But `pipeline-state.json:gates` shows all three gates as `"pending"`. Driver records the user's gate answer locally in scratch but never propagates to canonical state. Consequences: metrics row at `/done` shows `gate1_revisions: 0` (even though plan was actually revised), `INV_005`/`INV_006` never fire for these tasks (because gates never reach `"approved"`), observability lost. Fix: gate steps (`builtin/steps/index.ts`) must call `pipelineSetGate` after capturing the user answer.

3. **🟡 MEDIUM — Q9: Code review under-spawned.**
   `MEDIUM` flow per spec should spawn 5 parallel reviewers (logic + challenger + style + security + performance). In this run, implementation phase has only **2 agents** (implementer + logic-reviewer). `__spawn_issued_review` is in scratch — review step ran — but only spawned one reviewer. Two hypotheses:
   - `applies_to` predicates for challenger / style / security / performance returned false. `security_needed` could plausibly be false (no auth-related diff for gateway scaffolding), but challenger and style should always run on MEDIUM.
   - Review step has a code bug — calls `spawnOne` instead of `spawnAgentsParallel`. Need to inspect `mcp/src/driver/builtin/steps/index.ts` review step impl.
   - **Possible interaction with the Gate 1 revision loop**: did the revised plan reset `decisions.security_needed`? If so, that's a third hypothesis.
   Effect: code review coverage was reduced to logic-reviewer alone for this task. Real quality risk.

4. **🟢 LOW — Q10: `current_step` field in `pipeline-state.json` stays stale.**
   Shows `"STEP 1"` while phases context/planning/implementation are `completed` and validation is `in_progress`. The v2 driver updates FSM state in `driver-state.json:step_index` and leaves `pipeline-state.json:current_step` untouched. Either the v2 driver should update it, or the field is obsolete and should be removed from the schema.

6. **🟡 MEDIUM — Q17: `pipeline-state.json:stack` fields never populated.**
   Inspection of `pipeline-state.json` post-run shows:
   ```json
   "stack": {
     "language": "unknown",
     "package_manager": null,
     "test_command": null,
     "lint_command": null,
     "build_command": null,
     "project_type": null
   }
   ```
   Despite the s3-panel project having clear stack indicators (CLAUDE.md "Stack" section: React 19 + TypeScript 5.7 + pnpm + Vitest + Rsbuild; package.json with `pnpm` workspaces; etc.). `pipeline_init` accepts a `stack` parameter (per `smoke.ts` fixture), but the v2 driver entry doesn't compute it pre-flight. Agents receive all-null `project_stack` context → reference loading degraded; metrics row in `pipeline.jsonl` carries useless stack info for cross-stack `/learn` analysis. **Effort ~2-4h** — add stack-detection helper + wire into driver's pre-flight before `pipeline_init`. **See roadmap Q17.**

5. **🟢 LOW — Q11: 10/21 `pipeline_continue_task` calls returned `verdict: "error"`.**
   Half of continue-task calls errored; last call succeeded so pipeline recovered. Likely combination of (a) JSON-parse retries via soft parser, (b) `closePriorPhases` swallowed `INV_002/010/011` during phase boundary crossings, (c) `INV_011` prereq check fires when step tries to begin agent before prior phase recorded as `completed`. Audit log has the errors:
   ```bash
   jq 'select(.verdict == "error") | {ts, tool, error}' .claude/mcp-audit.jsonl
   ```
   Investigate categorically: are they all known-safe swallows, or are some real signal?

### Friction / UX notes
- Plan revision at Gate 1 worked but: the second plan came back without clear indication of what changed vs first. Would be useful to see a "diff against previous plan" at Gate 1 on re-presentation.
- Gate 2 message says "Accept (verdict=accepted) or reject (verdict=rejected) with feedback" — no summary of what was actually done. User has to read findings + diff separately to decide. Should include 1-paragraph summary of completed work inline.
- No way to see live progress while pipeline runs (SSE live stream is v2.3 Web UI work). Currently feels like a black box for the ~3 hours.

### Objective signals from logs
- `plan_iters`: 2 (one revision after Gate 1 rejection — correct)
- `impl_iters`: 1
- `reviewer_disagreements`: 0
- `acceptance_first_pass`: yes (acceptance ran after impl and passed first try)
- `agents_count by complexity`: 8 actual vs ~10-13 expected for MEDIUM (under-spawned, see Q9)
- Output size outliers: not measured in this run
- `_repaired` count: not measured (would require jq on audit args_summary)
- `force_used` count: 0 (no force_bypass in this run)

### Cost signal
- Used Claude Code subscription (no per-token tracking yet — v2.5).
- Subjective: felt expensive given ~3h wall time. Will measure properly when v2.5 lands.

### Notes
- This is the FIRST real-task run of v2 framework. Bug count is expected to be high — that's the point of validation phase.
- All bugs found here are **post-shipping** discoveries, not pre-shipping misses. v2 acceptance criteria all passed; these are corner cases real-use surfaces.
- The Gate-1 revision flow worked semantically but observability got lost (Q8). User had to ask "did the pipeline actually record that I revised?" — answer was "no, only in scratch".
- Need a clear `/task` UX for "I want to discard this run and start over without losing pipeline state for analysis" — would have been useful when bugs surfaced.

**Action items next:**
- Add Q7-Q11 to roadmap `v2.1 code-polish round` (doing now in same commit).
- Close this task: recover via `pipeline_unlock_writes` + manual `task_id` fix, then `/done`. Or `pipeline_abandon` if not worth saving the state. Decide based on whether you want this run's metrics row in `pipeline.jsonl` (yes for analysis later, no if the metrics row is itself corrupt-shaped).
- Run 2-4 more real tasks in next 1-2 weeks before deciding on v2.1 fix priorities.

### `/done` execution observations (added retrospectively after running /done)

Recovery path was actually taken: `pipeline_finish` failed on task_id as predicted (Q7 confirmed). Agent applied Recovery B (force-close after manual fix). Worked end-to-end, but surfaced **3 new UX bugs** in the `/done` flow itself:

- **Final task_id:** `t-2026-05-13-gwarchspec` (manually written via Python edit; 10-char alphanumeric slug, schema-valid). Metrics row appended successfully.
- **Final verdict:** `accepted`.

#### Q7+ (extension of existing Q7) — Manual task_id fix has no clean recovery primitive

The recovery required this 4-step dance:
1. `mcp__claude-pipeline__pipeline_unlock_writes({ttl_seconds: 300, reason: "fix corrupt task_id"})`
2. `python3 -c "..."` to load JSON, mutate `task_id`, write back
3. `mcp__claude-pipeline__pipeline_relock_writes`
4. Re-call `pipeline_finish`

This works but is hostile UX. Q7's main fix (proper slugifier in `pipeline_init`) prevents the bug. The **additional** recommendation: provide `pipeline_fix_task_id({project_dir, new_task_id, reason})` as a clean recovery MCP tool. Auto-validates new id against schema, audits the change, no python hack needed.

#### Q12 🟡 MEDIUM — `/done` cleanup blocked by guard hook (chicken-and-egg)

`/done` skill ran `rm -f .claude/pipeline-state.json .claude/findings.jsonl ...` — **the guard hook correctly blocked it** because those paths are MCP-managed. Error message says `"/done re-locks automatically"` but the recovery was manual:
- Agent called `pipeline_unlock_writes` first
- Then ran `rm` (succeeded)
- `pipeline_relock_writes` did NOT auto-delete the `.mcp-bypass-allowed` marker → orphan (see Q13)

**Root cause:** `commands/done.md` skill markdown describes a `rm`-based cleanup. But the guard added in v2 doesn't let `rm` touch protected files. The skill needs updating to call `pipeline_unlock_writes` before the `rm` block, or — cleaner — to use a new `pipeline_done_cleanup({project_dir})` MCP tool that does the deletion server-side without guard interaction.

**Effort:** ~1h. Fix `commands/done.md` skill markdown, OR (preferred) add `pipeline_done_cleanup` MCP tool.

#### Q13 🟢 LOW — `.mcp-bypass-allowed` orphan after /done

Agent ran first `rm` batch → all files gone except `.mcp-bypass-allowed`. Required a separate `rm -f .claude/.mcp-bypass-allowed`. **Root cause:** `/done` cleanup list in `commands/done.md` doesn't include this marker filename. **Or:** the unlock that happened during cleanup re-created it. Easy fix: add `.mcp-bypass-allowed` to the cleanup list. Better fix: `pipeline_relock_writes` should auto-delete the marker (verify it does — Q12 implementation may make this moot).

**Effort:** ~10min. Update `commands/done.md` cleanup file list, or fix `pipeline_relock_writes` to delete the marker.

#### Q14 🟢 LOW — `mcp-audit.jsonl` regenerates during cleanup (267-byte stub orphan)

After `/done` cleanup, `.claude/` contained only `settings.local.json` AND a fresh 267-byte `mcp-audit.jsonl`. This stub got created by the cleanup process itself — every MCP call (unlock, relock, finish) appends to the project-local audit. So cleaning `mcp-audit.jsonl` early in the cleanup just gets it re-created by subsequent cleanup-process MCP calls.

**Root cause:** Loop ordering. Either: (a) delete `mcp-audit.jsonl` LAST after all other MCP calls done, (b) have `/done` route its own audit entries to global stream only (with a `tool: "done:cleanup"` marker), (c) have `pipeline_done_cleanup` (proposed in Q12) do the file deletion inside one MCP call that doesn't re-emit audit until after the deletion.

**Effort:** ~30min. Tied to Q12 — same fix probably resolves both.

### Cumulative bug count from this single task

Initial findings: 5 (Q7-Q11).
Post-/done findings: +3 (Q12-Q14) plus Q7 extension.

**Total: 8 distinct v2 bugs surfaced from one real task run.**

This is high — but expected for a first real-task validation. The pattern is healthy:
- Q7 is the only blocker that hurts every task (schema-violation task_id → can't finish without recovery).
- Q8, Q9 are quality-of-output bugs (gates lost in metrics, review under-spawned).
- Q10-Q14 are friction / UX bugs that don't break correctness but hurt the experience.

Priority signal: **fix Q7 first** (single point of failure for /done). The rest can wait for bundled v2.1 polish round.
