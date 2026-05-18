# Code bundle — `/task` shuttle preamble

Injected by `commands/task.md` before forwarding control to `pipeline_run_task`.
Future bundles (marketing, tiktok, research, etc.) ship their own
`task-prompt.md` with domain-specific shuttle context.

## Domain expectations

- Project is a code repository. Validation = `lint` + `typecheck` + `test`,
  per the project's CLAUDE.md "Validation Commands" section.
- The pipeline's reviewer / validator agents (`logic-reviewer`,
  `style-reviewer`, `security`, `performance`, `acceptance`, …) are tuned
  for code-quality output (findings.jsonl, blocking severity, file:line
  citations).
- `state.tests_mode ∈ {tdd, regression-only}` — TDD gates require red→green
  cycle before implementer touches non-test code.
- `state.stack` carries language + package-manager + lint/test/build commands
  (auto-detected at init via `decisions/stack-detect.ts`).

## Agent role hierarchy

- **planner / implementer / architect** — non-review agents (write plan,
  write code, write architecture doc).
- **logic / challenger / style / security / performance / api-contract /
  ui-consistency / dependency-auditor / plan-conformance / playwright** —
  reviewer agents emitting `reviewer-output.schema.json` findings.
- **acceptance / test** — validator agents emitting
  `validator-output.schema.json` pass/fail with details.

## Model routing (`bundles/code/agents/resolve-model.ts`)

- Default models: context phase → sonnet, planning → opus, test_first →
  sonnet, implementation → opus, validation → haiku, final → haiku.
- Override via `config.agent_overrides[<agent>].model` if a particular
  agent benefits from a non-default model (e.g. security → opus).

## Bundle-specific output artefacts

- `issues-found.md` — tech-debt surfaced during the run; flushed into
  `<kb>/tech-debt.md` at `/done`.
- `findings.jsonl` — append-only, schema-validated per finding.
- `pipeline-state-summary.md` — human-readable mirror of state.
