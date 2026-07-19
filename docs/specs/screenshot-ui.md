# Spec: ScreenshotUI

> Full-screen area/window/monitor capture overlay with dimming, selection drawing, and mode switching.

## Overview

- **Source**: `src/widget/screenshot-ui/` (entry: `index.tsx`, `audioSourcePicker.tsx`, `formatQualitySelector.tsx`, `preview.tsx`)
- **Dependencies**: `Screenshot` service, `AstalHyprland`, `getScreenCaptureSettings`
- **Type**: `Astal.Window`, full-screen overlay on focused monitor; managed by the `Screenshot` service (shown when capture mode is activated)

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Screenshot mode | `ss.selectedMode = 'screenshot'` | Frozen screenshot of the desktop shown as background; dim overlay and selection drawn on top |
| F2 | Recording mode | `ss.selectedMode = 'recording'` | Live desktop visible through transparent areas; dim overlay and selection drawn on top |
| F3 | Target: area | User selects "area" mode | Drag interaction enabled; dim rect drawn around selection; dimensions shown |
| F4 | Target: window | User selects "window" mode | Window outlines shown; hover highlights windows; selection snaps to window geometry |
| F5 | Target: monitor | User selects "monitor" mode | Selected monitor highlighted; no drag interaction needed |
| F6 | No selection active | Initial state | Entire screen dimmed; no selection rect (depending on mode) |
| F7 | Recording in progress | Capture started via area/window/monitor | Overlay closes; recording boundary shown instead |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click and drag (area mode) | Selection rectangle drawn; dimming inverted around selection |
| I2 | Hover over window (window mode) | Window highlighted with light fill; title shown |
| I3 | Click window (window mode) | That window selected as capture target |
| I4 | Click confirm button | Capture initiated via `Screenshot` service; overlay closes |
| I5 | Click cancel / Escape | Overlay closes; no capture |
| I6 | Open audio source picker | Audio input selection dialog opens |
| I7 | Select format/quality | Format and quality settings updated in `getScreenCaptureSettings` |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Selection too small (< 5px) | Ignored; no capture or outline |
| E2 | Window moved during selection | Geometry captured at selection time; no live tracking |
| E3 | Multiple monitors | Overlay on focused monitor only; selected window can be on any monitor |
| E4 | No windows open (window mode) | No outlines; user must switch to area or monitor mode |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Dim overlay | Cairo `DIM_COLOR = rgba(0,0,0,0.35)` | Hardcoded Cairo color — drawn, not CSS |
| Selection border | Cairo `BORDER_COLOR = #3584e4` | Hardcoded — Adwaita accent color |
| Selection text | Cairo white | Overlay info text |
| Window highlight | Cairo `WINDOW_HINT_COLOR = rgba(255,255,255,0.15)` | Light tint |

### Adwaita checklist

- [ ] Selection visuals use Cairo — not CSS theme tokens (acceptable for drawing surface)
- [ ] Toolbar buttons use Adw `flat`/`circular` classes
- [ ] Icons are symbolic

## Test plan

- **Unit**: extract and test selection normalization, monitor origin calculation, window-list loading from Hyprland
- **Compliance linter**: file-size violation (717 lines); timer in widget layer; inline css with color property
- **Visual/manual**: screenshots of area/window/monitor modes, confirm/cancel flow, audio source picker
