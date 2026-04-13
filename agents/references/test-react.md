# Testing: React / Next.js

## Framework Detection
- `vitest.config.*` or `vite.config.* with test` → Vitest
- `jest.config.*` or `package.json "jest"` → Jest
- Neither → check CLAUDE.md stack. React/Next.js → recommend Vitest. NestJS → Jest (built-in).

## What to Test
**Components — only if they contain logic:**
- Conditional rendering
- User interaction → expected outcome
- Do NOT test: pure layout, styling, static content

## File Naming
`*.test.ts`, `*.test.tsx`, `*.spec.ts`

## Mocking
- MSW for API mocking
- `jest.mock()` / `vi.mock()` for module mocks
- Testing Library `render` with providers wrapper
