# Pre-/done validation analysis — pasteable prompt

Paste the **PROMPT START → PROMPT END** block below into a fresh Claude Code session right after pipeline reaches Gate 2 (or `pipeline_continue_task` returned `status=complete`) — **before running `/done`**.

The prompt is self-contained. The agent doing the analysis doesn't need prior context — only access to this repo + the project where `/task` ran.

---

## PROMPT START

You are running a validation analysis after a real-project `/task` completed. Goal: extract objective + subjective signals from `.claude/` and update the validation log + roadmap **before `/done` erases the evidence**.

### Critical rules
- **Do NOT run `/done` in this session.** The user will run it after you hand back. `/done` deletes per-project `.claude/*.jsonl` files we need for analysis.
- **Do NOT modify `.claude/` state files.** Read-only. The guard hook will block writes anyway.
- **Do NOT paraphrase from `driver-state.json` alone.** Run the actual `jq` queries from Step 2.

### Source of truth in the `claude-pipeline` repo
- `/Users/teaarte/Programming/internal/claude-pipeline/validation-log.md` — journal; self-contained header has the full extraction workflow.
- `/Users/teaarte/Programming/internal/claude-pipeline/specs/v3-productization-roadmap.md` — has "Validation-driven v2.1 backlog" table with Q1–Q15 already filed.

### Step 0 — Identify the current task
Ask the user (one-line answer each):
1. Absolute path of the project where `/task` ran (e.g. `/Users/teaarte/Work/AI-FACTORY/<repo>`)
2. One-line description of what the task was about

### Step 1 — Verify state files exist
```bash
ls <project>/.claude/
```
Expect at minimum: `pipeline-state.json`, `driver-state.json`, `findings.jsonl`, `mcp-audit.jsonl`. If any missing → surface to user; they may have already run `/done` accidentally. Continue with what's available.

### Step 2 — Extract objective signals
Open `/Users/teaarte/Programming/internal/claude-pipeline/validation-log.md`. Find section "Step 2 — Run these jq commands to extract the data" in its header. **Execute every jq command** with `PROJECT=<project from Step 0>`. Collect output blocks.

Pay particular attention to:
- Open spawns per phase (should be 0 — non-zero = atomic spawn-record contract leaked)
- Reviewer verdicts list — were ALL expected reviewers for complexity actually recorded? MEDIUM should see 5 in implementation phase (logic + challenger + style + security + performance); SIMPLE 2-3
- Audit verdict distribution — high `error` rate indicates Q11 recurrence
- Output size outliers per agent — flag any agent emitting > 2× its median
- `force_used: true` entries — what was forced and why

### Step 3 — Validate state via MCP
Call:
```
mcp__claude-pipeline__pipeline_validate({project_dir: "<project>"})
```
Any violations → surface to user. These will block `pipeline_finish` at `/done` and need recovery before user can close. Don't try to fix — just report.

### Step 4 — Subjective input from human
Ask the user (free-form answers fine):
1. Subjective rating 1-10
2. What worked well (1-3 bullets)
3. What annoyed / friction (1-3 bullets)
4. Gate interactions:
   - Gate 0: skipped / approved as-is / asked for re-classification
   - Gate 1: approved as-is / revised N times before accepting / rejected entirely
   - Gate 2: accepted / rejected with feedback
5. Bugs or glitches noticed during the run that aren't visible in logs (e.g. agent gave nonsense response, gate question was confusing, plan missed obvious thing)

### Step 5 — Append validation-log entry
Open `/Users/teaarte/Programming/internal/claude-pipeline/validation-log.md`. Find the "Entries (newest first)" section.

Insert a new `## t-...` heading at the **top** of that section (newest first ordering). Use the **Template** block also defined in that file. Replace placeholders with real data from Steps 1-4.

Bug list: for each bug from Step 4 (or anomaly from Step 2):
- Severity prefix: 🔴 HIGH (blocks further work) / 🟡 MEDIUM (degrades quality) / 🟢 LOW (cosmetic)
- Root cause hypothesis if you can
- File path in `mcp/src/...` likely owning the fix (best guess is fine)

### Step 6 — Classify bugs against roadmap (Q-items)
Open `/Users/teaarte/Programming/internal/claude-pipeline/specs/v3-productization-roadmap.md`. Find the "Validation-driven v2.1 backlog" table.

For each bug from Step 5:
- **Existing Q-item match** → in the log entry, mark as `(recurrence of Q<N>)`. **Do NOT add a roadmap row** — recurrences are the signal, not new entries.
- **New bug class** → add a new Q-row using the same format as Q7-Q15. Pick the next Q-number (currently Q16+). Include severity, description, effort estimate, file location, back-reference to the new log entry's `task_id`.

### Step 7 — Commit + push
```bash
cd /Users/teaarte/Programming/internal/claude-pipeline
git status --short    # confirm only validation-log.md + v3-productization-roadmap.md are modified
git add validation-log.md specs/v3-productization-roadmap.md
git commit -m "docs: validation entry for <task_id> + <Q-summary>"
git push origin main
```

Conventional commit subject. Example commit messages:
- `docs: validation entry for t-2026-05-15-feature + Q16 (new MEDIUM)`
- `docs: validation entry for t-2026-05-15-bugfix (3 recurrences, no new Q-items)`

### Step 8 — Hand back to user
Print a short summary with:
- task_id used in the log entry
- Bugs found: N new + N recurrences (list Q-numbers)
- `pipeline_validate` result: `ok` or list of violation codes
- Next step instruction:
  - If `ok` → "Ready for `/done` — run it now."
  - If violations → "Surface violations to user; pipeline_finish will refuse. Choose recovery path:\n  A. Fix upstream (e.g. for Q7 task_id, use pipeline_unlock_writes + manual fix)\n  B. force=true on offending tool call (records pipeline_violation)\n  C. pipeline_abandon (drops state, no metrics row)"

End the session. Do not run `/done`.

## PROMPT END

---

## Why this exists

After every real-task run, validation log + roadmap need to be updated. Doing it in the same session that ran `/task` is cognitively expensive (you just spent context on the task). A fresh session with this single-purpose prompt:
- Has clean attention budget for analysis
- Won't confuse "I did the work" with "I'm analyzing the work"
- Can't accidentally run `/done` and erase evidence

## When NOT to use this prompt

- The task crashed mid-flight (no Gate 2 reached, `verdict: null`, no `pending_user_answer`). Use `pipeline_abandon` directly, then write a log entry retrospectively from whatever survives.
- You already ran `/done` and per-project files are gone. Salvage what you can from `~/.claude/metrics/pipeline.jsonl` (one row) and your memory. Note `[partial — extracted post-/done]` in the entry.
- The task was on `claude-pipeline` itself (dogfooding). Don't pollute the validation log with self-referential entries — separate journal for those.
