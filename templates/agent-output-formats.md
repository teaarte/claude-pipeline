# Agent Output Format Standards (v1.0)

Reviewer and validator agents emit a fenced ```json header validated against `templates/schemas/{reviewer,validator}-output.schema.json`, followed by markdown narrative. The JSON header is the source of truth for machine fields; the markdown is for human reading.

```
```json
{ "schema_version": "1.0", "agent": "<name>", "task_id": "...", "iteration": N, "verdict": "...", "summary_line": "...", "findings": [...] }
```
# <Agent> Review
... markdown narrative ...
```

## Valid Verdicts

| Agent | Valid Verdicts |
|-------|----------------|
| Logic Reviewer | APPROVE, REQUEST_CHANGES |
| Challenger Reviewer | APPROVE, REQUEST_CHANGES |
| Style Reviewer | APPROVE, REQUEST_CHANGES |
| Security Agent | APPROVE, REQUEST_CHANGES, WARN |
| Performance Agent | APPROVE, REQUEST_CHANGES, WARN |
| Acceptance Agent | PASS, FAIL, PASS_WITH_WARNINGS |
| Test Agent (test-first) | RED, ERROR |
| Test Agent (test-after) | PASS, FAIL |
| API Contract Agent | APPROVE, REQUEST_CHANGES |
| Playwright Agent | PASS, FAIL |
| UI Consistency Agent | APPROVE, REQUEST_CHANGES |
| Plan Grounding Check | GROUNDED, NEEDS_REVISION, NO_CITATIONS |
| Context-Doc Verifier | VERIFIED, NEEDS_RERUN, WARN |
| Plan Conformance | CONFORMS, DRIFT, PARTIAL |

## Agents Without JSON Headers

These produce data documents, not verdicts:

| Agent | Output |
|-------|--------|
| Dependency Auditor | `.claude/dependency-audit.md` |
| Code Analyzer | `.claude/context-doc.md` + `.claude/analyzer-claims.json` |
| Architect | `.claude/architecture-decisions.md` |
| Planner | `.claude/plan.md` |
| Implementer | Inline completion report |
| Research | `.claude/research-report.md` |
| Migration | `.claude/migration-plan.md` |

## Parsing Rules

1. Extract the first fenced ```json block in the agent output. Validate against `reviewer-output.schema.json` (reviewers) or `validator-output.schema.json` (validators).
2. On validation failure → ask the agent to re-emit ONCE. If still invalid → log `pipeline_violation: invalid-schema-output` and surface the error to the human at the next gate.
3. The `verdict` field drives flow control:
   - `REQUEST_CHANGES` / `FAIL` / `DRIFT` / `NEEDS_REVISION` / `NEEDS_RERUN` → blocking; route per pipeline rules.
   - `WARN` / `PASS_WITH_WARNINGS` → non-blocking; surface to human at next gate.
   - `APPROVE` / `PASS` / `CONFORMS` / `GROUNDED` / `VERIFIED` / `NO_CITATIONS` → proceed.
4. The `findings[]` array is appended to `.claude/findings.jsonl` as a stream — one JSON object per line.
5. The `summary_line` lands in `.claude/pipeline-state.json` `reviewer_verdicts[].summary_line` for at-a-glance.
