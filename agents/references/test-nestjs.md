# Testing: NestJS

## Framework Detection
- `jest.config.*` or `package.json "jest"` → Jest (built-in with NestJS)

## What to Test
**API Endpoints (backend):**
- Request validation (missing fields, wrong types)
- Success response shape
- Error responses (401, 403, 404, 422)
- Auth guard behavior

**Services:**
- Input → output mapping
- Error handling paths
- Edge cases

## File Naming
`*.spec.ts` (NestJS convention)

## Mocking
- NestJS `Test.createTestingModule()` with `overrideProvider()`
- `jest.mock()` for external modules
- Custom providers for DB/HTTP mocks
