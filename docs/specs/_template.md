# Spec: <App/Widget Name>

> Source-linked reference. Keep functional claims observable and check them against current implementation; distinguish verified behavior from proposed requirements.

## Overview

- **Source**: `packages/widgets/src/<name>/` (entry: `<file>.tsx`)
- **Settings group**: `<schema id>` (if any)
- **Layer/behavior**: e.g. `Astal.Window`, layer, exclusivity, anchor; link current source

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 |  |  |  |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 |  |  |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 |  |  |

## Visual (Adwaita alignment)

Prefer **native Adwaita CSS variables** (`--window-bg-color`, `--accent-bg-color`,
`--card-bg-color`, `--shade-color`, etc.) and GTK style classes (`.card`,
`.accent`, `.background`, `.flat`, etc.). Do not add undocumented custom palette
tokens; use the [STYLEGUIDE.md](../STYLEGUIDE.md) catalog. Hardcoded values and
inline CSS should be justified against the current styling conventions rather
than added as an unexamined second theme system.

### Theme tokens

| Element | Variable / style class | Notes |
|---------|----------------------|-------|
|  | native var or class |  |

### Adwaita checklist

- [ ] Uses Adw style classes where one exists (`card`, `linked`, `pill`,
      `flat`, `circular`, `dimmed`, `accent`, …) instead of custom CSS
- [ ] Spacing follows the Adwaita 6px grid (6/12/18) — use widget
      `marginTop`/`marginBottom`/`marginStart`/`marginEnd` props
- [ ] Corner radius uses `var(--window-radius)` if custom CSS is needed
- [ ] Readable in both light and dark variants (verify with
      `Adw.StyleManager` color-scheme toggle)
- [ ] Icon-only buttons use symbolic icons (`-symbolic`)
- [ ] Focus/hover states are visible and use theme accent
      (`--accent-bg-color` or `.accent` class)

## Test plan

- **Tests**: name the current test target or script only after confirming it exists in this repository. Put pure logic behind testable functions where appropriate; do not invent a test directory or test harness.
- **Static checks**: list only scripts that exist in `package.json` and can be run without modifying source. `pnpm run lint` uses `--write`; do not describe it as a read-only compliance check.
- **Visual/manual**: list reproducible states, themes and orientations to inspect. Mark screenshots/baselines as proposals unless they exist and match the current implementation.
