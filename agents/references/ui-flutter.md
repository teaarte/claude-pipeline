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
- Text scales with `MediaQuery.textScaleFactor`?

## Navigation
- Consistent navigation pattern (GoRouter / auto_route / Navigator 2.0)?
- Back button behavior correct on Android?
- Deep linking supported if applicable?

## Accessibility
- `Semantics` widgets on custom components?
- `excludeFromSemantics` on decorative images?
- Sufficient color contrast?
- Touch targets at least 48x48 dp?
