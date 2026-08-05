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

All colors must come from the theme using **native Adwaita CSS
variables** (`--window-bg-color`, `--accent-bg-color`, `--card-bg-color`,
`--shade-color`, etc.) or **GTK style classes** (`.card`, `.accent`,
`.background`, `.flat`, etc.). Hardcoded hex/rgb values and ad-hoc inline
`css` are **not allowed**. See [STYLEGUIDE.md](../STYLEGUIDE.md) for the
full reference.

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

- **Unit (GJS harness, `src/lib/__tests__/`)**: list logic that is (or should
  be) extracted from widgets and testable headless.
- **Compliance linter (`pnpm check:compliance`)**: exceptions, if any, with
  justification. Enforces theme tokens, componentization, event-driven
  design, logging (`#/lib/core/logger`), async usage, and gnim/astal
  reactivity patterns. Suppress with `// comply-allow: <rule>`.
- **Visual/manual**: screenshots to capture (light/dark × states), run
  before release.
