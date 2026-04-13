# Performance: Flutter / Dart

## Widget Rebuilds
- Missing `const` constructors on stateless widgets and static children
- Large `build()` methods that should be split into smaller widgets
- `setState()` at too high a level (rebuilds entire subtree instead of targeted widget)
- Missing `const` keyword on widget constructors with no dynamic params
- Heavy computation inside `build()` — move to `initState()` or compute outside

## Lists & Scrolling
- `ListView(children: [...])` with 20+ items — use `ListView.builder` instead
- Missing `itemExtent` or `prototypeItem` on large uniform lists
- `SingleChildScrollView` wrapping a `Column` with many children — use `ListView`
- Missing `cacheExtent` tuning for heavy list items

## Images & Assets
- No `cacheWidth`/`cacheHeight` on large images (decode full resolution for small display)
- Missing `Image.asset` / `CachedNetworkImage` — raw `Image.network` without caching
- Large images loaded without resize — use `ResizeImage` or server-side thumbnails
- SVG assets that could be compiled to code via `flutter_svg` or replaced with icons

## State Management
- Riverpod/BLoC/Provider at too high a scope (rebuilds unrelated widgets)
- Missing `select()` / `Selector` — listening to entire state when only one field needed
- `FutureBuilder` / `StreamBuilder` rebuilding on every frame (missing key or stream reference changes)

## Async & Resources
- Missing `dispose()` for controllers, streams, animation controllers
- `Timer.periodic` without cancel in `dispose()`
- Heavy isolate work on main thread (image processing, JSON parsing of large payloads)
- Missing `compute()` for CPU-heavy operations

## Platform & Size
- Unused packages in `pubspec.yaml` (inflates app size)
- Missing tree-shaking for icon fonts (`--tree-shake-icons` build flag)
- Platform channels called in hot path without caching result
