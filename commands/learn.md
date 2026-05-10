# Learn — Self-Improvement Analyzer

Cluster structured findings + agent-feedback to surface patterns, drift, and proposed updates. Mostly mechanical (JSON queries) with a small LLM step at the end to suggest concrete prompt changes for human review.

**Input:** `$ARGUMENTS` — optional. `promote <agent> <category>` to manually promote a `proposed_new_category` to vocab. No args = run full analysis.

---

## Sources read

- `~/.claude/metrics/pipeline.jsonl` — one row per task. Aggregate accuracy stats.
- `~/.claude/metrics/agent-feedback.jsonl` — confirmed misses with categories.
- All `.claude/findings.jsonl` accessible (current task only — historical findings are not persisted across `/done` cleanup; they exist in pipeline.jsonl as `categories_seen` aggregates and in agent-feedback.jsonl as logged misses).
- `~/.claude/templates/schemas/category-vocab.json` — current vocab.

---

## Process

### 1. Per-agent accuracy roll-up (mechanical)

For each agent in vocab, compute over the last 50 (or all) `pipeline.jsonl` rows:
- **Tasks involved** — count of rows where this agent appeared in `reviewer_verdicts`.
- **Blockers raised** — sum of `blocking_issues` for this agent.
- **Misses post-merge** — sum of `reviewer_misses_post_merge` from rows linked via `agent-feedback.jsonl` `task_id` referencing this agent.
- **Effectiveness ratio** — `blockers_raised / (blockers_raised + misses)`. Lower = agent is missing things that ship.
- **Disagreement rate** (logic-reviewer / challenger-reviewer only) — `reviewer_disagreements / tasks_involved`.

Output: a one-row-per-agent table.

### 2. Category clustering (mechanical)

For each agent:
- Group `agent-feedback.jsonl` entries by `category` (only `human_confirmed=true`).
- Top-N most-missed categories with counts.
- Group by `pattern_to_look_for` within each category. Top patterns within each.

Output: per-agent ranked list of categories + patterns.

### 3. Drift detection (mechanical)

- **Plan-grounding mismatches** — sum of `grounding_mismatches` over recent rows. Trending up? Plans hallucinate more — Planner prompt may need tightening.
- **Plan-conformance drift rate** — count of rows with `plan_drift.verdict ∈ {DRIFT, PARTIAL}` ÷ total rows.
- **Acceptance first-pass rate** — count of rows with `acceptance_first_pass=true` ÷ total. Trending down = quality regressing somewhere.
- **Average iterations** — `plan_iters` and `impl_iters` averages. Rising = either harder tasks or weaker first-pass quality.

### 4. Vocab promotion candidates (mechanical)

Scan `agent-feedback.jsonl` for `category="other"` entries with `human_confirmed=true` and a `proposed_new_category` field. For each (agent, proposed_new_category) pair appearing ≥3 times:
- Print: `Promote vocab: agent=<agent>, new_category="<proposed>", instances=<n>`
- Suggest: *"Run `/learn promote <agent> <proposed>` to add to vocab."*

If invoked as `/learn promote <agent> <category>`:
- Add `<category>` to `templates/schemas/category-vocab.json` → `vocab[<agent>]`.
- Backfill: scan `agent-feedback.jsonl` for matching `proposed_new_category="<category>"`, set `category=<category>`, clear `proposed_new_category`, set `action_taken="vocab-added"`.

### 5. Pattern auto-promotion candidates (mechanical)

For any `pattern_to_look_for` string that appears ≥3 times confirmed in `agent-feedback.jsonl` for the same agent:
- Print: *"<agent>: pattern '<pattern>' confirmed <n> times. Consider permanent prompt update in `~/.claude/agents/<agent>.md`."*
- Print the relevant section of the current agent definition for context.
- Do NOT auto-edit. Human reviews and decides.

### 6. Reference-rule effectiveness (mechanical)

Read recent `pipeline.jsonl` rows; aggregate `categories_seen`. For each Tier-1 reference file, count how often categories aligned with its anti-patterns appeared. Reference files generating zero hits across 50 tasks → review for retire/refresh.

### 7. Suggested actions (LLM-generated, optional)

After all mechanical analysis, optionally invoke a small LLM step (model: **haiku**) to:
- Read the top 3 "patterns ≥3 confirmed misses".
- Generate a 1-paragraph prompt-update suggestion per pattern, citing the current agent definition.
- Output as a numbered list of *suggested* changes — never auto-apply.

### 8. Output

```
┌─────────────────────────────────────────────────────────────────────┐
│ Pipeline Self-Learning Report — <YYYY-MM-DD>                         │
├─────────────────────────────────────────────────────────────────────┤
│ Tasks analyzed: <N>                                                  │
│ Window: last <50 | all> rows                                         │
└─────────────────────────────────────────────────────────────────────┘

## Per-Agent Accuracy
| Agent | Tasks | Blockers raised | Misses post-merge | Effectiveness | Disagreement |
|-------|-------|-----------------|-------------------|---------------|--------------|

## Top Missed Categories (per agent)
- logic-reviewer: race-condition (×4), error-swallowed (×2)
- security: secret-in-log-or-bundle (×3), rate-limit-missing (×2)
- ...

## Drift Trends
- grounding_mismatches: <trend>
- plan-conformance drift rate: <%>
- acceptance_first_pass rate: <%>
- avg plan_iters: <n>, avg impl_iters: <n>

## Vocab Promotion Candidates
- agent=<a> new_category="<x>" instances=<n>  → /learn promote <a> <x>

## Pattern Auto-Promotion Candidates (≥3 confirmed misses)
- <agent>: "<pattern>" — review prompt at ~/.claude/agents/<agent>.md

## Reference Rule Hit Rates (Tier-1)
- arch-patterns.md: <n> hits
- db-postgres.md: <n>
- redis.md: <n>
- react19.md: <n>
- caching.md: <n>

## Suggested Prompt Changes (LLM-generated, review before applying)
1. ...
```

Print to console; do not write a report file unless asked. The data lives in the JSONL streams; this command is the lens.

---

## When to run

- Weekly or every 10-20 tasks.
- After a real bug surfaces post-merge — log via `/agent-feedback` first, then run `/learn` to see if a pattern already crossed threshold.
- Before editing any agent prompt — `/learn` data tells you which agents actually need work and which are fine.

## What NOT to do

- Do NOT auto-apply prompt updates from step 7. The LLM suggestion is *seed*, the human is editor.
- Do NOT auto-retire categories. Even rare categories may be high-stakes (e.g. `auth-bypass` should never be removed).
- Do NOT collapse vocab across agents. Categories are agent-specific by design.
