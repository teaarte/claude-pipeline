# Agent Feedback — Log Missed Issue

Log when an agent missed a problem that was found later (in prod, by human, by another agent, or by a test). The MCP server writes a structured entry to `~/.claude/metrics/agent-feedback.jsonl`. Reviewers consume these on future runs via the past-misses injection (orchestrator rule #15).

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

### 2. Log via MCP

```
mcp__claude-pipeline__pipeline_log_agent_feedback({
  agent: "<agent>",
  category: "<from vocab or 'other'>",
  proposed_new_category: "<set if category='other', else omit>",
  pattern_to_look_for: "<short generic description>",
  severity: "<high|medium|low>",
  found_by: "<prod-incident|human-review|another-agent|test|other>",
  example_file_line: "<optional file:line>",
  task_id: "<optional originating task_id>",
  human_confirmed: <true|false>
})
```

The MCP:
- Generates `feedback_id` as `fb-<YYYY-MM-DD>-<short>`.
- Validates the entry against `templates/schemas/agent-feedback.schema.json`.
- Appends a single JSON line to `~/.claude/metrics/agent-feedback.jsonl`.
- If `task_id` is set, finds the matching row in `~/.claude/metrics/pipeline.jsonl` and increments its `reviewer_misses_post_merge` by 1. If the row is not found, returns a warning but does not fail.

**Never `Write` or `Edit` `agent-feedback.jsonl` or `pipeline.jsonl` directly** — both are MCP-managed append-only streams. Direct edits bypass schema validation and break the post-hoc accuracy counter.

### 3. Pattern analysis (lightweight, runs each invocation)

After logging, call `mcp__claude-pipeline__pipeline_get_past_misses({agent: <same agent>, limit: 30, human_confirmed_only: true})` to read recent confirmed misses for that agent. Count by `category` and by `pattern_to_look_for`:
- If a `proposed_new_category` value appears ≥3 times confirmed → suggest vocab promotion: *"Pattern '<X>' missed 3+ times by <agent>. Promote to vocab? Run `/learn promote <agent> <category>`."*
- If a `pattern_to_look_for` appears ≥3 times confirmed → suggest making it a permanent prompt rule: *"<agent> has 3+ confirmed misses on '<pattern>'. Consider permanent prompt update."*

### 4. Vocab effect on future runs (automatic, no edit needed)

Once logged, the entry is **automatically** picked up by orchestrator rule #15 (past-misses injection) on the next pipeline run for that agent. The orchestrator calls `pipeline_get_past_misses` at pipeline start and the `pattern_to_look_for` string lands in `.claude/past-misses-<agent>.md`.

Edit the agent's permanent prompt only when the pattern is **so general it deserves to live in the agent definition** (a checked rule rather than a rolling-window hint).

### 5. Output

Print a one-line summary:
```
Logged: fb-<id> | agent=<agent> category=<cat> severity=<sev> human_confirmed=<bool>
Pattern: "<pattern_to_look_for>"
Linked to task_id: <task_id or none>
```

Followed by any pattern-analysis suggestions from step 3.
