# Code Review

Run a multi-agent code review on all changes in the current session.

---

## Process

### 1. Collect changes
Run `git diff` (full diff, not just names) and `git diff --name-only` to get both the diff content and file list.
If no changes found, check `git diff --cached` and `git status`.
If still nothing — tell the user there's nothing to review.

### 2. Read CLAUDE.md
Load project conventions — reviewers need this as context.

### 3. Spawn 5 review agents in parallel

All agents receive: `git diff` output + list of changed files + CLAUDE.md conventions.
Passing the diff (not just file names) focuses reviewers on actual changes.

| Agent | Model | File |
|-------|-------|------|
| Logic Reviewer | opus | `~/.claude/agents/logic-reviewer.md` |
| Style Reviewer | sonnet | `~/.claude/agents/style-reviewer.md` |
| Security Agent | sonnet | `~/.claude/agents/security.md` |
| Performance Agent | sonnet | `~/.claude/agents/performance.md` |
| Dependency Auditor | sonnet | `~/.claude/agents/dependency-auditor.md` |

Each agent should review **code** (not plans) — pass them the "For Code" instructions.

### 4. Collect results

Parse each agent's `<!-- STATUS: X -->` line.

### 5. Present summary

```
# Code Review Results

| Reviewer     | Verdict          | Blocking | Non-blocking |
|-------------|------------------|----------|--------------|
| Logic       | APPROVE/CHANGES  | N        | N            |
| Style       | APPROVE/CHANGES  | N        | N            |
| Security    | APPROVE/CHANGES  | N        | N            |
| Performance | APPROVE/CHANGES  | N        | N            |
| Dependency  | —                | N/A      | N/A          |

## Blocking Issues
- [ ] {issue + which reviewer + suggested fix}

## Non-Blocking Issues
- {issue}

## Dependency Impact
{summary from dependency auditor}
```

### 6. If blocking issues found
Ask: *"N blocking issues found. Fix them now?"*
If yes — fix all blocking issues, then re-run only the reviewer(s) that flagged them.
Max 2 fix iterations.

### 7. Clean exit
When all reviewers approve (or only non-blocking remain):
*"Code review passed. Run `/done` to update KB and clean up?"*
