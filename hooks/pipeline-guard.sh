#!/usr/bin/env bash
# pipeline-guard.sh — PreToolUse hook that blocks direct writes to MCP-managed files.
#
# Protected paths (managed exclusively by the claude-pipeline MCP server):
#   * <project>/.claude/pipeline-state.json
#   * <project>/.claude/pipeline-state-summary.md
#   * <project>/.claude/findings.jsonl
#   * <project>/.claude/mcp-audit.jsonl
#   * ~/.claude/metrics/pipeline.jsonl
#   * ~/.claude/metrics/agent-feedback.jsonl
#   * ~/.claude/metrics/mcp-audit.jsonl
#
# Scoping (4a):
#   A path under <project>/.claude/ is only protected when an ancestor
#   directory contains a `.mcp-managed` marker file (created by pipeline_init,
#   removed by /done). Without the marker, guard fails-open. Home-metrics
#   paths are always protected.
#
# Bypass (4c, replaces PIPELINE_ALLOW_RAW):
#   <project>/.claude/.mcp-bypass-allowed{schema_version,expires_at,reason,issued_by_task_id}
#   created by pipeline_unlock_writes({ttl_seconds, reason}). Honored only
#   while `now < expires_at`. Removed by pipeline_relock_writes or /done.
#
# Coverage (4b):
#   Beyond shell mutators, blocks Python/Node/Deno/Perl/Ruby/dd write-ops
#   that target a protected file. Reads (cat, grep, jq, less, etc.) pass.

if ! command -v jq &>/dev/null; then
  # Without jq we can't parse the payload; fail-open so Claude Code stays usable.
  exit 0
fi

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ -z "$TOOL" ] && exit 0

# Protected basenames in <proj>/.claude/ and ~/.claude/metrics/.
PROTECTED_RE='(\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl))|(\.claude/metrics/(pipeline|agent-feedback|mcp-audit)\.jsonl)'

# Write-op detection across shells and embedded interpreters.
# Each entry MUST be paired with PROTECTED_RE elsewhere in the command to fire.
WRITE_OP_PATTERNS=(
  '(^|[^0-9])>{1,2}'                                                    # redirects
  '\|[[:space:]]*tee([[:space:]]|$)'                                    # | tee
  '(^|[[:space:]])sed[[:space:]]+-i'                                    # sed -i / sed -i''
  '(^|[[:space:]])awk[[:space:]]+-i'                                    # awk -i inplace
  '(^|[[:space:]])(cp|mv|rm|truncate|install|chmod|chown)([[:space:]]|$)' # mutators
  # Interpreted -c / -e patterns. Use .* (not [^|;&]*) because the protected
  # file path inside the script body may follow embedded semicolons; the
  # accidental cost is matching mutator verbs that appear in grep/jq pipes,
  # which is acceptable in a default-deny security hook.
  'python(3)?[[:space:]]+-c[[:space:]].*(unlink|remove|rmtree|os\.remove|os\.unlink|shutil\.rmtree|open\([^)]*['\''"]w)'
  'node(js)?[[:space:]]+-e[[:space:]].*(unlinkSync|writeFileSync|appendFileSync|rmSync|truncateSync|createWriteStream)'
  'deno[[:space:]]+(run[[:space:]]+)?(-A[[:space:]]+)?-e[[:space:]].*(removeSync|writeTextFileSync|writeFileSync|truncateSync)'
  'perl[[:space:]]+-e[[:space:]].*(unlink|open[[:space:]]*\([^)]*['\''">]+)'
  'ruby[[:space:]]+-e[[:space:]].*(File\.(delete|write|truncate|open)|FileUtils\.rm)'
  '(^|[[:space:]])dd[[:space:]]+.*\bof='
)

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

