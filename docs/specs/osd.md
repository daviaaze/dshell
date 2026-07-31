# Spec: OSD

> On-screen display for volume, brightness, and touchpad changes.

## Overview

- **Source**: `src/widget/osd/` (entry: `index.tsx`, `popup.tsx`, `slider.tsx`, `touchpad.tsx`)
- **Dependencies**: domain services own their OSD reveal state — `AudioController.speakerOsdVisible`/`micOsdVisible`, `Brightness.screenOsdVisible`/`kbdOsdVisible`, `Touchpad.osdVisible` (backed by `services/utils/osdTimer.ts` debounce). Any widget (osd, bar, quicksettings) binds to the same source.
- **Type**: `PopupWindow` (Astal.Window), anchored to bottom, layer OVERLAY; contains multiple `Gtk.Revealer` popups keyed to service signals

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Hidden | No recent changes | All revealers `revealChild=false`, inner `visible=false`; parent window hidden |
| F2 | Speaker volume change | `audio.defaultSpeaker` emits `notify::volume` or `notify::mute` | Speaker slider popup reveals for 2s, then slides up and hides |
| F3 | Mic volume/mute change | `audio.defaultMicrophone` emits `notify::volume` or `notify::mute` | Mic slider popup reveals for 2s |
| F4 | Screen brightness change | `Brightness` emits `notify::screen` | Brightness slider popup reveals for 2s |
| F5 | Keyboard brightness change | `Brightness` emits `notify::kbd` | Kbd brightness slider popup reveals for 2s |
| F6 | Touchpad toggle | `Touchpad` emits `toggled` | Touchpad OSD icon popup reveals for 2s |
| F7 | Multiple simultaneous | Two or more signals fire within 2s | All corresponding revealers are open; parent window visible as long as any revealer is active |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | — | No clickable controls; display-only OSD |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Rapid volume changes (e.g. scroll wheel) | Timer resets on each signal; OSD stays visible |
| E2 | Signal fires while OSD revealing | Timer reset; full 2s from last signal |
| E3 | Audio not available (no Wireplumber) | Speaker/mic popup never appears (no signal) |
| E4 | Board has no keyboard backlight | Kbd brightness never fires; no popup shown |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| OSD container | `card` + `background` + `linked` | Adw classes |
| Container inline css | `box-shadow: none; padding: 12px;` | Layout-only; box-shadow removed intentionally |
| Slider | `LevelBar` with `slider` class | GTK LevelBar + custom class |
| Label | `heading` | Adw style class |
| Icons | Symbolic, computed dynamically | `audio-volume-*-symbolic`, `display-brightness-symbolic`, etc. |
| Revealer transition | `SLIDE_UP`, 200ms | Standard animation |

### Adwaita checklist

- [x] Uses `card` + `background` + `linked` Adw classes
- [x] Icons are symbolic
- [x] Layout-only inline CSS (padding, box-shadow)
- [x] Verified in light and dark

## Test plan

- **Unit**: `OsdTimer` debounce behavior and service OSD props (covered in `services/__tests__/osd.test.ts`); icon selection logic (muted vs active icons), volume clamping and percentage formatting
- **Compliance linter**: no expected violations
- **Visual/manual**: screenshots of each OSD type, test simultaneous display
