# Spec: RegionSelector

> Region selection overlay for area capture (screenshot and recording).

## Overview

- **Source**: `src/widget/region-selector/` (entry: `index.tsx`)
- **Dependencies**: `Screenshot` service, `AstalHyprland`, `Process`
- **Type**: `Astal.Window`, single full-screen overlay on the focused monitor; used when `Screenshot` needs region input

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Idle | Overlay shown | Entire screen dimmed; drag-to-select cursor ready |
| F2 | Dragging | User press-drag-release | Selection rectangle drawn with dimming outside; border + corner handles shown |
| F3 | Selected | Drag complete | Selection confirmed; `Screenshot.captureArea(geometry)` called with global compositor coordinates |
| F4 | No valid selection | Click without drag (< 5×5) | Ignored; overlay stays open |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click and drag | Creates selection rectangle; released at selection confirm |
| I2 | Escape | Cancel selection; overlay closed |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Selection extends beyond monitor | Geometry is global (grim coordinates); region-selector only draws what's visible on its monitor |
| E2 | Window moves under cursor during selection | No live tracking — selection geometry is fixed at release |
| E3 | Application windows on other monitors | Coordinates are global (grim); offsets computed from `monOrigin` |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Dim overlay | Cairo `DIM_COLOR = rgba(0,0,0,0.35)` | Hardcoded Cairo color |
| Selection border | Cairo `BORDER_COLOR = #3584e4` | Adwaita accent blue, but hardcoded |
| Corner handles | Cairo, `HANDLE_SIZE = 8px` | Visual drag handles at corners |
| Window hint | Cairo `WINDOW_HINT_COLOR` | Light white tint on hovered window |

### Adwaita checklist

- [ ] All visuals are Cairo-drawn — not CSS theme tokens (expected for this widget)
- [x] Selection border color matches Adwaita accent (#3584e4 / --shade-primary)

## Test plan

- **Unit**: extract and test `getNormalizedSelection`, monitor origin calculation, rectangle overlap logic
- **Compliance linter**: no expected violations in the CSS sense (Cairo draw is exempt from theme rules)
- **Visual/manual**: screenshot during drag, after selection, multi-monitor scenario
