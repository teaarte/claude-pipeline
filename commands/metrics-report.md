# Metrics Report — Pipeline Analysis

Analyze pipeline metrics and suggest improvements. No arguments needed. Reads structured JSONL.

---

## Process

### 1. Load Data
Read `~/.claude/metrics/pipeline.jsonl` (one JSON object per line, schema `pipeline.jsonl` row format from `commands/done.md`) and `~/.claude/metrics/agent-feedback.jsonl` (per `templates/schemas/agent-feedback.schema.json`).

If pipeline.jsonl has fewer than 3 entries, say: *"Not enough data yet ({N} tasks). Run more tasks via `/task` to build up metrics. Minimum 3 for basic analysis, 10+ for recommendations."*

For deeper analysis (clustering by category, drift detection, vocab promotion candidates) use `/learn` instead — `/metrics-report` is the human-readable narrative summary.

### 2. Summary Stats

Print:
```
┌──────────────────────────────────────────────────────┐
│ Pipeline Metrics Report ({date range})                │
├───────────────────┬──────────────────────────────────┤
│ Total Tasks       │ {N}                               │
│ By Complexity     │ S:{n} M:{n} C:{n}                 │
│ Avg Plan Iters    │ S:{n} M:{n} C:{n}                 │
│ Avg Gate1 Revisions│ S:{n} M:{n} C:{n}                │
│ Avg Impl Iters    │ S:{n} M:{n} C:{n}                 │
│ Avg Agents/Task   │ S:{n} M:{n} C:{n}                 │
│ Acceptance 1st-pass│ {n}%                             │
│ Plan Drift rate   │ {n}% (CONFORMS vs DRIFT/PARTIAL)  │
│ Reviewer Disagree │ {n} occurrences                   │
│ Grounding Misses  │ {n} total                         │
│ Tests Written     │ {total} across {N} tasks           │
│ Accept Rate       │ {n}%                              │
└───────────────────┴──────────────────────────────────┘
```

### 3. Reviewer Effectiveness

For each agent that appears across rows' `reviewer_verdicts[]`:
- **Times invoked** — count of rows where that agent appeared.
- **Blockers raised** — sum of `blocking_issues` for that agent across rows.
- **Misses post-merge** — for each row with `task_id`, count entries in `agent-feedback.jsonl` where `agent` matches and `task_id` equals row's `task_id` and `human_confirmed=true`.
- **Effectiveness** — `blockers_raised / (blockers_raised + misses_post_merge)`. Lower = agent missing things that ship.
- **Hit rate** — `blockers / invocations`.

Print table:
```
│ Reviewer         │ Invoked │ Blockers │ Misses │ Effective │ Hit Rate │ Recommendation       │
│ logic-reviewer   │ 8       │ 3        │ 1      │ 75%       │ 37.5%    │ Keep (high value)    │
│ challenger-rev   │ 8       │ 2        │ 0      │ 100%      │ 25%      │ Keep                 │
│ style-reviewer   │ 10      │ 0        │ 0      │ —         │ 0%       │ Skip for SIMPLE?     │
│ security         │ 4       │ 2        │ 1      │ 67%       │ 50%      │ Keep                 │
│ performance      │ 6       │ 0        │ 0      │ —         │ 0%       │ Skip for SIMPLE?     │
```

**Rules for recommendations:**
- Hit rate 0% after 5+ invocations for a complexity → "Consider skipping for {complexity}".
- Effectiveness < 50% with ≥3 invocations → "Review prompt or model — agent is missing things".
- Hit rate > 20% AND effectiveness > 70% → "Keep (high value)".
- Hit rate 1-20% → "Keep (moderate value)".
- Fewer than 5 invocations → "Insufficient data".

### 4. Logic vs Challenger Disagreement

Across rows, sum `reviewer_disagreements`. If > 10% of MEDIUM/COMPLEX tasks had a disagreement → human gate is doing real work. If 0% → either both reviewers are too lenient OR challenger isn't probing hard enough.

### 5. Drift Trends

- **`acceptance_first_pass` rate** trending down across recent vs older rows → quality regression somewhere.
- **`plan_drift.verdict ∈ {DRIFT, PARTIAL}`** rate trending up → planner specs becoming insufficient OR implementer becoming sloppier.
- **`grounding_mismatches`** trending up → planner hallucinations growing; tighten its prompt.

### 6. Complexity Accuracy

Over-classification patterns:
- COMPLEX rows with `blockers_found == 0` AND `impl_iters == 1` → "Could have been MEDIUM".
- MEDIUM rows with `blockers_found == 0` AND `plan_iters == 0` → "Could have been SIMPLE".

Print if found:
```
⚠ Possible over-classification:
  - t-2026-04-12-mobile-ux: COMPLEX, 0 blockers, 1 impl iter → could be MEDIUM
```

### 7. Agent Feedback Patterns

If `agent-feedback.jsonl` has confirmed entries:
- Group by `agent` × `category` → show top missed categories per agent.
- For any `(agent, pattern_to_look_for)` pair appearing ≥3 times confirmed → suggest specific check to add to agent definition (or run `/learn` for deeper clustering and prompt-edit suggestions).

### 8. Actionable Recommendations

Based on analysis, suggest 1-3 specific changes. Only suggest if data supports it (not speculation).

Format:
```
Recommendations:
1. [what to change] — [why, with data]
2. ...
```

Examples:
- "Remove Performance Agent from SIMPLE pipeline — 0 blockers in 7 invocations, saves ~1 agent call per simple task".
- "Downgrade to MEDIUM by default — 2 of 3 COMPLEX tasks had 0 blockers".
- "Add async race condition check to logic-reviewer — missed 3 times per agent-feedback (run `/learn promote logic-reviewer race-condition` if not already in vocab)".

---

## Relationship to `/learn`

| Command | Purpose |
|---|---|
| `/metrics-report` | Human-readable narrative summary; reviewer effectiveness; complexity accuracy; high-level recommendations |
| `/learn` | Clustering by category, drift detection, vocab promotion, pattern auto-promotion candidates, optional LLM-suggested prompt edits |

Run `/metrics-report` weekly for narrative; run `/learn` when about to edit any agent prompt.
