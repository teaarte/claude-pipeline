# category-vocab.json — change notes

This file documents per-agent vocab additions and the real-task evidence that
prompted them. The vocab JSON itself doesn't support comments; record context
here so future agents (and humans) know *why* a category exists.

Promotion rules live inside `category-vocab.json` under `promotion_rules`.
The validation-log workflow ("Step 5 — Vocab evolution") is the upstream
loop that surfaces gaps.

## Additions

### v2.2-clear-bundle (Q29) — logic-reviewer

Added three categories to `vocab.logic-reviewer`, inserted before `"other"`:

- **`spec-deviation`** — code, tests, or docs diverge from the written spec.
  Example: "SPEC.md §3.2 declares Identity at `src/identity.ts`, but the
  implementation is colocated in `src/index.ts`."
  Also covers the `inconsistent-spec` natural label seen on validation run
  `t-2026-05-14-contextreadfirstinth`.
- **`scope-creep`** — work delivered exceeds the task scope.
  Example: "Lint/format pass added beyond DoD; PR now bundles unrelated
  cleanup with the fix."
- **`coverage-gap`** — tests miss a code path that should be exercised.
  Example: "Tests cover `createModuleWrapper` spread path but not
  `createModule` MF bridge path; both are reachable from the new entry."

### Audit of other reviewer vocabs

Real-task validation runs through 2026-05-14 surfaced vocab gaps **only** for
`logic-reviewer` (categories `inconsistent-spec`, `plan-incomplete`,
`spec-deviation`, `scope-creep`, `coverage-gap` all routed to `other`). All
other reviewer/validator agents had `category: "other"` rates ≤1/run; no
additions made. Re-audit each entry that adds a new "Vocab proposals" bullet.
