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
- **`ask-user`** → display `message` verbatim, capture user reply, `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "user-answer", answer}})`.
- **`complete`** → display `summary`, suggest `/done`, stop.
- **`error`** → display `message` and `recovery_options`, ask user to pick one, `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "recovery", choice}})`.

**Do NOT:**
- interpret agent output (let the driver do it).
- decide complexity / tests_mode / agent selection / parallelism / retries.
- skip gates or human approvals.
- edit `.claude/pipeline-state.json`, `.claude/driver-state.json`, `findings.jsonl`, or any MCP-managed file directly — the guard hook will block you.
