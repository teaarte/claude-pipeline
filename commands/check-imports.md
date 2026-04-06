# Check Import Boundaries

Verify no deep cross-feature imports exist. Features should only import from shared/ or their own module.

Run:
```bash
grep -rn "from.*features/" src/features/ --include="*.ts" --include="*.tsx" | grep -v "from.*features/[^/]*/index" | grep -v node_modules | head -30
```

This finds imports from `features/X/components/` or `features/X/hooks/` instead of `features/X` (barrel).

Also check for cross-feature imports:
```bash
for dir in src/features/*/; do
  feature=$(basename "$dir")
  grep -rn "from.*features/" "$dir" --include="*.ts" --include="*.tsx" | grep -v "features/$feature" | head -10
done
```

Report violations.
