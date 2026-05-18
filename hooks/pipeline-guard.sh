#!/usr/bin/env bash
# pipeline-guard.sh — PreToolUse hook that blocks direct writes to MCP-managed files.
#
# Protected paths:
#   * <project>/.claude/{pipeline-state.json, pipeline-state-summary.md,
#       findings.jsonl, mcp-audit.jsonl, driver-state.json,
#       .mcp-managed, .mcp-bypass-allowed}
#   * ~/.claude/metrics/{pipeline,agent-feedback,mcp-audit}.jsonl
#
# Scoping: project paths are protected when a `.mcp-managed` marker exists
# in the project root (created by pipeline_init). Home-metrics paths are
# always protected.
#
# Bypass: <project>/.claude/.mcp-bypass-allowed{expires_at, ...} created by
# pipeline_unlock_writes. Guard honors only while now < expires_at AND
# (expires_at - issued_at) <= UNLOCK_MAX_TTL_SECONDS.
#
# Performance: protected-path short-circuit uses bash `[[ =~ ]]` (no subshell),
# saving ~15ms per Bash call where the pattern doesn't match.

if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ -z "$TOOL" ] && exit 0

# Match-on-substring; covers the protected basenames in <proj>/.claude/ and
# ~/.claude/metrics/. driver-state.json, .mcp-managed, .mcp-bypass-allowed
# added per Challenger guard01 — losing the marker or forging the bypass
# would silently disable enforcement.
PROTECTED_RE='(\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl|driver-state\.json|\.mcp-managed|\.mcp-bypass-allowed))|(\.claude/metrics/(pipeline|agent-feedback|mcp-audit)\.jsonl)'

UNLOCK_MAX_TTL_SECONDS=3600

