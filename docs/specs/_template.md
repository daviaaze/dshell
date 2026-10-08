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

Prefer **native Adwaita CSS variables** such as `--window-bg-color`,
`--accent-bg-color`, `--card-bg-color`, and `--shade-color`, and GTK style
classes such as `.card`, `.accent`, `.background`, and `.flat`. Use
`var(--window-radius)` for a custom radius when appropriate. Do not introduce
legacy `--shade-fg` or `--shade-radius` properties or undocumented palette
tokens; use the [STYLEGUIDE.md](../STYLEGUIDE.md) catalog. Justify hardcoded
values and inline CSS against the current styling conventions rather than
creating a second theme system.

The visual guidance below is a starting point, not an automatically accepted
contract. For each applicable item, record its scope, verification method, and
evidence in this component spec. A component-specific rule may specialize the
project default; it cannot waive an applicable external requirement. Treat
heuristic items as review guidance, not automatic pass/fail checks. See
[UI rule authority](../STYLEGUIDE.md#ui-rule-authority).

### Accessibility and input contract

State the supported platform and the accessibility conformance target, if any.
Include only applicable criteria; identify criterion/version, control and
state, exceptions, verification method, evidence, and status. Treat a WCAG
criterion used as a native-app benchmark as a benchmark, not a conformance
claim. A screenshot cannot establish an accessible name, role, state, or
keyboard behavior. Use AT-SPI/platform accessibility data and exercise
keyboard-operable controls where available. Do not invent a universal target
size or contrast threshold; use the applicable criterion and its exceptions.
Use `CURRENT`, `PROPOSED`, or `SUPERSEDED` for rule status and
`APPLICABLE`, `NOT APPLICABLE (reason)`, or `UNKNOWN` for applicability.

| Criterion/source | Control and state | Applicability / exceptions | Check and evidence | Status |
|------------------|-------------------|----------------------------|-------------------|--------|
|  |  |  |  |  |


### Theme tokens

| Element | Variable / style class | Notes |
|---------|----------------------|-------|
|  | native var or class |  |

### Adwaita checklist

- [ ] Uses Adw style classes where one exists (`card`, `linked`, `pill`,
      `flat`, `circular`, `dimmed`, `accent`, …) instead of custom CSS
- [ ] Spacing uses the Adwaita 6px grid (6/12/18) as the default where
      appropriate; use widget `marginTop`/`marginBottom`/`marginStart`/
      `marginEnd` properties where possible. Record applicable local
      contracts and justify deviations; do not treat the grid as a universal
      threshold for every component or spacing purpose.
- [ ] Corner radius uses `var(--window-radius)` if custom CSS is needed
- [ ] Readable in both light and dark variants (verify with
      `Adw.StyleManager` color-scheme toggle)
- [ ] Icon-only buttons use symbolic icons (`-symbolic`)
- [ ] Keyboard-focus indicator remains visible when focus moves through the
      in-scope controls; record the platform/criterion used to assess it.
- [ ] Where pointer hover applies, hover feedback follows the component's
      interaction contract; treat it as a heuristic unless explicitly required.

## Test plan

### Capture coverage matrix

List relevant state/context combinations; do not require a full Cartesian
product. Include viewport, orientation, display/text scale, theme, monitor layout,
or input mode only when they affect this component. `NOT CAPTURED` is a coverage gap,
not a passing result; `NOT APPLICABLE` needs a reason.
Use `IN SCOPE`, `CAPTURED`, `NOT CAPTURED (reason)`, or
`NOT APPLICABLE (reason)`; cite retained evidence for `CAPTURED`.

| Case | State/action | Viewport/context | Expected evidence | Coverage |
|------|--------------|-----------------|-------------------|----------|
|  |  |  |  | IN SCOPE |

- **Tests**: name a test target or script only after confirming it exists in this repository. Put pure logic behind testable functions where appropriate; do not invent a test directory or harness.
- **Static checks**: list only existing checks that are appropriate to the change. Do not describe write-mode lint or formatting scripts as read-only checks.
- **Visual/manual**: use the coverage matrix above and name reproducible states and existing capture workflows. Mark proposed screenshots/baselines as proposals, not existing evidence.
