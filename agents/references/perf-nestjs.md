# Performance: NestJS / Node.js

## Database & ORM
- N+1 query patterns (loading relations in loops)
- Missing database indexes (implied by WHERE/ORDER BY columns)
- Missing pagination on list endpoints (unbounded queries)
- Raw SQL without parameterized queries (also a security issue)
- Eager loading too many relations (over-fetching)
- Missing select() — fetching all columns when only a few are needed
- Transaction scope too wide (holding locks longer than necessary)

## API & HTTP
- Synchronous operations blocking the event loop (CPU-heavy in request handler)
- Missing caching for expensive repeated operations (Redis, in-memory)
- No rate limiting on public/expensive endpoints
- Large response payloads without pagination or streaming
- Missing compression (gzip/brotli)
- File uploads without size limits
- Missing timeout on external HTTP calls

## Architecture
- Blocking constructor operations (should be in onModuleInit)
- Synchronous file I/O (readFileSync, writeFileSync)
- Dynamic require() calls
- Request-scoped providers where singleton would work (Scope.REQUEST propagates)
- Unused providers still registered (loaded but never called)
- Missing queue/background job for heavy operations in request path (emails, reports, file processing)

## Memory & Resources
- Event listeners or intervals not cleaned up in onModuleDestroy
- Large objects held in module-scoped variables (memory leak)
- Missing stream processing for large files (loading entire file to memory)
- Unbounded caches without TTL or max size
