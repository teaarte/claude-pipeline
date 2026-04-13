# Testing: Python

## Framework Detection
- `pytest.ini`, `pyproject.toml [tool.pytest]`, `conftest.py` → pytest
- `unittest` imports in existing code → unittest
- Neither → recommend pytest

## What to Test
**API Endpoints (backend):**
- Request validation (missing fields, wrong types)
- Success response shape
- Error responses (401, 403, 404, 422)
- Auth guard behavior

## File Naming
`test_*.py` in `tests/` directory

## Mocking
- `pytest` fixtures
- `unittest.mock.AsyncMock` / `MagicMock`
- `pytest-asyncio` for async tests
