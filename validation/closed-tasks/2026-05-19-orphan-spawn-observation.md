# 2026-05-19 — Orphan spawn observation (Q75 / Q76 / Q77)

First real-task run of v2.2.7 on `OSC/frontend-core`. Task aborted in
context phase with rescuable state mismatch. Three new Q-items filed.

## What happened (timeline reconstructed from state files)

| Time | Event |
|---|---|
| ~19:32:20 | `ENRICH` step spawns `code-analyzer` → driver-state `pending_spawns[ar-65e11e59-...]` + pipeline-state `open_spawns[ar-65e11e59]`. CC receives a `spawn-agent` shuttle. |
| ~19:32-19:40 | Result for `ar-65e11e59` **never delivered** to `pipeline_continue_task`. Cause unknown (CC Task tool error / network / silent subagent abort). driver-state + pipeline-state both retain the orphan. |
| (between) | A third `code-analyzer` execution **did** successfully deliver via continue-task — pipeline-state `phases.context.agents[]` now contains `code-analyzer`, `agents_count = 2` (`classifier` + `code-analyzer`). |
| ~19:40:24 | A second `code-analyzer` open_spawn appears in pipeline-state: `ar-e0b477b1-...`. Likely from a CC re-attempt or a manual `pipeline_begin_agent` call as CC tried to "advance the driver". |
| Investigation | I asked CC to dump driver-state + pipeline-state via `cat | jq`. Three ar-ids surfaced for one logical agent across two state files. |
| Intervention | I stopped CC from calling `pipeline_begin_agent` again — its proposed "reserve a new agent_run_id matching the driver's pending spawn" is impossible by API and would have created a fourth orphan. |

## State snapshot at investigation time

**driver-state:**

```json
{
  "step_index": 4,
  "pending_spawns": {
    "ar-65e11e59-199b-4619-942f-628cce2787f6": {
      "agent": "code-analyzer",
      "phase": "context",
      "started_at": "2026-05-19T19:32:20.610Z",
      "model": "sonnet"
    }
  },
  "scratch_keys": [
    "__spawn_issued_classify-agent",
    "__spawn_issued_enrich",
    "agent_output_ar-4d816ab4-9a3c-47d6-905a-1b811f36f8d3",
    "bundleConfig",
    "complexity",
    "config",
    "gate-0_decision",
    "gate-0_mirrored",
    "tests_mode"
  ],
  "pending_user_answer": null
}
```

**pipeline-state.phases.context:**

```json
{
  "status": "in_progress",
  "agents": ["classifier", "code-analyzer"],
  "open_spawns": [{
    "id": "ar-e0b477b1-ba62-443e-a9d9-8f9dbab75964",
    "agent": "code-analyzer",
    "model": "sonnet",
    "started_at": "2026-05-19T19:40:24.139Z"
  }]
}
```

Three distinct ar-ids for one logical `code-analyzer` agent. Phase status
`in_progress` (correct), but the FSM can't progress because `step_index=4`
(`enrich`) and `pending_spawns` says it's still waiting on a result that
will never come.

## Q-items filed

**Q75 — 🔴 HIGH — continue-task agent-result not atomic on single-spawn path.**

The single-result delivery path has the same atomicity gap as Q52's batch
path. If CC fails to deliver the result through `pipeline_continue_task`
(network / abort / Task-tool error), no in-protocol cleanup exists.
`pending_spawns` and `open_spawns` accumulate orphans across both state
files. Recovery options today: `recovery: abandon` (lose progress) or
manual driver-state JSON edit (risky). No TTL-cleanup, no
`pipeline_validate` rule catches the duplicate.

**Fix (proposed):**
1. New continue-task recovery choice `cancel-pending` — drains
   `pending_spawns` + cancels matching `open_spawns` without abandoning
   the whole task.
2. New `pipeline_validate` rule: no duplicate `open_spawns` for the same
   `(phase, agent)` started < 30 min apart.
