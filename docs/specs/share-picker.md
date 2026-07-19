# Spec: SharePicker

> Standalone window/app for sharing screens and windows via xdg-desktop-portal-hyprland (XDPH).

## Overview

- **Source**: `src/apps/share-picker/` (entry: `main.ts`, plus `capture.ts`, `protocol.ts`, `poller.ts`, `sources.ts`, `types.ts`, `ui.ts`)
- **Dependencies**: `grim` (screenshot), `hyprctl` (geometry queries), `Gtk.Application` (`com.caioasmuniz.shade_shell.share_picker`)
- **Type**: Standalone Gtk.Application window (not part of main shell); decorated but no titlebar; launched by XDPH

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
| F1 | Initial load | App activates | Temp directory created; monitors and windows loaded; Screens tab shown with initial captures; `MonitorPoller` starts |
| F2 | Tab switch | User clicks "Windows" or "All" tab | Poller stopped; windows captured once via grim -g (or combined capture) |
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
| E1 | grim not in PATH | Warnings logged; previews show blank images |
| E2 | hyprctl not in PATH | Monitor/window list empty |
| E3 | No monitors (headless) | App still opens; UI shows no screens |
| E4 | Window closed mid-capture | Temp directory cleaned on `shutdown` signal |
| E5 | XDPH_WINDOW_SHARING_LIST empty/malformed | Parsed leniently; `parseWindowList` returns empty array; windows tab shows empty |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window | `picker-popup` class - no decorations | Custom CSS class; CSS inline: `border-radius: 12px; border: 1px solid rgba(255,255,255,0.08)` |
| Title | `title-2` | Adw style class |
| Notebook tabs | `Gtk.Notebook` | Standard GTK |
| Thumbnails | `Gtk.Picture`, 240×135 | `CONTENT_SCALE_DOWN` |

### Adwaita checklist

- [ ] Uses inline CSS for window rounding and border — **violation**: hardcoded `rgba(255,255,255,0.08)` border
- [x] `title-2` for labels
- [x] Icons are symbolic where used

## Test plan

- **Unit**: test `parseWindowList` parsing, `formatDuration` in timer? Not used here; test `runSync` Gio.Subprocess helper
- **Compliance linter**: hardcoded color violation in `ui.ts` (rgba border)
- **Visual/manual**: launch via XDPH, test each tab, verify `[SELECTION]` output, test cancel, test restore-token checkbox
