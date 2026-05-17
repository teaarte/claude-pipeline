# Session handoff — claude-pipeline state of affairs (2026-05-15)

> **Purpose:** disposable doc capturing conversational nuance that wouldn't survive otherwise. Use when starting a fresh Claude Code session to bootstrap context quickly. **Delete or archive** once v2.2.5 starts (no longer needed once next big work begins).

## What just happened (summary of 2026-05-13 → 2026-05-15)

Three-day intensive session shipped:
- **v2.0** (`95f3f90`) — TypeScript plugin framework rewrite (started May 13)
- **v2.1** (PR #1, `f0ede51`) — 11 validation-driven fixes from 3 real-task runs on s3-panel
- **v2.2** (PR #2, `b994710`) — schema hygiene + polish (10 Q-items)
- **v2.2a** (PR #3, `bf39b09`) — review surface unlocked (Q9/Q27/Q30/Q41 partial/Q42/Q43)
- Documentation full reorganization: `specs/done/`, `validation/closed-tasks/`, `specs/phases/`, `specs/open-backlog.md`, `specs/closed-q-items.md`, `specs/product-vision.md`, `specs/ui-vision.md`
- v2.2.5 phase plan + launcher prompt prepared (`specs/v2.2.5-bundle-foundation.prompt.md`)
- **wandr-be production verification** (2026-05-14) — FIRST non-frontend, non-English, full-fan-out real-task run. Confirmed Q9/Q27/Q26/Q22/Q43 work end-to-end. Surfaced Q44-Q47.
- Architectural principle "code + LLM hybrid for classification" formalized in product-vision.md

Tags: v2.0, v2.1, v2.2, v2.2a all set on GitHub.

## Where things stand RIGHT NOW (start of next session)

**Pipeline state:** production-ready for backend code-domain tasks. v2.2a review fan-out verified delivering 4-5 reviewers in implementation on real production codebase. wandr-be confirmed generalizability to non-frontend non-English stacks.

**Backlog:**
- Q41 partial (LLM path inactive until v2.3 daemon's non-shuttle SpawnProvider)
- Q44, Q45, Q46 (all LLM-blocked, share Q41's activation)
- Q47 (LOW — `gate1_revisions:0` anomaly, investigate next reproduction)
- Q38 deferred (v2.3 Web UI solves it natively)
- Q40 scheduled for v2.2.5 (was deferred, promoted 2026-05-14)
- Q1-Q6 code-polish (separate rainy-day bundle, no urgency)

**Next decision point:** start v2.2.5 work OR do another second-project run OR pause. Launcher prompt ready in `specs/v2.2.5-bundle-foundation.prompt.md`.

## Conversational gold (not captured elsewhere)

### Calibrated business probability assessment

User asked: "насколько это будет хороший продукт и какая вероятность что на нем можно будет зарабатывать/построить бизнес?"

**Honest numerical estimates (mine, calibrated against AI-tooling solo OSS base rates):**

| Outcome | Probability | Notes |
|---|:---:|---|
| Ships + 50-200 users + buzz | ~40% | Most likely. Side income / OSS contribution. |
| Stuck after v2.3-2.6, no clear PMF | ~30% | Architecture good, distribution doesn't click. |
| $5-30K/mo MRR sustainable side business | ~20% | Lucky outcome. Part-time continues. |
| $50K+/mo MRR real business | ~8% | Optimistic. Quit day job. |
| Category-defining product | ~2% | Long-tail. Acquihire / small company. |

**Compound: ~30% probability of meaningful commercial outcome** ($5K+/mo MRR or better). That's ~100× base rate but NOT default outcome.

**Six key dependencies that determine outcome:**
1. **Distribution skill** — biggest risk, not yet demonstrated. Architecture won't sell itself.
2. **Burnout** — current pace unsustainable; ships+abandons is real failure mode.
3. **External alpha users by Phase 2** — without them, no PMF measurement.
4. **Validation generalizability** — wandr-be helped; one more non-TS run would seal it.
5. **LLM economics** — multi-provider routing isn't optional; commercial prerequisite.
6. **Focus on code domain** — don't premature-pivot to TikTok/marketing/research.

**Alternative success modes** (not just "build a business"):
- Self-useful tool (already achieved — saves hours/week)
- Portfolio / recruitment signal ($50-200K salary jump from FAANG/scale-up interest)
- Open-source impact (500-2000 stars, reputation)
- Acqui-hire ($200K-1M depending on signal quality)

Probability of **at least one** meaningful outcome: **60-75%**, significantly higher than commercial-only.

### Architectural principle that crystallized

**User pushed back on my code-only fixes for Q44/Q45/Q46** (proposed multilingual regex, transliteration libs, pattern extraction). The pushback was the most strategically valuable insight of the session:

> **"Pure code for deterministic problems. Code + LLM for classification / picking / matching / interpretation."**
>
> Where the problem requires understanding semantic content, patches like multilingual regex / transliteration / pattern extractors attempt to "code around" what is fundamentally an LLM job. Right architecture: code provides input parameters + candidate list; LLM picks; output constrained.

This is now formalized in `specs/product-vision.md` "Architectural principle: code + LLM hybrid for classification" section. Applies to ALL future decisions/predicates/hooks where classification is needed. Sites where this lives or will live:
- ✅ Q41 (refs-to-load) — done by design
- 🔒 Q44 (anti-pattern detection) — LLM-blocked on Q41 activation
- 🔒 Q45 (multilingual refs — same as Q41)
- 🔒 Q46 (slug synthesis for non-Latin)
- Future: `applies_to` predicates, complexity classification, past-misses ranking, v2.6 curator dispatch

**NOT for:** schema validation, FSM transitions, audit log, plugin registration — these stay deterministic code.

### Pacing/burnout observations

User has been on 6-8 day intensive coding streaks. Pattern:
- Marathon mode → code volume + bug discovery
- Fresh-head mode → strategic insights (the architectural principle emerged from fresh thinking, not exhaustion)

**Honest recommendation given:** after each milestone (v2.x merge), pause is more productive than continuing. v2.2.5 is significant work (~6-8h focused agent session) — deserves rested mind.

### Validation discipline pattern (worth preserving)

The user established a discipline that's UNUSUAL for solo OSS projects:
- Every real-task run → per-task entry in `validation/closed-tasks/`
- Every observation (even non-bugs) → captured as cross-cutting observation or Q-item
- Q-items have severity (🔴/🟡/🟢), root cause, effort estimate, file location, first-seen task_id
- Recurrence tracking — same Q recurring = signal, not noise (Q9 recurred 5× before root cause clear)
- "Don't fix immediately, file as Q-item for bundled polish round" — discipline against context-fragmentation

This discipline is **load-bearing** — Q9 was diagnosed via this exact pattern (5 recurrences with state inspection → wiring bug identified concrete-ly).

### User preferences I learned

- **Calibrated honest assessments** preferred over enthusiasm. Will pushback if I'm being sycophantic OR sandbagging.
- **Numerical estimates with caveats** > vague qualitative claims.
- **Architectural correctness** > shipping-velocity hacks. Will accept slower phase if substrate work pays compounding dividends.
- **Multi-domain vision** is genuine end-goal, not throwaway. Code is first bundle, not only bundle.
- **Russian-language work** — task descriptions sometimes in Russian. Discussion conversational in Russian; commits/specs/code in English (per repo policy).

## Open decisions awaiting next session

1. **When to start v2.2.5?**
   - Option A: After 1-2 more second-project runs (Python? Rust? library?) — ~2-4h extra signal
   - Option B: Right now — substrate work doesn't need more code-domain validation
   - **My recommendation:** A, but ONLY if energy is high. Otherwise: pause, then B with fresh head.

2. **v2.2.5 launcher tweaks before execution?**
   - Phase plan + launcher are detailed but could benefit from one final review pass with fresh eyes
   - Particularly item 6 (MCPClientPlugin) — complex new contract, worth re-checking before execution

3. **Real-task verification on s3-panel after v2.2.5 merges?**
   - Test legacy behavior (no `pipeline.config.json`) → should work identically to v2.2a
   - Test explicit config (`{"bundle": "code"}`) → same behavior, different code path
   - Schema validation old vs new

## Quick start for new session

If you're starting a fresh Claude Code session and want to continue this work, **read in this order:**

1. **`README.md`** (~5min) — overview + install + docs index + tags
2. **`specs/v3-productization-roadmap.md`** (~5min) — phase index, where we are post-v2.2a
3. **`specs/open-backlog.md`** (~3min) — currently open Q-items + scheduled v2.2.5 + deferred
4. **This file (SESSION-HANDOFF.md)** (~5min) — conversational gold + open decisions
5. **`validation/closed-tasks/2026-05-14-wandr-be-techdebt-sweep.md`** (~10min) — most recent + most valuable validation entry
6. **`specs/phases/v2.2.5-bundle-foundation.md`** (~10min) — next phase plan if continuing forward
7. *(Optional, if going deeper)* `specs/product-vision.md` "Architectural principle" + "Domain boundary" sections (~10min)

**Total bootstrap: ~30-45 minutes** to be fully oriented to where things stand.

### Pastable bootstrap prompt for fresh Claude Code session

Open a new Claude Code session in `/Users/teaarte/Programming/internal/claude-pipeline/`, paste the block below as the first message. It instructs the agent to load context + auto-memory + stand by for next analysis or work.

```
You are picking up the claude-pipeline project where the previous session left off.

Repository: /Users/teaarte/Programming/internal/claude-pipeline/

Auto-memory for this project is at ~/.claude/projects/-Users-teaarte-Programming-internal-claude-pipeline/memory/ — read the MEMORY.md index, then read every linked memory file. These capture user preferences (calibrated honesty, code+LLM hybrid principle, validation-first discipline), current project state (post v2.2a, v2.2.5 launcher ready), and business assessment numbers (~20-30% commercial probability).

Then read the following repo files in this order to bootstrap context:

1. SESSION-HANDOFF.md (root) — conversational gold from the previous session + open decisions + business probability numbers + architectural principles formalized.
2. README.md — overview, install, tags (v2.0/v2.1/v2.2/v2.2a), docs index.
3. specs/v3-productization-roadmap.md — phase index. Note v2.2.5 is next phase (was inserted before v2.3).
4. specs/open-backlog.md — Q41 partial + Q44-Q47 (LLM-blocked) + Q38 deferred + Q40 → v2.2.5 + Q1-Q6 code-polish.
5. validation/closed-tasks/2026-05-14-wandr-be-techdebt-sweep.md — most recent and most valuable validation entry. First non-frontend, non-English, full-fan-out production verification of v2.2a.
6. specs/phases/v2.2.5-bundle-foundation.md — detailed plan for next phase if user decides to start it.
7. specs/v2.2.5-bundle-foundation.prompt.md — pasteable launcher prompt for v2.2.5 execution (a separate fresh session would run this, not this current session).

After reading, briefly confirm understanding in 5-7 lines: where the project stands (v2.2a shipped + verified), what's open (Q41 partial + 4 LLM-blocked items + Q47 minor), and what's awaiting decision (v2.2.5 start timing).

Then ask the user what they want to do next. Common requests will be:
- Analyze a fresh /task pipeline run (running on some project — read state files via jq queries per the feedback_validation_first.md memory)
- Update specs or backlog based on new observations
- Write or refine a launcher prompt
- Strategic discussion (use calibrated honest assessment per feedback_calibrated_honesty.md memory)
- Start v2.2.5 work (write launcher tweaks if needed, then user runs it in a separate fresh session)

Do not run /task on claude-pipeline itself. Do not modify state files in any /task in-flight project (.claude/pipeline-state.json etc. — guard hook blocks; modifications corrupt invariants).
```

This bootstrap prompt is the equivalent of "warm boot" — agent loads ~30-45 minutes of context in a structured way then stands by for direction.

## What to ASK at start of next session

If continuing strategic work:
- "Energy level today — high / mid / low?"
- "Is v2.2.5 starting now, or one more validation run first?"
- "Any new observations from validation runs since last session?"

If continuing implementation work:
- "Should I review the v2.2.5 launcher prompt before execution starts?"
- "Any pending Q-items to add before launcher locks in?"

## What NOT to do in next session

- **Don't re-litigate decided architecture.** Plugin framework, validation discipline, Q-item conventions, schema versioning — all settled. Question them only if real evidence emerges that they're wrong.
- **Don't pivot to non-code domains preemptively.** Multi-domain bundle abstraction (Q40 → v2.2.5) makes architecture ready; actual TikTok/marketing/research bundle authoring waits for VALIDATED demand signal.
- **Don't pile on more Q-items without filing them properly.** Use `specs/open-backlog.md` workflow — severity, root cause, file location, effort estimate.
- **Don't run `/task` on claude-pipeline itself** (self-referential). Real-task validation runs are on other projects (s3-panel, wandr-be, etc.).

## After v2.2.5 ships — what's next

Post-v2.2.5 expected sequence:
1. Tag `v2.2.5`
2. Real-task verification on s3-panel + wandr-be (legacy behavior + explicit config + schema validation)
3. Start v2.3 daemon + Web UI (bundle-aware from day 1)
4. v2.4 Docker
5. v2.5 multi-provider routing (commercial prerequisite — activates Q41/Q44/Q46 LLM paths)
6. v2.6 marketplace + curator agent (Pro tier launch)
7. v3.0 fleet (commercial scale-up)

**Critical milestone watch:** v2.5 multi-provider activation flips a switch — Q41/Q44/Q46 all auto-activate (no separate work needed beyond `query?()` implementation in the non-shuttle SpawnProvider). After v2.5, classification-LLM pattern is usable everywhere.

## File lifecycle

This document is **disposable**. When v2.2.5 starts, either:
- (a) Move to `specs/done/SESSION-HANDOFF-2026-05-15.md` as history
- (b) Delete entirely (auto-memory will hold the persistent bits)
- (c) Update in-place if useful for the next handoff cycle

Recommend (a) — historical context can be useful when later looking back at "what was happening when v2.2.5 was decided".

## Cross-references

- **Repository:** `/Users/teaarte/Programming/internal/claude-pipeline/`
- **Validation projects to date:** `~/Work/AI-FACTORY/s3-panel/`, `~/ProjectWandr/wandr-be/`
- **Auto-memory** (per-project, local): `~/.claude/projects/-Users-teaarte-Programming-internal-claude-pipeline/memory/` (populated alongside this doc)
- **GitHub:** `https://github.com/teaarte/claude-pipeline`

End of handoff.