3. Skill markdown (`commands/task.md`) gains a "Recovery from observed
   state mismatch" section with the legitimate cleanup paths.

Estimated effort: ~4-6h.

**Q76 — 🟢 LOW — dead `__spawn_issued_<step>` scratch keys never cleaned.**

`spawnOne` ships an issued-key when it issues a spawn and deletes it only
in the resume short-circuit. But `continue-task` bumps `step_index` after
result delivery, so the spawning step never re-enters via runFSM in the
normal flow — the issued-key sits in scratch forever. Every run accumulates
5-10 dead keys. Not a behavior bug, but it complicates Q75-class diagnosis
because the orphan-id hides among legitimate stale scratch entries.

**Fix:** in `continue-task` agent-result / agents-results branches, also
delete `scratch.__spawn_issued_<stepName>` keys whose value matches the
consumed `agent_run_id`. ~1-2h.

**Q77 — 🟡 MEDIUM — CC's instinct to forge state via raw `pipeline_begin_agent`.**

When CC sees "driver-state and pipeline-state out of sync", it reaches for
the most-state-mutating MCP tool it knows. In this session it proposed
calling `pipeline_begin_agent` twice (paraphrased "reserve a new
agent_run_id matching the driver's pending spawn") — which is impossible
by API (it generates a fresh id, not matching anything) AND semantically
wrong (creates more orphans). Root cause: `commands/task.md` has no
"what to do when state looks broken" guidance, so CC reaches for raw tools.

**Fix (two layers):**
1. Skill markdown — new section listing the legitimate recovery paths and
   an explicit "NEVER call `pipeline_begin_agent` directly" warning.
2. Defensive guard in `pipeline_begin_agent` — refuse when
   `pipeline-state.<phase>.open_spawns[]` already has a matching
   `(agent, started_at < 5 min ago)` entry. Emit audit
   `error_class: "duplicate-spawn-attempt"`.

Estimated effort: ~3-4h.

## Recovery taken

`pipeline_continue_task({type: "recovery", choice: "abandon"})` — clean
slate; lost the in-progress task. Acceptable cost given it was the first
v2.2.7 real-task run and the goal was validation, not delivery.

## Why this matters for the v2.3 plan

v2.3 (daemon + Web UI + Anthropic-SDK provider) compounds this gap:
- The Web UI will let users click "Resume" on a task in this state — if Q75 isn't fixed, the click silently re-creates the same orphan.
- The Anthropic-SDK SpawnProvider runs in-process; result delivery failures will surface as exceptions inside `pipeline_continue_task` itself instead of "CC didn't call us" — Q75's atomicity gap moves from harness-layer to driver-layer.
- The Web UI MUST have a "Cancel pending spawn" button that calls the (future) `recovery: cancel-pending` choice. Today there's no such primitive.

**Recommendation:** close Q75 + Q77 **before** starting v2.3. Q76 can ride
along with v2.2-code-polish bundle (Q1-Q6) whenever convenient.

## Open questions for next investigation

- What caused the original `ar-65e11e59` result not to be delivered?
  Network drop, CC Task-tool error, subagent silent abort? Need CC's
  conversation log to confirm. Worth filing separately if it's a
  reproducible CC bug rather than a one-off.
- The third ar-id (the one that successfully landed `code-analyzer` in
  `phases.context.agents[]`) is not recorded anywhere — only its
  downstream effect. Should `phases.<phase>.agents[]` carry the
  successful ar-id alongside the agent name for forensics? Possibly
  a sub-LOW Q-item once Q75 is fixed.

## See also

- [`../../specs/open-backlog.md`](../../specs/open-backlog.md) — Q75 / Q76 / Q77 entries.
- [`../../specs/closed-q-items.md`](../../specs/closed-q-items.md) Q52 — sibling of Q75 (batch atomicity).
- [`../../specs/phases/v2.3-daemon-webui.md`](../../specs/phases/v2.3-daemon-webui.md) — phase that Q75/Q77 should land before.
