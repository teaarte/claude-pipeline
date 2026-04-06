# Agent Feedback — Log Missed Issue

Log when an agent missed a problem that was found later (in prod, by human, or by another agent).

**Input:** $ARGUMENTS

---

## Process

### 1. Identify the miss
Ask (if not provided in arguments):
- Which agent missed it? (Logic Reviewer, Security, Performance, Style, etc.)
- What was the issue? (bug, security hole, perf problem, pattern violation)
- How was it found? (prod bug, human review, another agent, testing)
- Severity? (critical / medium / low)

### 2. Log to metrics
Append to `~/.claude/metrics/agent-feedback.md`:

```
| date | agent | missed_issue | severity | found_by | action_taken |
```

### 3. Analyze patterns
Read `~/.claude/metrics/agent-feedback.md`. If same agent has 3+ misses:
- Show the pattern: "Logic Reviewer has missed 3 issues, all related to async/race conditions"
- Suggest: "Consider adding 'Check for race conditions in async operations' to `~/.claude/agents/logic-reviewer.md`"

If same issue type appears across agents:
- Show: "Async race conditions missed 4 times by 3 different agents"
- Suggest: adding it as a check in the relevant agent definitions

### 4. Ask about fix
> "Want me to update the agent definition to catch this in the future?"

If yes → read the agent file, add the specific check, explain what was added.
