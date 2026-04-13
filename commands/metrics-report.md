# Metrics Report — Pipeline Analysis

Analyze pipeline metrics and suggest improvements. No arguments needed.

---

## Process

### 1. Load Data
Read `~/.claude/metrics/pipeline.md` and `~/.claude/metrics/agent-feedback.md`.

If pipeline.md has fewer than 3 rows, say: "Not enough data yet ({N} tasks). Run more tasks via `/task` to build up metrics. Minimum 3 for basic analysis, 10+ for recommendations."

### 2. Summary Stats

Print:
```
┌──────────────────────────────────────────────────────┐
│ Pipeline Metrics Report ({date range})                │
├───────────────────┬──────────────────────────────────┤
│ Total Tasks       │ {N}                               │
│ By Complexity     │ S:{n} M:{n} C:{n}                 │
│ Avg Plan Iters    │ S:{n} M:{n} C:{n}                 │
│ Avg Impl Iters    │ S:{n} M:{n} C:{n}                 │
│ Avg Agents/Task   │ S:{n} M:{n} C:{n}                 │
│ Tests Written     │ {total} across {N} tasks           │
│ Accept Rate       │ {n}%                              │
└───────────────────┴──────────────────────────────────┘
```

### 3. Reviewer Effectiveness

For each reviewer that appears in `reviewer_verdicts`:
- **Times invoked** — count appearances
- **Blockers found** — count from `reviewers_with_blockers`
- **Hit rate** — blockers / invocations

Print table:
```
│ Reviewer         │ Invoked │ Blockers │ Hit Rate │ Recommendation       │
│ Logic Reviewer   │ 8       │ 3        │ 37.5%    │ Keep (high value)    │
│ Style Reviewer   │ 10      │ 0        │ 0%       │ Skip for SIMPLE?     │
│ Security Agent   │ 4       │ 2        │ 50%      │ Keep                 │
│ Performance      │ 6       │ 0        │ 0%       │ Skip for SIMPLE?     │
```

**Rules for recommendations:**
- Hit rate 0% after 5+ invocations for a complexity → "Consider skipping for {complexity}"
- Hit rate > 20% → "Keep (high value)"
- Hit rate 1-20% → "Keep (moderate value)"
- Fewer than 5 invocations → "Insufficient data"

### 4. Complexity Accuracy

Look for over-classification patterns:
- COMPLEX tasks with 0 blockers AND 1 impl iteration → "Could have been MEDIUM"
- MEDIUM tasks with 0 blockers AND 0 plan iterations → "Could have been SIMPLE"

Print if found:
```
⚠ Possible over-classification:
  - "Mobile UX fixes" classified COMPLEX, had 0 blockers, 1 impl iter → could be MEDIUM
```

### 5. Agent Feedback Patterns

If `agent-feedback.md` has entries:
- Group by agent → show which agents miss most
- Group by issue type → show recurring patterns
- If same agent missed 3+ → suggest specific check to add to agent definition

### 6. Actionable Recommendations

Based on analysis, suggest 1-3 specific changes. Only suggest if data supports it (not speculation).

Format:
```
Recommendations:
1. [what to change] — [why, with data]
2. ...
```

Examples:
- "Remove Performance Agent from SIMPLE pipeline — 0 blockers in 7 invocations, saves ~1 agent call per simple task"
- "Downgrade to MEDIUM by default — 2 of 3 COMPLEX tasks had 0 blockers"
- "Add async race condition check to Logic Reviewer — missed 3 times per agent-feedback"
