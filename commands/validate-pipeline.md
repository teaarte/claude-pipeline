# Validate Pipeline — Self-Test

Run integrity checks on the pipeline configuration. No arguments needed.

---

## Checks

### 1. Agent Files
For each agent in `~/.claude/agents/*.md`:
- File exists and is non-empty
- Reviewer/validator agents contain `<!-- STATUS:` in their output template (machine-parseable)
- No references to non-existent files (grep for paths like `~/.claude/agents/` and verify targets exist)

### 2. Pipeline Files
For each pipeline in `~/.claude/pipelines/*.md`:
- All referenced agent paths exist (e.g. `~/.claude/agents/planner.md`)
- STEP numbers are sequential (sub-steps like 5b are allowed, no major gaps or duplicates)
- At least one Human Gate exists

### 3. Command Files
For each command in `~/.claude/commands/*.md`:
- All referenced agent/pipeline/template paths exist
- No references to deleted agents (e.g. cost-estimator.md)

### 4. Templates
- `~/.claude/templates/pipeline-state.md` exists
- `~/.claude/templates/agent-output-formats.md` exists
- Agent output formats table matches actual agent files (same status values)

### 5. Model Routing Consistency
- Model routing table in `task.md` lists all agents that appear in pipeline files
- No agent appears in pipeline files but missing from routing table
- No agent in routing table that doesn't exist as a file

### 6. Metrics Integrity
- `~/.claude/metrics/pipeline.md` — header row matches expected columns
- `~/.claude/metrics/agent-feedback.md` — header row matches expected columns

## Output

```
Pipeline Validation Report

Agents:        [N] found, [N] valid, [N] issues
Pipelines:     [N] found, [N] valid, [N] issues
Commands:      [N] found, [N] valid, [N] issues
Templates:     [N] found, [N] valid, [N] issues
Model Routing: [PASS/FAIL]
Metrics:       [PASS/FAIL]

Issues:
- [file]: [description of issue]
- ...

Overall: [PASS / N issues found]
```

If PASS: *"Pipeline configuration is consistent."*
If issues: list each with suggested fix.
