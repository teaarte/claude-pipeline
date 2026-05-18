#!/usr/bin/env bash
# Stop hook: detects incoherent pipeline-state.json and reminds about in-flight
# tasks. When the pipeline is in flight (state file exists but verdict=null),
# the hook BLOCKS session-stop once and tells Claude to run /done first. It
# never blocks twice in a row — once stop_hook_active=true, it falls back to
# diagnostic stderr output so the user can still close the session.
#
# v2.2.6 C8 / Q64: when Claude Code's session_id (from the stdin payload)
# does NOT match `state.owner_id`, the hook stays silent — this stop belongs
# to a DIFFERENT window than the one that started the task, so blocking
# would be a false positive AND running /done from this window would
# clobber the owner window's state.
#
# This is the ONLY place in the codebase that knows about Claude Code's
# session_id specifically. The MCP server stores owner_id as an opaque
# string sourced from a generic env-var chain; future transports (HTTP
# daemon, CLI) set their own owner_id and have their own stop semantics.
#
# Reads cwd + stop_hook_active + session_id from Claude Code's hook payload.

set -u

# Hook receives JSON payload on stdin. We need cwd, stop_hook_active, and
# (C8) session_id for the owner-comparison check.
payload=""
stop_hook_active="false"
session_id=""
if [ -t 0 ]; then
  cwd="${PWD:-.}"
else
  payload=$(cat || true)
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)
  if [ -z "$cwd" ]; then cwd="${PWD:-.}"; fi
  stop_hook_active=$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null)
  session_id=$(jq -r '.session_id // empty' <<<"$payload" 2>/dev/null)
fi

state="$cwd/.claude/pipeline-state.json"
[ -f "$state" ] || exit 0

# Parse minimally with jq.
verdict=$(jq -r '.verdict // empty' "$state" 2>/dev/null)
agents=$(jq -r '.agents_count // 0' "$state" 2>/dev/null)
complexity=$(jq -r '.complexity // empty' "$state" 2>/dev/null)
violation=$(jq -r '.pipeline_violation // empty' "$state" 2>/dev/null)
owner_id=$(jq -r '.owner_id // empty' "$state" 2>/dev/null)

# v2.2.6 C8 / Q64: cross-session early-out. If owner_id is recorded AND
# the current session_id doesn't match, this window doesn't own the task.
# Print an INFO line to stderr (user-visible) and exit 0 — don't block,
# don't suggest /done (running it here would kill the owner window's
# state). The owner window's stop hook will fire normally when it closes.
if [ -n "$owner_id" ] && [ -n "$session_id" ] && [ "$owner_id" != "$session_id" ]; then
  echo "[claude-pipeline] INFO: in-flight task in this project belongs to a different Claude Code session (owner=${owner_id:0:8}…). This window is free to stop. Do NOT run /done here — it would clobber the owner session's state." >&2
  exit 0
fi

# Q36: Gate 2 decision tri-state. After user accepts at Gate 2,
# pipeline_continue_task mirrors gates.gate2="approved" but verdict
# stays null until /done -> pipeline_finish runs. Distinguishing this
# from a genuinely-mid-flight task lets the Stop hook emit a positive
# message ("just /done to finalize") instead of a scary "in flight"
# warning that suggests the user broke something.
gate2_status=$(jq -r '.gates.gate2 // empty' "$state" 2>/dev/null)

# Q24: driver-state.pending_user_answer marks a legitimate pause (gate
# awaiting user input). Treat it as "not in flight" so the Stop hook
# stays silent — otherwise the user gets a scary "run /done" message
# every time the pipeline asks a gate question.
driver_state="$cwd/.claude/driver-state.json"
pending_user_answer=""
flow_name=""
step_index=""
if [ -f "$driver_state" ]; then
  pending_user_answer=$(jq -r '.pending_user_answer // empty' "$driver_state" 2>/dev/null)
  # Q10: pipeline-state.current_step was a v1 leftover that v2 never
  # maintained (always stayed at "STEP 1"). driver-state.{flow_name,
  # step_index} is the source of truth for FSM progress.
  flow_name=$(jq -r '.flow_name // empty' "$driver_state" 2>/dev/null)
  step_index=$(jq -r '.step_index // empty' "$driver_state" 2>/dev/null)
fi

# Diagnostic step label for messages. Falls back to "unknown" when
# driver-state is absent or fields missing.
if [ -n "$flow_name" ] && [ -n "$step_index" ]; then
  step_label="flow=${flow_name} step=${step_index}"
else
  step_label="unknown"
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
    echo "[claude-pipeline] pipeline still in flight at step: $step_label — exit anyway (stop_hook_active or PIPELINE_ALLOW_RAW=1)." >&2
  elif [ "$gate2_status" = "approved" ] || [ "$gate2_status" = "accepted" ]; then
    # Q36: tri-state #3 — Gate 2 accepted, only awaiting /done finalization.
    # Block (to prevent data loss) but with positive framing: the task
    # itself is approved, this is just paperwork.
    jq -n '{
      "decision": "block",
      "reason": "Task accepted at Gate 2 — one step left to finalize. Run /done: it calls mcp__claude-pipeline__pipeline_finish (writes the metrics row to ~/.claude/metrics/pipeline.jsonl) and mcp__claude-pipeline__pipeline_done_cleanup (server-side atomic cleanup of .claude/ working files). The task is approved; this is the closing paperwork."
    }'
    exit 0
  else
    jq -n --arg step "$step_label" '{
      "decision": "block",
      "reason": ("Pipeline is in flight (" + $step + ") with verdict=null. Run /done to finalize the task — this calls mcp__claude-pipeline__pipeline_finish, appends metrics, and cleans .claude/ working files. If you genuinely want to abandon the task, call mcp__claude-pipeline__pipeline_finish with verdict=\"rejected\" and then re-stop.")
    }'
    exit 0
  fi
fi

# Case 3: existing pipeline_violation tag → echo so the human sees it.
if [ -n "$violation" ]; then
  echo "[claude-pipeline] pipeline_violation flag set: $violation" >&2
fi

exit 0
