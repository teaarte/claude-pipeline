# Sweep — Review & Fix Tech Debt

Review accumulated issues from pipeline runs and fix them.

**Filter:** $ARGUMENTS (optional — "high", "medium", "low", file path, or keyword to filter issues)

---

## Process

### 1. Find tech debt file
Check in order:
- CLAUDE.md KB reference → `{kb_path}/tech-debt.md`
- `docs/tech-debt.md` in project root

If neither exists: *"No tech debt file found. Issues are collected automatically during `/task` runs and saved by `/done`."*

### 2. Read and categorize
Read the file. Group issues by:
- **Severity:** high → medium → low
- **File location:** group nearby issues (same file/module = batch fix)
- **Staleness:** check if the referenced file:line still exists and the issue is still present. If the code was already fixed or the file was deleted → mark as RESOLVED.

### 3. Present summary

```
Tech Debt Summary — {project}

Total: {N} issues ({N} high, {N} medium, {N} low)
Resolved (auto-detected): {N} — will be cleaned up

Issues by area:
  src/admin_api/    — {N} issues
  src/grpc_server/  — {N} issues
  camunda/workers/  — {N} issues

Top 5 actionable:
1. [HIGH] {file:line} — {description} (found by: {agent})
2. [MEDIUM] {file:line} — {description}
3. ...
```

### 4. Ask what to do

Present options:
- **"fix all high"** → batch fix all high-severity issues via `/quick` for each
- **"fix N"** → fix issue #N specifically
- **"fix {path}"** → fix all issues in that file/directory
- **"clean"** → remove all RESOLVED entries from the file
- **"skip"** → just review, don't fix anything

### 5. Fix issues

For each issue to fix:
1. Read the file and surrounding context
2. If it's a simple fix (typo, missing error handling, dead code) → fix directly
3. If it's complex (refactoring, new pattern) → suggest running `/task` instead
4. After fixing, remove the issue from the tech debt file
5. Run validation commands after all fixes

### 6. Report

```
Sweep Complete

Fixed:    {N} issues
Deferred: {N} (need /task)
Cleaned:  {N} resolved entries removed
Remaining: {N} issues in tech debt

Suggested commit:
  chore: fix {N} tech debt issues ({short list})
```

---

## Rules
- Never fix issues that affect current functionality without understanding context
- For multi-file refactors → suggest `/task`, don't attempt in sweep
- Always run validation after fixes
- Remove fixed entries from tech debt file immediately
