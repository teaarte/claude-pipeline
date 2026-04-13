# Performance: React / Next.js

- Unnecessary re-renders (missing memo/useMemo/useCallback where it matters)
- Heavy computations in render path
- Missing virtualization for long lists (50+ items)
- Large new dependencies added to bundle
- Missing lazy loading for heavy routes/components
- Memory leaks (event listeners, subscriptions not cleaned up)
- Missing debounce/throttle on frequent events
- Unoptimized images (missing next/image, no width/height)
- Client-side data fetching that could be server-side
