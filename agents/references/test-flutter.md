# Testing: Flutter / Dart

## Framework Detection
- `pubspec.yaml` with `flutter_test` in dev_dependencies → `flutter test`
- `test/` directory with `*_test.dart` files → match existing patterns
- `integration_test/` → integration tests (run separately)

## What to Test
**Widgets — only if they contain logic:**
- Widget renders correctly with given parameters
- User interaction (tap, swipe) → expected state change
- Conditional rendering based on state
- Mock dependencies via `ProviderScope.overrides` (Riverpod) or `MockBloc` (BLoC)
- Do NOT test: pure layout widgets, theme styling, static text

## File Naming
`*_test.dart` in `test/` directory (mirroring `lib/` structure)

## Mocking
- `mocktail` or `mockito` for dependencies
- `ProviderScope.overrides` for Riverpod
- `BlocProvider` with mock blocs for BLoC
- `pumpWidget()` with required providers/theme wrapper
