#!/usr/bin/env bash
# Stop hook: warns when a pipeline-state.json is in an incoherent state
# (e.g. task closed with agents_count=0 on medium/complex tasks).
#
# Reads cwd from Claude Code's hook payload. Looks for .claude/pipeline-state.json.
# Non-blocking — only prints diagnostics to stderr.

set -u

# Hook receives JSON payload on stdin. We only need cwd; fall back to PWD.
payload=""
if [ -t 0 ]; then
  cwd="${PWD:-.}"
else
  payload=$(cat || true)
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)
  if [ -z "$cwd" ]; then cwd="${PWD:-.}"; fi
fi

state="$cwd/.claude/pipeline-state.json"
[ -f "$state" ] || exit 0

# Parse minimally with jq.
verdict=$(jq -r '.verdict // empty' "$state" 2>/dev/null)
agents=$(jq -r '.agents_count // 0' "$state" 2>/dev/null)
complexity=$(jq -r '.complexity // empty' "$state" 2>/dev/null)
violation=$(jq -r '.pipeline_violation // empty' "$state" 2>/dev/null)

# Case 1: task closed with zero agents on a non-trivial complexity → real violation.
if [ -n "$verdict" ] && [ "$agents" = "0" ] && [ "$complexity" != "simple" ]; then
  echo "[claude-pipeline] PIPELINE VIOLATION: task '$verdict' with agents_count=0 (complexity=$complexity). No subagents were spawned. Run pipeline_validate via MCP." >&2
fi

# Case 2: in-flight task (no verdict yet) → gentle reminder.
if [ -z "$verdict" ]; then
  current_step=$(jq -r '.current_step // empty' "$state" 2>/dev/null)
  echo "[claude-pipeline] pipeline in flight at step: $current_step — resume with /task-continue." >&2
fi

# Case 3: existing pipeline_violation tag → echo so the human sees it.
if [ -n "$violation" ]; then
  echo "[claude-pipeline] pipeline_violation flag set: $violation" >&2
fi

exit 0
