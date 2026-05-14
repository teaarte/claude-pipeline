#!/usr/bin/env bash
# Stop hook: detects incoherent pipeline-state.json and reminds about in-flight
# tasks. When the pipeline is in flight (state file exists but verdict=null),
# the hook BLOCKS session-stop once and tells Claude to run /done first. It
# never blocks twice in a row — once stop_hook_active=true, it falls back to
# diagnostic stderr output so the user can still close the session.
#
# Reads cwd + stop_hook_active from Claude Code's hook payload.

set -u

# Hook receives JSON payload on stdin. We need cwd and stop_hook_active.
payload=""
stop_hook_active="false"
if [ -t 0 ]; then
  cwd="${PWD:-.}"
else
  payload=$(cat || true)
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)
  if [ -z "$cwd" ]; then cwd="${PWD:-.}"; fi
  stop_hook_active=$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null)
fi

state="$cwd/.claude/pipeline-state.json"
[ -f "$state" ] || exit 0

# Parse minimally with jq.
verdict=$(jq -r '.verdict // empty' "$state" 2>/dev/null)
agents=$(jq -r '.agents_count // 0' "$state" 2>/dev/null)
complexity=$(jq -r '.complexity // empty' "$state" 2>/dev/null)
violation=$(jq -r '.pipeline_violation // empty' "$state" 2>/dev/null)
current_step=$(jq -r '.current_step // empty' "$state" 2>/dev/null)

# Q24: driver-state.pending_user_answer marks a legitimate pause (gate
# awaiting user input). Treat it as "not in flight" so the Stop hook
# stays silent — otherwise the user gets a scary "run /done" message
# every time the pipeline asks a gate question.
driver_state="$cwd/.claude/driver-state.json"
pending_user_answer=""
if [ -f "$driver_state" ]; then
  pending_user_answer=$(jq -r '.pending_user_answer // empty' "$driver_state" 2>/dev/null)
fi

# Case 1: task closed with zero agents on a non-trivial complexity → real violation.
if [ -n "$verdict" ] && [ "$agents" = "0" ] && [ "$complexity" != "simple" ]; then
  echo "[claude-pipeline] PIPELINE VIOLATION: task '$verdict' with agents_count=0 (complexity=$complexity). No subagents were spawned. Run pipeline_validate via MCP." >&2
fi

# Case 2: in-flight task (no verdict yet) → block the stop ONCE and ask Claude
# to run /done. If stop_hook_active is already true (i.e. we've blocked before
# this run), fall back to diagnostic stderr so the user can actually exit.
#
# Q24: skip entirely when pending_user_answer is set — the pipeline is
# legitimately paused at a gate, not stuck. Stop hook stays silent.
if [ -z "$verdict" ] && [ -z "$pending_user_answer" ]; then
  if [ "$stop_hook_active" = "true" ] || [ "${PIPELINE_ALLOW_RAW:-0}" = "1" ]; then
    echo "[claude-pipeline] pipeline still in flight at step: $current_step — exit anyway (stop_hook_active or PIPELINE_ALLOW_RAW=1)." >&2
  else
    jq -n --arg step "$current_step" '{
      "decision": "block",
      "reason": ("Pipeline is in flight at step \"" + $step + "\" with verdict=null. Run /done to finalize the task — this calls mcp__claude-pipeline__pipeline_finish, appends metrics, and cleans .claude/ working files. If you genuinely want to abandon the task, call mcp__claude-pipeline__pipeline_finish with verdict=\"rejected\" and then re-stop.")
    }'
    exit 0
  fi
fi

# Case 3: existing pipeline_violation tag → echo so the human sees it.
if [ -n "$violation" ]; then
  echo "[claude-pipeline] pipeline_violation flag set: $violation" >&2
fi

exit 0
