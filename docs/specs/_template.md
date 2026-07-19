# Spec: <App/Widget Name>

> One page. This document is the contract: functional tests verify the
> **Functional** section; the theme linter and visual checklist verify the
> **Visual** section. Keep both testable — no vague requirements.

## Overview

- **Source**: `src/widget/<name>/` (entry: `<file>.tsx`)
- **Settings group**: `<schema id>` (if any)
- **Layer/behavior**: e.g. `Astal.Window`, layer, exclusivity, anchor

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

All colors must come from the theme (`--shade-*` custom properties set by
`src/style/theme.ts`) or libadwaita named colors / style classes. Hardcoded
hex/rgb values and ad-hoc inline `css` are **not allowed** outside
`src/style/palette.ts` and the `useStyle` helper.

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
|  | `--shade-*` / Adw class |  |

### Adwaita checklist

- [ ] Uses Adw style classes where one exists (`card`, `linked`, `pill`,
      `flat`, `circular`, `dim-label`, `accent`, …) instead of custom CSS
- [ ] Spacing follows the Adwaita 6px grid (6/12/18) or `--shade-spacing`
- [ ] Corner radius uses `--shade-radius`
- [ ] Readable in both light and dark variants (verify with
      `Adw.StyleManager` color-scheme toggle)
- [ ] Icon-only buttons use symbolic icons (`-symbolic`)
- [ ] Focus/hover states are visible and use theme accent (`--shade-primary`)

## Test plan

- **Unit (GJS harness, `src/lib/__tests__/`)**: list logic that is (or should
  be) extracted from widgets and testable headless.
- **Compliance linter (`pnpm check:compliance`)**: exceptions, if any, with
  justification. Enforces theme tokens, componentization, event-driven
  design, logging (`#/lib/core/logger`), async usage, and gnim/astal
  reactivity patterns. Suppress with `// comply-allow: <rule>`.
- **Visual/manual**: screenshots to capture (light/dark × states), run
  before release.
