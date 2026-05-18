# specs/done/

Archive of completed launcher prompts and one-shot specs. Each file here was a single-session pasteable prompt that was executed in a fresh Claude Code session and merged into `main`.

Kept for historical reference: what was promised in the prompt, what deviations occurred (documented in the corresponding PR / commit messages), and what acceptance criteria the launcher set.

| File | Bundle | Merged | PR |
|---|---|---|---|
| `v2.1-polish-bundle.prompt.md` | 10 validation-driven fixes (Q7/Q12/Q15/Q16 hotfix already shipped pre-bundle; bundle added Q8/Q11/Q17-Q24) | 2026-05-14 (`f0ede51`) | #1 |
| `v2.2-clear-bundle.prompt.md` | Schema hygiene + polish (Q10/Q25/Q26/Q28/Q29/Q31/Q32/Q33/Q34/Q37) | 2026-05-14 (`b994710`) | #2 |
| `v2.2a-review-completeness.prompt.md` | Review surface unlock (Q9/Q27/Q30/Q41/Q42/Q43); Q41 partial — see PR/tag for nuance | 2026-05-14 (`bf39b09`) | #3 |
| `v2.2.5-bundle-foundation.prompt.md` | Bundle abstraction first-class + classifier substrate + structured gate-answer + metric-row observability (Q40/Q41 partial/Q44/Q45/Q46/Q47/Q48/Q50/Q51/Q55/Q57/Q58/Q59/Q60/Q61) | 2026-05-18 (`e3eb3d6`) | #4 |
| `v2.2.5-followups.prompt.md` | Code-review punch list — 13 HIGH + 16 MEDIUM + 6 LOW items derived from full-codebase review post-v2.2.5 launcher | 2026-05-18 (`e3eb3d6`, same PR as v2.2.5) | #4 |
| `v2.2.6-stack-classifier.prompt.md` | Stack-classifier candidate registry + classifier schema substrate + 3 workflow-critical fixes (Q63 auto-close, Q64 cross-session ownership, canonical task_id propagation) | 2026-05-18 (`e16f64c`) | #5 |

Future launcher prompts (v2.2.7-classifier-portability, v2.3-daemon, etc.) live in `specs/` while active, move here once merged.