# Walk upwards from a path until we either find a .mcp-managed marker or hit
# the filesystem root. Echoes the marker dir on success, empty on failure.
find_marker_dir() {
  local p="$1"
  # Convert to absolute path if possible (best-effort)
  case "$p" in
    /*) ;;
    *) p="$PWD/$p" ;;
  esac
  local dir
  dir=$(dirname "$p")
  while [ "$dir" != "/" ] && [ -n "$dir" ]; do
    if [ -f "$dir/.claude/.mcp-managed" ]; then
      echo "$dir"
      return 0
    fi
    if [ -f "$dir/.mcp-managed" ]; then
      # also accept marker directly in a managed dir (rare)
      echo "$(dirname "$dir")"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

# Returns 0 if the bypass marker is present and unexpired for a given project root.
bypass_allowed_for() {
  local project_root="$1"
  local marker="$project_root/.claude/.mcp-bypass-allowed"
  [ -f "$marker" ] || return 1
  # Best-effort: parse expires_at, compare to now.
  local exp now
  exp=$(jq -r '.expires_at // empty' < "$marker" 2>/dev/null)
  [ -z "$exp" ] && return 1
  # date parsing: macOS BSD date vs GNU date differ. Try GNU first, fall back.
  local exp_epoch
  # GNU date understands the ISO 8601 Z suffix directly.
  # macOS BSD date does not — strip subsecond+TZ and parse as UTC explicitly.
  if exp_epoch=$(date -u -d "$exp" +%s 2>/dev/null); then
    :
  elif exp_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${exp%%.*}" +%s 2>/dev/null); then
    :
  else
    return 1
  fi
  now=$(date +%s)
  [ "$now" -lt "$exp_epoch" ]
}

# Emit an audit line to ~/.claude/metrics/mcp-audit.jsonl describing the bypass.
audit_bypass() {
  local tool="$1" path="$2" project_root="$3"
  local global="${CLAUDE_PIPELINE_METRICS_DIR:-$HOME/.claude/metrics}"
  mkdir -p "$global" 2>/dev/null || true
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  jq -nc \
    --arg ts "$ts" \
    --arg tool "$tool" \
    --arg path "$path" \
    --arg pr "$project_root" \
    '{schema_version: "1.0", ts: $ts, tool: $tool, task_id: null, project_dir: $pr, args_summary: {file_path: $path}, verdict: "force_bypass", force_used: true}' \
    >> "$global/mcp-audit.jsonl" 2>/dev/null || true
}

# Check whether path P is a protected file AND covered by an mcp-managed marker
# OR a home-metrics path. Echoes the project root used for bypass-check.
check_protected() {
  local path="$1"
  # Home-metrics paths are always protected.
  if echo "$path" | grep -qE '\.claude/metrics/(pipeline|agent-feedback|mcp-audit)\.jsonl'; then
    echo "$HOME"
    return 0
  fi
  # Project-scoped paths require a .mcp-managed marker upchain.
  if echo "$path" | grep -qE '\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl)'; then
    find_marker_dir "$path" && return 0
    return 1  # no marker → fail-open
  fi
  return 1
}

case "$TOOL" in
  Write|Edit|MultiEdit|NotebookEdit)
    FP=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    [ -z "$FP" ] && exit 0
    if PROJECT_ROOT=$(check_protected "$FP"); then
      if bypass_allowed_for "$PROJECT_ROOT"; then
        audit_bypass "$TOOL" "$FP" "$PROJECT_ROOT"
        exit 0
      fi
      deny "Direct $TOOL on '$FP' is blocked. This file is managed by the claude-pipeline MCP server. Use mcp__claude-pipeline__* tools instead (pipeline_record_agent_run, pipeline_set_phase_status, pipeline_finish, ...). To temporarily unlock for debugging, call pipeline_unlock_writes({ttl_seconds, reason}); /done re-locks automatically."
    fi
    ;;
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    [ -z "$CMD" ] && exit 0
    # Only block when the command both *names* a protected file AND looks like a write.
    if ! echo "$CMD" | grep -qE "$PROTECTED_RE"; then
      exit 0
    fi
    writeop=0
    for pat in "${WRITE_OP_PATTERNS[@]}"; do
      if echo "$CMD" | grep -qE "$pat"; then
        writeop=1
        break
      fi
    done
    [ "$writeop" = "0" ] && exit 0
    # Extract the first protected absolute path mentioned for the bypass scope
    # check. Path must start with / (absolute) and end at a protected basename;
    # we exclude quote/paren chars so embedded calls like
    #   python -c "os.unlink('/tmp/x/.claude/pipeline-state.json')"
    # extract just `/tmp/x/.claude/pipeline-state.json`.
    PROTECTED_PATH=$(echo "$CMD" | grep -oE '/[^[:space:]"'"'"'\(\)]*\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl|metrics/[a-z-]+\.jsonl)' | head -1)
    if PROJECT_ROOT=$(check_protected "${PROTECTED_PATH:-/dev/null}"); then
      if bypass_allowed_for "$PROJECT_ROOT"; then
        audit_bypass "Bash" "$PROTECTED_PATH" "$PROJECT_ROOT"
        exit 0
      fi
      deny "Bash command appears to write to an MCP-managed file. Reads (cat/grep/jq) are fine; mutations must go through mcp__claude-pipeline__* tools. To temporarily unlock for debugging, call pipeline_unlock_writes({ttl_seconds, reason}); /done re-locks automatically. Command: $CMD"
    fi
    ;;
esac

exit 0
