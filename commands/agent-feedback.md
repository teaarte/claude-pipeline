# Agent Feedback — Log Missed Issue

Log when an agent missed a problem that was found later (in prod, by human, by another agent, or by a test). Writes a structured entry to `~/.claude/metrics/agent-feedback.jsonl`. Reviewers consume these on future runs via the past-misses injection (orchestrator rule #15).

**Input:** $ARGUMENTS

---

## Process

### 1. Identify the miss

Ask (if not provided in arguments):
- **Agent** — which one missed it (must match `category-vocab.json` agent list).
- **Category** — pick from `templates/schemas/category-vocab.json` → `vocab[<agent>]`. If nothing fits, use `"other"` AND set `proposed_new_category` (short, grep-friendly).
- **Pattern to look for** — short generic description, NOT the specific instance. Example: "async race in retry handlers" not "the foo() retry forgot to lock". This is what gets injected into future reviewer prompts.
- **Severity** — `high | medium | low`.
- **Found by** — `prod-incident | human-review | another-agent | test | other`.
- **Example file:line** — concrete instance for traceability (optional).
- **Task ID** — the original task where this slipped through (so `reviewer_misses_post_merge` can increment on that row in `pipeline.jsonl`).
- **Human confirmed** — `true | false`. Only confirmed entries count toward vocab promotion and pattern auto-promotion.

### 2. Log to metrics

Append one JSON object (single line) to `~/.claude/metrics/agent-feedback.jsonl`. Schema: `templates/schemas/agent-feedback.schema.json`.

Generate `feedback_id` as `fb-<YYYY-MM-DD>-<short>`. Validate against schema before write.

### 3. Update post-hoc accuracy on the offending pipeline.jsonl row

If `task_id` is set: read `~/.claude/metrics/pipeline.jsonl`, find the row with matching `task_id`, increment `reviewer_misses_post_merge` by 1, rewrite that line in place. If row not found, log a warning but do not fail.

### 4. Pattern analysis (lightweight, runs each invocation)

Read `~/.claude/metrics/agent-feedback.jsonl`. For the agent at hand:
- Count `confirmed` entries grouped by `category` and by `pattern_to_look_for`.
- If a `proposed_new_category` value appears ≥3 times confirmed → suggest vocab promotion: *"Pattern '<X>' missed 3+ times by <agent>. Promote to vocab? Run `/learn promote <agent> <category>`."*
- If a `pattern_to_look_for` appears ≥3 times confirmed → suggest making it a permanent prompt rule: *"<agent> has 3+ confirmed misses on '<pattern>'. Consider permanent prompt update."*

### 5. Vocab effect on future runs (automatic, no edit needed)

Once logged with a valid `category`, the entry is **automatically** picked up by orchestrator rule #15 (past-misses injection) on the next pipeline run for that agent. The `pattern_to_look_for` string lands in `.claude/past-misses-<agent>.md` and the reviewer Reads it.

Edit the agent's permanent prompt only when the pattern is **so general it deserves to live in the agent definition** (a checked rule rather than a rolling-window hint). Until then, the JSONL entry alone is sufficient — that's the whole point of the structured loop.

### 6. Output

Print a one-line summary:
```
Logged: fb-<id> | agent=<agent> category=<cat> severity=<sev> human_confirmed=<bool>
Pattern: "<pattern_to_look_for>"
Linked to task_id: <task_id or none>
```

Followed by any pattern-analysis suggestions from step 4.
