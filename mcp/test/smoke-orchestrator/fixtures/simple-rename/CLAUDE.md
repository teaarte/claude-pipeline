# simple-rename — smoke fixture

A minimal project used by the orchestrator smoke runner. The "task" is to
rename a function in src/foo.ts; the runner stubs every agent's output via
mock-agent-responses/. No real LLM calls.

Validation: pnpm tsc --noEmit (not actually invoked here; the smoke runner
asserts on pipeline-state shape after the driver completes).
