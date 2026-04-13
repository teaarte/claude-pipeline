# Performance: Python / FastAPI / asyncio

- N+1 queries (loading in loops instead of batch)
- Missing pagination on list endpoints (unbounded queries)
- Blocking sync calls in async handlers (sync I/O, CPU-heavy ops without executor)
- Transaction scope too wide (holding DB connections across gRPC/HTTP calls)
- Missing connection pool limits or semaphores
- Large response payloads without pagination
- Missing timeout on external HTTP/gRPC calls
- Sync file I/O in async context
- Unbounded caches without TTL
