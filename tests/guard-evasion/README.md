# Guard evasion fixtures

Each `.json` file is a `tool_input` payload that pipeline-guard.sh receives.
The test `mcp/test/guard-evasion.test.ts` pipes each one into the guard and
asserts the guard returned a `deny` decision.

These are real or near-real bypass attempts that were caught (or would have
been missed by an earlier version of the guard). New evasions should land
here first as a failing fixture before the guard regex is widened.
