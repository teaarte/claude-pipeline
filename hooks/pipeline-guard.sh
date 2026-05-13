#!/usr/bin/env bash
# pipeline-guard.sh — PreToolUse hook that blocks direct writes to MCP-managed files.
#
# Protected paths (managed exclusively by the claude-pipeline MCP server):
#   * <project>/.claude/pipeline-state.json
#   * <project>/.claude/pipeline-state-summary.md
#   * <project>/.claude/findings.jsonl
#   * ~/.claude/metrics/pipeline.jsonl
#   * ~/.claude/metrics/agent-feedback.jsonl
#
# Catches:
#   - Write / Edit / MultiEdit / NotebookEdit on those file_paths
#   - Bash commands that touch them via >, >>, sed -i, tee, cp, mv, rm, awk -i
#
# Escape hatch: set env var PIPELINE_ALLOW_RAW=1 (intended for the MCP server
# author's own debugging, never normal workflows).

if ! command -v jq &>/dev/null; then
  # Without jq we can't parse the payload; fail-open so Claude Code stays usable.
  exit 0
fi

INPUT=$(cat)

# Allow explicit bypass.
if [ "${PIPELINE_ALLOW_RAW:-0}" = "1" ]; then
  exit 0
fi

TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ -z "$TOOL" ] && exit 0

# Basenames the MCP owns. We match on basename to cover any project dir.
PROTECTED_RE='(\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl))|(\.claude/metrics/(pipeline|agent-feedback)\.jsonl)'

deny() {
  reason="$1"
  jq -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
}

case "$TOOL" in
  Write|Edit|MultiEdit|NotebookEdit)
    FP=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    [ -z "$FP" ] && exit 0
    if echo "$FP" | grep -qE "$PROTECTED_RE"; then
      deny "Direct $TOOL on '$FP' is blocked. This file is managed by the claude-pipeline MCP server. Use mcp__claude-pipeline__* tools instead (pipeline_record_agent_run, pipeline_set_phase_status, pipeline_finish, ...). Bypass: set PIPELINE_ALLOW_RAW=1 (for MCP-author debugging only)."
    fi
    ;;
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    [ -z "$CMD" ] && exit 0
    # Only block when the command both *names* a protected file AND looks like a write.
    # Reads (cat, less, grep, wc, jq <file>) are fine.
    if echo "$CMD" | grep -qE "$PROTECTED_RE"; then
      writeop=0
      # Redirects: >, >>, >|, &>, &>>
      echo "$CMD" | grep -qE '(^|[^0-9])>{1,2}' && writeop=1
      echo "$CMD" | grep -qE '\|[[:space:]]*tee([[:space:]]|$)' && writeop=1
      echo "$CMD" | grep -qE '(^|[[:space:]])sed[[:space:]]+-i' && writeop=1
      echo "$CMD" | grep -qE '(^|[[:space:]])awk[[:space:]]+-i' && writeop=1
      # File mutators that take a path argument
      echo "$CMD" | grep -qE '(^|[[:space:]])(cp|mv|rm|truncate|install|chmod|chown)([[:space:]]|$)' && writeop=1
      if [ "$writeop" = "1" ]; then
        deny "Bash command appears to write to an MCP-managed file. Reads are fine; mutations must go through mcp__claude-pipeline__* tools. Command: $CMD"
      fi
    fi
    ;;
esac

exit 0
