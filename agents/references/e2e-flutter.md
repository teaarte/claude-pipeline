# E2E: Flutter Integration Tests

## Detection
`integration_test/` directory or `pubspec.yaml` with Flutter

## Process
1. Read existing `integration_test/` files for patterns (test groups, pumping, finders)
2. Write tests for flows in "Manual Test Steps" section of plan
3. Run: `flutter test integration_test/` (or specific file)

## Rules
- Use `IntegrationTestWidgetsFlutterBinding.ensureInitialized()`
- Find widgets via `find.byType`, `find.byKey`, `find.text` — prefer `Key` for stability
- Use `tester.pumpAndSettle()` after actions, not arbitrary delays
- Mock backend via dependency injection / provider overrides, not real network
- Group tests with `group()` per feature
- Test on at least one platform (Android emulator or iOS simulator)
