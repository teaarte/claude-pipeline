# UI Consistency: Flutter

## Material / Cupertino Consistency
- Using correct design language for target platform (Material 3 vs Cupertino)?
- Not mixing Material and Cupertino widgets in same screen?
- Using `Theme.of(context)` for colors/text styles, not hardcoded values?
- Custom widgets extend the theme, not override it?

## Layout & Responsive
- Using `MediaQuery` / `LayoutBuilder` for responsive layouts, not fixed sizes?
- `SafeArea` applied where needed (notch, status bar, bottom bar)?
- Handles landscape orientation if applicable?
- Text scales with `MediaQuery.of(context).textScaler` (not the deprecated `textScaleFactor`)?
- Text overflow handled (`TextOverflow.ellipsis`, `maxLines`) on dynamic content?

## State Management
- Consistent pattern across screens (all Riverpod, or all BLoC — not mixed)?
- State scoped correctly (not global when local would suffice)?

## Navigation
- Consistent navigation pattern (GoRouter / auto_route / Navigator 2.0)?
- Back button behavior correct on Android?
- Deep linking supported if applicable?

## Assets & Images
- Using `CachedNetworkImage` for remote images (not raw `Image.network`)?
- Placeholder and error builders on network images?
- Consistent icon usage from single icon set?

## Accessibility
- `Semantics` widgets on custom components?
- `excludeFromSemantics` on decorative images?
- Sufficient color contrast?
- Touch targets at least 48x48 dp?

## Patterns
- Loading/error/empty states use consistent shared widgets?
- Form validation follows project patterns (`FormField`, validators)?
- No hardcoded strings — using localization (`AppLocalizations` / `easy_localization`)?
- Animation durations and curves consistent with project defaults?
