# E2E: Playwright (Web)

## Detection
`e2e/` or `tests/` with `*.spec.ts` + Playwright config

## Process
1. Read existing Playwright tests for structure (page objects, fixtures, helpers)
2. Write tests for every flow in "Manual Test Steps" section of plan
3. Run: command from CLAUDE.md (usually `npm run test:e2e`)

## Rules
- Follow existing page object model if project uses one
- Use existing fixtures and helpers
- Prefer: `getByRole`, `getByLabel`, `getByText` over CSS selectors
- Use `test.describe` blocks per feature
- No `waitForTimeout` — wait for network/element instead
- Run against local dev server
