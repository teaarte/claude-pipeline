# specs/done/

Archive of completed launcher prompts and one-shot specs. Each file here was a single-session pasteable prompt that was executed in a fresh Claude Code session and merged into `main`.

Kept for historical reference: what was promised in the prompt, what deviations occurred (documented in the corresponding PR / commit messages), and what acceptance criteria the launcher set.

| File | Bundle | Merged | PR |
|---|---|---|---|
| `v2.1-polish-bundle.prompt.md` | 10 validation-driven fixes (Q7/Q12/Q15/Q16 hotfix already shipped pre-bundle; bundle added Q8/Q11/Q17-Q24) | 2026-05-14 (`f0ede51`) | #1 |
| `v2.2-clear-bundle.prompt.md` | Schema hygiene + polish (Q10/Q25/Q26/Q28/Q29/Q31/Q32/Q33/Q34/Q37) | 2026-05-14 (`b994710`) | #2 |
| `v2.2a-review-completeness.prompt.md` | Review surface unlock (Q9/Q27/Q30/Q41/Q42/Q43); Q41 partial — see PR/tag for nuance | 2026-05-14 (`bf39b09`) | #3 |

Future launcher prompts (v2.2-code-polish, v2.3-daemon, etc.) live in `specs/` while active, move here once merged.