# Write-op detection. Each entry must pair with PROTECTED_RE in the command.
# Loosened mutator anchor `[^[:alnum:]_]` lets quoted/paren'd `rm` inside
# `bash -c "rm ..."` or `$(rm ...)` fire (Security sec001).
WRITE_OP_PATTERNS=(
  '(^|[^0-9])>{1,2}'
  '(^|[[:space:]])tee([[:space:]]|$)'
  '\|[[:space:]]*tee([[:space:]]|$)'
  '(^|[[:space:]])sed[[:space:]]+-i'
  '(^|[[:space:]])awk[[:space:]]+-i'
  '(^|[^[:alnum:]_/.])(cp|mv|rm|truncate|install|chmod|chown|Remove-Item|Set-Content|Add-Content|Out-File)([^[:alnum:]_]|$)'
  '(^|[[:space:]])(gzip|gunzip|bzip2|xz|zstd)[[:space:]]'
  '(^|[[:space:]])find[[:space:]]+.*(-delete|-exec[[:space:]]+(rm|mv|cp|truncate))'
  # bash/sh/zsh -c is handled separately below — we still recognise the form
  # but only flag as write-op if the body itself contains an inner mutator
  # (H7). A bare `bash -c "cat foo"` was being denied as a write.
  '(^|[[:space:]])(pwsh|powershell)[[:space:]]+-(c|Command)[[:space:]]'
  '(^|[[:space:]])eval[[:space:]]'
  'python(3)?[[:space:]]+-c[[:space:]].*(unlink|remove|rmtree|os\.remove|os\.unlink|shutil\.rmtree|os\.system|subprocess\.|popen|Path\([^)]*\)\.(write_text|write_bytes|unlink)|open[[:space:]]*\([^)]*['\''"](w|a))'
  'node(js)?[[:space:]]+-e[[:space:]].*(unlinkSync|writeFileSync|appendFileSync|rmSync|truncateSync|createWriteStream|fs\.promises\.(writeFile|unlink|appendFile|rm|truncate))'
  'deno[[:space:]]+(run[[:space:]]+)?(-A[[:space:]]+)?-e[[:space:]].*(removeSync|writeTextFileSync|writeFileSync|truncateSync|Deno\.remove|Deno\.writeFile)'
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
# root. Echoes the marker dir on success, empty on failure. NEAREST marker
# wins (Security sec005 — a parent bypass must not implicitly unlock a child
# project with its own marker).
find_marker_dir() {
  local p="$1"
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
      echo "$(dirname "$dir")"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

# Returns 0 if the bypass marker is present, unexpired, AND its claimed TTL
# is within UNLOCK_MAX_TTL_SECONDS of issued_at (or never-issued falls back
# to expires_at within now+max). Defends against forged markers with
# expires_at=9999 (Challenger guard02).
bypass_allowed_for() {
  local project_root="$1"
  local marker="$project_root/.claude/.mcp-bypass-allowed"
  [ -f "$marker" ] || return 1
  local exp iss now
  exp=$(jq -r '.expires_at // empty' < "$marker" 2>/dev/null)
  iss=$(jq -r '.issued_at // empty' < "$marker" 2>/dev/null)
  [ -z "$exp" ] && return 1
  local exp_epoch
  if exp_epoch=$(date -u -d "$exp" +%s 2>/dev/null); then
    :
  elif exp_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${exp%%.*}" +%s 2>/dev/null); then
    :
  else
    return 1
  fi
  now=$(date +%s)
  [ "$now" -lt "$exp_epoch" ] || return 1
  if [ -n "$iss" ]; then
    local iss_epoch
    if iss_epoch=$(date -u -d "$iss" +%s 2>/dev/null); then
      :
    elif iss_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${iss%%.*}" +%s 2>/dev/null); then
      :
    else
      return 1
    fi
    local span=$((exp_epoch - iss_epoch))
    [ "$span" -le "$UNLOCK_MAX_TTL_SECONDS" ] || return 1
  else
    # No issued_at — accept only if exp is within max TTL of now.
    local span=$((exp_epoch - now))
    [ "$span" -le "$UNLOCK_MAX_TTL_SECONDS" ] || return 1
  fi
  return 0
}

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

check_protected() {
  local path="$1"
  if echo "$path" | grep -qE '\.claude/metrics/(pipeline|agent-feedback|mcp-audit)\.jsonl'; then
    echo "$HOME"
    return 0
  fi
  if echo "$path" | grep -qE '\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl|driver-state\.json|\.mcp-managed|\.mcp-bypass-allowed)'; then
    find_marker_dir "$path" && return 0
    return 1
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
      deny "Direct $TOOL on '$FP' is blocked. This file is managed by the claude-pipeline MCP server. Use mcp__claude-pipeline__* tools instead. To temporarily unlock for debugging, call pipeline_unlock_writes({ttl_seconds, reason}); /done re-locks automatically."
    fi
    ;;
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    [ -z "$CMD" ] && exit 0
    # Fast bash-builtin short-circuit (Perf W2). Avoids fork+grep on ~95% of
    # Bash calls where the protected pattern doesn't match. Two paths:
    #   (a) contiguous: `.claude/<protected-basename>` mentioned directly.
    #   (b) split: `.claude` directory + a protected basename appear
    #       separately (e.g. `find /x/.claude -name pipeline-state.json`).
    PROT_BASENAMES_RE='(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl|driver-state\.json|\.mcp-managed|\.mcp-bypass-allowed|metrics/(pipeline|agent-feedback|mcp-audit)\.jsonl)'
    if ! [[ "$CMD" =~ \.claude/$PROT_BASENAMES_RE ]]; then
      if ! { [[ "$CMD" =~ \.claude($|[/[:space:]]) ]] && [[ "$CMD" =~ $PROT_BASENAMES_RE ]]; }; then
        exit 0
      fi
    fi
    writeop=0
    for pat in "${WRITE_OP_PATTERNS[@]}"; do
      if echo "$CMD" | grep -qE "$pat"; then
        writeop=1
        break
      fi
    done
    # H7: bash/sh/zsh -c body inspection. Recognise the shell form, but only
    # deny when the body itself contains an inner mutator. A `bash -c "cat …"`
    # invocation is a read and must pass through.
    if [ "$writeop" = "0" ] && echo "$CMD" | grep -qE '(^|[[:space:]])(bash|sh|zsh)[[:space:]]+-c[[:space:]]'; then
      # Extract bodies (double-quoted, single-quoted, or single unquoted token).
      bodies=$(echo "$CMD" | grep -oE '(bash|sh|zsh)[[:space:]]+-c[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)' \
        | sed -E 's/^[[:space:]]*(bash|sh|zsh)[[:space:]]+-c[[:space:]]+//' \
        | sed -E 's/^"(.*)"$/\1/' \
        | sed -E "s/^'(.*)'\$/\\1/")
      while IFS= read -r body; do
        [ -z "$body" ] && continue
        # Inner mutator list per H7 — anything else is a read.
        if echo "$body" | grep -qE '(^|[^[:alnum:]_])(rm|mv|cp|truncate|eval)([[:space:]]|$)' \
          || echo "$body" | grep -qE '(^|[^0-9])>{1,2}' \
          || echo "$body" | grep -qE '(^|[[:space:]])dd[[:space:]]+.*\b(if|of)=' \
          || echo "$body" | grep -qE '(^|[[:space:]])(perl|python3?|node)[[:space:]]+-(e|c)([[:space:]]|$)'; then
          writeop=1
          break
        fi
      done <<EOF
$bodies
EOF
    fi
    [ "$writeop" = "0" ] && exit 0
    # Extract first protected path: absolute (leading /) OR relative
    # (.claude/ at start of token). For relative we prepend $PWD so the
    # marker walk has a real ancestor chain (Security sec003).
    PROTECTED_PATH=$(echo "$CMD" | grep -oE '/[^[:space:]"'"'"'\(\)]*\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl|driver-state\.json|\.mcp-managed|\.mcp-bypass-allowed|metrics/[a-z-]+\.jsonl)' | head -1)
    if [ -z "$PROTECTED_PATH" ]; then
      REL_PATH=$(echo "$CMD" | grep -oE '(^|[^/[:alnum:]_])(\.claude/(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl|driver-state\.json|\.mcp-managed|\.mcp-bypass-allowed))' | head -1 | sed -E 's/^[^/.]+//')
      if [ -n "$REL_PATH" ]; then
        PROTECTED_PATH="$PWD/$REL_PATH"
      fi
    fi
    if [ -z "$PROTECTED_PATH" ]; then
      # Split-form path (find /x/.claude -name pipeline-state.json -delete).
      # Extract the .claude directory reference; the protected basename
      # appears elsewhere on the line. Use a synthetic path-under-marker so
      # check_protected + find_marker_dir resolve to the project root.
      CLAUDE_DIR=$(echo "$CMD" | grep -oE '/[^[:space:]"'"'"'\(\)]*\.claude($|[/[:space:]])' | head -1 | sed -E 's#[/[:space:]]*$##')
      BASENAME=$(echo "$CMD" | grep -oE '(pipeline-state\.json|pipeline-state-summary\.md|findings\.jsonl|mcp-audit\.jsonl|driver-state\.json|\.mcp-managed|\.mcp-bypass-allowed)' | head -1)
      if [ -n "$CLAUDE_DIR" ] && [ -n "$BASENAME" ]; then
        PROTECTED_PATH="$CLAUDE_DIR/$BASENAME"
      fi
    fi
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
