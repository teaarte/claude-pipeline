# Hooks — Mechanical Guardrails

Two Claude Code hooks that turn soft "never edit pipeline-state.json" markdown rules into hard, deterministic blocks. Both work standalone but are intended to live alongside the `claude-pipeline` MCP server.

| Hook | Event | Role |
|------|-------|------|
| `pipeline-guard.sh` | `PreToolUse` | Denies `Write`/`Edit`/`MultiEdit`/`NotebookEdit` and write-shaped `Bash` calls that target MCP-managed files. |
| `pipeline-stop.sh`  | `Stop`       | Blocks session-stop once when a pipeline is still in flight (`verdict=null`), telling Claude to run `/done` first. Falls back to stderr-only on the second stop. |

## What `pipeline-guard.sh` blocks

Protected files (all owned by the MCP server, never the orchestrator or any agent):

- `<project>/.claude/pipeline-state.json`
- `<project>/.claude/pipeline-state-summary.md`
- `<project>/.claude/findings.jsonl`
- `~/.claude/metrics/pipeline.jsonl`
- `~/.claude/metrics/agent-feedback.jsonl`

Reads (`cat`, `jq <file>`, `grep`, `wc`, etc.) pass through.

Write-shaped Bash that gets caught:
- Redirects: `>`, `>>`, `>|`, `&>`, `&>>`
- Pipe to writer: `| tee`
- In-place editors: `sed -i`, `awk -i`
- File mutators: `cp`, `mv`, `rm`, `truncate`, `install`, `chmod`, `chown`

Output on a denied tool call:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Direct Write on '.../pipeline-state.json' is blocked. ..."
  }
}
```

Escape hatch: set `PIPELINE_ALLOW_RAW=1` in the env (intended for MCP-author debugging only — normal pipeline work should never need it).

## What `pipeline-stop.sh` blocks

When `.claude/pipeline-state.json` exists with `verdict=null` AND `stop_hook_active=false`, the hook emits:

```json
{
  "decision": "block",
  "reason": "Pipeline is in flight at step \"<step>\" with verdict=null. Run /done to finalize the task — this calls mcp__claude-pipeline__pipeline_finish, appends metrics, and cleans .claude/ working files. If you genuinely want to abandon the task, call mcp__claude-pipeline__pipeline_finish with verdict=\"rejected\" and then re-stop."
}
```

This pushes Claude back into the conversation so it must finish properly. On the second stop attempt (`stop_hook_active=true`) the hook falls back to stderr diagnostics, so a stuck session can still be closed. `PIPELINE_ALLOW_RAW=1` also forces stderr-only mode.

## Install

Both hooks live in this repo as the authoritative source. To activate them, register their paths in `~/.claude/settings.json`. Either copy the scripts into `~/.claude/hooks/` or symlink to the repo copies — symlinks are recommended so future repo edits propagate without manual sync.

```bash
# Pick ONE of these per hook.

# (A) Copy:
mkdir -p ~/.claude/hooks
cp hooks/pipeline-guard.sh ~/.claude/hooks/
cp hooks/pipeline-stop.sh  ~/.claude/hooks/
chmod +x ~/.claude/hooks/pipeline-*.sh

# (B) Symlink (preferred when you maintain the repo locally):
mkdir -p ~/.claude/hooks
ln -sfn "$PWD/hooks/pipeline-guard.sh" ~/.claude/hooks/pipeline-guard.sh
ln -sfn "$PWD/hooks/pipeline-stop.sh"  ~/.claude/hooks/pipeline-stop.sh
```

Then merge the relevant fragments from [`../settings.reference.json`](../settings.reference.json) into your `~/.claude/settings.json` — specifically the `PreToolUse` matcher entry for `Write|Edit|MultiEdit|NotebookEdit|Bash` pointing at `pipeline-guard.sh`, and the `Stop` block pointing at `pipeline-stop.sh`. Paths must be absolute.

Verify with:

```bash
# Guard: should print a deny JSON.
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/.claude/pipeline-state.json","content":"x"}}' \
  | bash ~/.claude/hooks/pipeline-guard.sh

# Stop: should pass through silently when no state file is present.
echo '{"cwd":"/tmp","stop_hook_active":false}' | bash ~/.claude/hooks/pipeline-stop.sh
```

## Requirements

- `jq` on PATH (used by both hooks for JSON parsing).
- Claude Code with hook support (PreToolUse + Stop events, JSON output protocol).

If `jq` is missing the guard hook fails open (does not block) rather than locking up your session — same posture as the existing RTK hook.
