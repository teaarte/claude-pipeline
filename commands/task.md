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

- **`spawn-agent`** → read `spawn_request.runner_hint`. When `"claude-code-task"`, invoke the Claude Code `Task` tool with `{subagent_type: spawn_request.extras.subagent_type, description: spawn_request.description, prompt: spawn_request.prompt, model: spawn_request.model}`. Pass the result to `mcp__claude-pipeline__pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "agent-result", agent_run_id, agent_output}})`. Other runner_hint values belong to non-CC harnesses (daemon SDK, Cursor adapter, etc.); a non-CC skill markdown owns that translation.
- **`spawn-agents-parallel`** → for each spawn, follow the spawn-agent translation above (read `spawn_request.runner_hint` → invoke the right harness primitive). Bundle results: `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "agents-results", results: [{agent_run_id, agent_output}, ...]}})`.
- **`ask-user`** → display `message` verbatim, capture user reply, parse it via the rules below, then `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "user-answer", decision, reject_intent?, message?}})`.

  **User-answer parsing (closes Q57; gate-2 disambiguation closes Q74; gate-1 auto-apply closes Q69):**

  At **gate-0** and **gate-2**:
  - `1` / `a` / `accept` (case-insensitive, first token) → `{decision: "accept"}`
  - `2` / `r` / `reject [free-form text]` → `{decision: "reject", reject_intent: "revise", message: "<text>" or undefined}` — at gate-2 this walks the FSM back to the implementation phase entry and re-runs reviewers; at gate-0 the `reject_intent` is ignored.
  - `abandon [free-form text]` (gate-2 only) → `{decision: "reject", reject_intent: "abandon", message: "<text>" or undefined}` — finalizes with `verdict: "rejected"`.

  At **gate-1** (Q69 / D8 — the message may contain a "Suggested revision" block auto-derived from reviewer findings):
  - `1` / `a` / `auto-apply` → `{decision: "auto-apply"}` — pipeline re-spawns planner using the suggested revision block as the gate-1-reject message. No user-typed text needed.
  - `2` / `accept` / `accept-anyway` → `{decision: "accept"}` — accept the plan despite the reviewer findings (the human explicitly overrides).
  - `3` / `edit <text>` → `{decision: "reject", message: "<text>"}` — user replaces the auto-derived feedback with their own text before reject.
  - `4` / `reject <msg>` → `{decision: "reject", message: "<msg>" or undefined}` — free-text reject; ignores the auto-derived block.
  - If the gate-1 message contains NO suggested-revision block (no planning findings), fall back to the gate-0 parse rules (`1/accept`, `2/reject`).

  Anything else (including ambiguous prose like `"maybe"` or non-English keywords) → ask the user to clarify with the gate-specific verbs above. Do NOT auto-classify.

- **`complete`** → display `summary`, suggest `/done`, stop.
- **`error`** → display `message` and `recovery_options`, ask user to pick one, `pipeline_continue_task({project_dir, driver_state_id, input: {driver_state_id, type: "recovery", choice}})`.

**Do NOT:**
- interpret agent output (let the driver do it).
- decide complexity / tests_mode / agent selection / parallelism / retries.
- skip gates or human approvals.
- edit `.claude/pipeline-state.json`, `.claude/driver-state.json`, `findings.jsonl`, or any MCP-managed file directly — the guard hook will block you.
