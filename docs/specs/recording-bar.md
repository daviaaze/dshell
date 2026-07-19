# Spec: RecordingBar

> Floating indicator bar shown during screen recording.

## Overview

- **Source**: `src/widget/recording-bar/` (entry: `index.tsx`)
- **Dependencies**: `Screenshot` service (`recording`, `recording-elapsed`, `audio` properties), `AstalHyprland`
- **Type**: `Astal.Window`, layer `OVERLAY`, anchored bottom-right, follows `focusedMonitor`; visible when `Screenshot.recording` is true

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Not recording | `ss.recording` = false | Window hidden |
| F2 | Recording (no audio) | `ss.recording` = true, `ss.audio` = false | Window shown; red dot + "REC" label + elapsed timer; no audio icon |
| F3 | Recording (with audio) | `ss.recording` = true, `ss.audio` = true | Window shown; includes microphone icon after separator |
| F4 | Elapsed timer | Recording in progress | Timer updates reactively from `ss.recording-elapsed`; format: `M:SS` or `H:MM:SS` |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click stop button | `Screenshot.stopRecording()` called; recording stops; bar hides |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Recording-elapsed is null | Shown as `0:00` (formatDuration handles null via `?? 0`) |
| E2 | Focused monitor changes mid-recording | Bar moves to new focused monitor (binding to `focusedMonitor`) |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window | Inline `css` (`background-color: transparent;`) | Transparent background |
| Bar body | `card` + `frame` + `background` | Adw classes |
| Recording dot | `media-record-symbolic` icon, inline `css: color: #FF0000` | **Violation** — hardcoded color |
| "REC" label | Inline `css: color: #FF0000; font-weight: bold; font-size: 13px` | **Violation** — hardcoded color |
| Elapsed time | Inline `css: font-family: monospace; font-size: 13px` | Layout/typography only |
| Stop button | `circular` + `destructive-action` | Adw classes |

### Adwaita checklist

- [x] Uses `card` `frame` `background` on bar body
- [x] Stop button uses `destructive-action` (Adw)
- [ ] **Recording dot and "REC" label hardcode color #FF0000** — needs `--shade-error` or `@error_bg_color`
- [x] Icons are symbolic

## Test plan

- **Unit**: test `formatDuration` (0, <60s, >=60m, >=60min)
- **Compliance linter**: hardcoded-color errors (recording dot, REC label), inline css with color
- **Visual/manual**: screenshots recording with/without audio, elapsed timer at various values, stop button click
