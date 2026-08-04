# Spec: Linter & Formatter (Biome)

> Biome replaces ESLint + Prettier as the unified linter and formatter
> for the project. This document is the contract: `biome check` runs in
> CI; `biome check --write` fixes safe issues automatically.

## Overview

- **Config**: `biome.json` (root)
- **Tool**: `@biomejs/biome` 2.5.x (single binary, Rust)
- **Languages**: TypeScript, TSX (JavaScript is used sparingly)
- **Ignored**: CSS (GTK-specific syntax), SVG, node_modules, @girs, build, dist, .gnim, scripts

## Functional

### Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `lint` | `biome check --write` | Lint + auto-fix safe issues |
| `format` | `biome format --write` | Format files in-place |
| `format:check` | `biome format --check` | CI check without modifying files |
| `check` | `tsc --noEmit` | Type-checking only |

### Rule domains

| Domain | Rules | Severity |
|--------|-------|----------|
| `recommended` | Biome preset (200+ rules) | error (default) |
| `correctness` | `noUndeclaredVariables`, `noUnusedVariables` | error |
| `style` | `useConst`, `noNonNullAssertion`, `noRestrictedGlobals` | error / warn |
| `complexity` | `noExcessiveCognitiveComplexity`, `noExcessiveLinesPerFunction` | warn |
| `suspicious` | `noExplicitAny`, `noDoubleEquals`, `noVar`, `noShadowRestrictedNames` | error / warn |
| `nursery` | `noJsRestrictedProperties` | error (opt-in) |

### Package boundary enforcement

Biome's `noRestrictedImports` with `patterns` (gitignore-style groups)
enforces the import DAG:

```
apps/shell → widgets → services → core
                              ↘
apps/greeter ─ ─ ─ ─ ─ ─ ─ ─ ┘
apps/share-picker ─ ─ ─ ─ ─ ┘
style → core
```

Each package gets its own override block. Importing an unlisted dependency
fails lint with a descriptive message.

### Widget layer guard

Widgets must not:
- Import GI services directly (`gi://AstalAuth`, `gi://GWeather`, etc.)
- Use `GLib.spawn_*` or `GLib.spawn_command_line_*` (use services instead)
- Use `Lang.bind`, `Lang.copyProperties`, `Lang.Class` (use ES6+ equivalents)

### Global restrictions

- `log` → use `console.log()`
- `logError` → use `console.warn()`
- `Lang.bind` → use arrow functions
- `Lang.copyProperties` → use `Object.assign()` or spread
- `Lang.Class` → use ES6 classes

## Differences from ESLint

| Feature | ESLint | Biome |
|---------|--------|-------|
| Package boundaries | `no-restricted-imports` patterns | `noRestrictedImports` patterns (equivalent) |
| GI service bans | `no-restricted-imports` patterns | `noRestrictedImports` patterns (equivalent) |
| Legacy globals | `no-restricted-globals` | `noRestrictedGlobals` |
| Object properties | `no-restricted-properties` | `noJsRestrictedProperties` (nursery) |
| Cognitive complexity | `sonarjs/cognitive-complexity` | `noExcessiveCognitiveComplexity` |
| Max lines/function | `sonarjs/max-lines-per-function` | `noExcessiveLinesPerFunction` |
| `no-duplicate-string` | sonarjs rule | No equivalent |
| `no-identical-functions` | sonarjs rule | No equivalent |
| `nested-control-flow` | sonarjs rule | No equivalent |
| `no-nested-functions` | sonarjs rule | No equivalent |

The four missing SonarJS rules are considered acceptable losses: they
catch rare code smells, and the remaining rules (`noExcessiveCognitiveComplexity`,
`noExplicitAny`, etc.) provide comparable protection against the most
common quality issues.

## Edge cases

| Condition | Handling |
|-----------|----------|
| Test files | `noExcessiveLinesPerFunction` disabled |
| Widget GI exemptions | `recording-boundary`, `region-selector`, `screenshot-ui` override patterns to allow direct GI imports |
| Non-null assertions | Set to `warn` (GJS patterns require frequent `!`) |
| `logger` shadowing | Set to `warn` (idiomatic name in project) |
