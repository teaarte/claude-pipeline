---
mcp_protocol_required: "^2.0"
---

# /task — pure shuttle (≤30 lines, no orchestration logic)

> **Bundle resolution:** read `<project>/.claude/pipeline.config.json` if
> present (shape: `{"bundle": "<name>", ...}`); default `bundle: "code"`.
> Then read `mcp/src/driver/bundles/<bundle>/task-prompt.md` for the
> bundle's domain expectations (validation conventions, agent roles, model
> routing) — those inform how you should interpret subsequent shuttle
> responses for this project.

> **First-time setup (Q25):** `/task` writes ~10 working artifacts to
> `<project>/.claude/`. Pre-approve them by adding `"Write(.claude/**)"`
> under `permissions.allow` in `<project>/.claude/settings.local.json`.
> The guard hook still protects state-critical files inside `.claude/`.

Call `mcp__claude-pipeline__pipeline_run_task({project_dir: <cwd>, task: "$ARGUMENTS"})`, then loop:

- **`spawn-agent`** → invoke the `Task` tool with `claude_code_task` (verbatim params). Pass the result to `mcp__claude-pipeline__pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "agent-result", agent_run_id, agent_output}})`.
- **`spawn-agents-parallel`** → invoke `Task` for each spawn in parallel. Bundle results: `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "agents-results", results: [{agent_run_id, agent_output}, ...]}})`.
- **`ask-user`** → display `message` verbatim, capture user reply, parse it via the rules below, then `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "user-answer", decision, reject_intent?, message?}})`.

  **User-answer parsing (closes Q57; gate-2 disambiguation closes Q74):**
  - `1` / `a` / `accept` (case-insensitive, first token) → `{decision: "accept"}`
  - `2` / `r` / `reject [free-form text]` → `{decision: "reject", reject_intent: "revise", message: "<text>" or undefined}` — at gate-2 this walks the FSM back to the implementation phase entry and re-runs reviewers; at gate-0/gate-1 the `reject_intent` is ignored.
  - `abandon [free-form text]` (gate-2 only) → `{decision: "reject", reject_intent: "abandon", message: "<text>" or undefined}` — finalizes with `verdict: "rejected"`.
  - Anything else (including ambiguous prose like `"maybe"` or non-English keywords) → ask the user to clarify with `1` / `2` / `abandon`. Do NOT auto-classify.

- **`complete`** → display `summary`, suggest `/done`, stop.
- **`error`** → display `message` and `recovery_options`, ask user to pick one, `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "recovery", choice}})`.

**Do NOT:**
- interpret agent output (let the driver do it).
- decide complexity / tests_mode / agent selection / parallelism / retries.
- skip gates or human approvals.
- edit `.claude/pipeline-state.json`, `.claude/driver-state.json`, `findings.jsonl`, or any MCP-managed file directly — the guard hook will block you.
