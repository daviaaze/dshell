# Spec: SharePicker

> Standalone window/app for sharing screens and windows via xdg-desktop-portal-hyprland (XDPH).

## Overview

- **Source**: `apps/share-picker/src/` (`main.ts`, `capture.ts`, `protocol.ts`, `poller.ts`, `sources.ts`, `types.ts`, `ui.ts`)
- **Dependencies**: `grim`, `hyprctl`, standalone `Gtk.Application` (`com.caioasmuniz.shade_shell.share_picker`)
- **Type**: undecorated native-background window launched by XDPH; native Light/Dark preference is initialized without shell services.

## Functional

### Protocol

| # | Input/Output | Format | Details |
|---|-------------|--------|---------|
| P1 | Environment | `XDPH_WINDOW_SHARING_LIST` | Encoded window handles: `ID[HC>]CLASS[HT>]TITLE[HE>]ID...` |
| P2 | Stdout output | `[SELECTION][r]/screen:NAME` or `[SELECTION][r]/window:ID` | `r` suffix indicates allow-restore-token; `NAME` is monitor name, `ID` is XDPH window handle |
| P3 | CLI args | `--allow-token` | Sets initial restore-token checkbox state |

### Tabs

| # | Tab | Behavior |
|---|-----|----------|
| T1 | Screens | Monitor list showing live previews (polled every ~200ms via `grim -o`); clicking selects that screen |
| T2 | Windows | Client list showing static snapshots; captures each window once on tab switch |
| T3 | All | Combined grid of monitors + windows; captures each once on tab switch |

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Initial load | App activates | Present UI, then start asynchronous captures and source-specific round-robin polling |
| F2 | Tab switch | User clicks Windows or All | Request matching primary/All preview handles only; never select a source or emit a successful portal response |
| F3 | Selection made | User clicks a monitor or window thumbnail | `print()` to stdout with `[SELECTION][r]/screen:<name>` or `/window:<id>`; app quits |
| F4 | Cancel | User clicks Cancel button or closes window | App quits with no selection |
| F5 | Allow-restore toggled | User checks/unchecks "Allow restore token" checkbox | `tokenRestore` flag; `r` appended to selection output |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click monitor thumbnail | Select that monitor for sharing |
| I2 | Click window thumbnail | Select that window for sharing |
| I3 | Check "Allow restore token" | Enable token restore in output |
| I4 | Click "Cancel" | Quit app |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | grim missing, capture failure or invalid texture | Preview unavailable; stale texture cleared; source remains selectable |
| E2 | hyprctl unavailable | Query failure logged; corresponding source lists may be empty |
| E3 | No monitors | Screens and the All screens section show No screens available |
| E4 | Shutdown during capture | Poller disconnected/stopped and all handles disposed; late native completion cannot mutate widgets |
| E5 | Window-list env absent | Window list unavailable with portal guidance |
| E6 | Window-list env present empty/malformed | No windows available; parser retains `provided: true` |
| E7 | Lazy preview / accepted capture | Preview not loaded / Loading preview respectively |
| E8 | Multiple monitors | Each source decodes once and updates only its own primary/All handles |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window | `picker-popup background`, native Light/Dark | Theme-aware border and native opaque surface |
| Title | `title-2` | Adw style class |
| Notebook tabs | `Gtk.Notebook` | Standard GTK |
| Thumbnails | `Gtk.Picture`, 240×135 | `CONTENT_SCALE_DOWN` |

### Adwaita checklist

- [x] Window uses `var(--window-radius)` and a theme-aware border (`alpha(@window_bg_color, 0.08)`)
- [x] `title-2` for labels
- [x] Icons are symbolic where used

## Test plan

- **Unit**: test `parseWindowList` parsing; test `runSync` Gio.Subprocess helper
- **Compliance linter**: no hardcoded color violation for the border; source uses `alpha(@window_bg_color, 0.08)` in `picker.css`.
- **Visual/manual**: launch via XDPH, test each tab, verify `[SELECTION]` output, test cancel, test restore-token checkbox
