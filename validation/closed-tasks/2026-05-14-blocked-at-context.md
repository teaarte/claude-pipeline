## t-2026-05-14-blocked-at-context — second real-task attempt, blocked at context phase

> **✓ RESOLVED 2026-05-14 by v2.1-hotfix bundle:**
> - Q16 fixed in commit `98b9f45` (`fix(driver): Q16 — force subagent_type=general-purpose for Task tool`).
> - Q7 fixed in commit `4ea0c9f` (`fix(init): Q7 — sanitize task_id slug to match schema pattern`).
> - Q12 fixed in commit `4e2527b` (`fix(done): Q12 — wrap cleanup with pipeline_unlock_writes/relock_writes`).
> - Q15 added new tool `pipeline_fix_task_id` in commit `baa253e` for clean task_id recovery.
> - Q13 subsumed by Q12 (`pipeline_relock_writes` already unlinks the bypass marker).
> - Tests: 180 → 209 (+29). Pipeline now functional end-to-end for real tasks.
> - Remaining Q-items (Q8, Q9, Q10, Q11, Q14) deferred to v2.1 polish bundle.

- **Project:** `~/Work/AI-FACTORY/s3-panel` (likely; second `/task` attempted)
- **Complexity (auto):** medium (presumed — didn't reach Gate 0 confirmation)
- **Wall time:** <5min — blocked before context enrichment completed
- **Verdict:** **INCOMPLETE — never reached Gate 1.** Context phase failed to spawn `code-analyzer`, then `context-doc-verifier`. Pipeline stuck on `pipeline_begin_agent` succeeding but the subsequent `Task` tool invocation failing.
- **Subjective rating:** N/A — couldn't run.

### What worked
- `pipeline_begin_agent` succeeded (open_spawn registered, agent_run_id minted).
- Driver correctly proceeded to issue shuttle response with `claude_code_task` payload.

### What failed
- Shuttle invoked `Task` tool with `subagent_type: "code-analyzer"` and later `subagent_type: "context-doc-verifier"`.
- Claude Code's `Task` tool rejected both with: *"Agent type '<X>' not found. Available agents: claude-code-guide, Explore, fe-test-all-agent, general-purpose, Plan, runtime-debug-agent, statusline-setup, test-all-agent"*.

### Bug found — Q16 (NEW, 🔴 CRITICAL — see roadmap)

The driver's spawn payload puts the AgentPlugin name (`code-analyzer`, `context-doc-verifier`) as Claude Code's `subagent_type`. But CC's `Task` tool only accepts its internal subagent_type catalog — none of our plugin names match.

**v2 design intent:** `subagent_type` should always be `"general-purpose"` (CC's catch-all), and the actual AgentPlugin role + template content lives in the **prompt text**. Currently broken somewhere in `mcp/src/driver/builtin/spawn/shuttle-provider.ts` or whichever code constructs `claude_code_task`.

**Severity: CRITICAL.** Blocks all real-task validation. Any agent whose plugin name doesn't accidentally match CC's catalog (= ~all of them) → spawn fails → pipeline stuck.

### Action items
- **Cannot continue validation until Q16 is fixed.** Other Q-items don't matter if no task can complete.
- This blocked task should be **abandoned** (`pipeline_abandon`) — state has dangling open_spawns from failed Task invocations, no clean recovery.
- v2.1 priority restructured: **Q16 first as standalone hotfix**, ~1-2h. Then continue validation. Q1-Q15 stay bundled for the later polish round.

### Recovery for current state
1. `pipeline_abandon({project_dir, reason: "Q16 blocks all spawns — no recovery"})` 
2. After Q16 hotfix lands → resume validation with fresh `/task`.
