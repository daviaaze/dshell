# Shade Current State Analysis

> Thorough audit of the codebase versus the ROADMAP. Identifies what exists, what's partially done, what's incorrectly marked, and what's genuinely missing.
>
> **Date:** 2026-04-29

---

## Executive Summary

| Category | Count |
|----------|-------|
| **Fully implemented** | 17 |
| **Partially implemented** | 4 |
| **Roadmap incorrectly says missing** | 3 |
| **Genuinely missing** | 20 |
| **Exists but NOT in roadmap** | 7 |

**Key finding:** The ROADMAP has three significant inaccuracies:
1. **Screenshot/Recording** — marked as missing in the matrix (3.9), but a **full implementation already exists** (`src/lib/screenshot.ts` + QS button-grid).
2. **System Resource Monitors** — added as 0.6, but **already implemented** in `systemUsage.tsx` (CPU, RAM, temp, disk).
3. **Audio Device Selector** — added as 1.6, but **already implemented** in `common/audioControl.tsx` (endpoint list with default selection + per-endpoint volume).

The actual gaps are different from what the roadmap suggests. This document realigns expectations.

---

## 1. What Exists (Fully Implemented)

### Core Shell
| Feature | Files | Notes |
|---------|-------|-------|
| **Status Bar** | `src/widget/bar/index.tsx` | Per-monitor, top/left/right/bottom positioning |
| **App Launcher** | `src/widget/applauncher/` | Fuzzy search via `AstalApps`, `uwsm-app` launch |
| **Quick Settings Panel** | `src/widget/quicksettings/` | Full panel with sliders, button grid, tray, expanders |
| **Notification Popups** | `src/widget/notifications/` | Top-right toasts, hover-pause, 5s auto-dismiss |
| **OSD** | `src/widget/osd/` | Volume/brightness/mic popups, 2s reveal |
| **Lock Screen** | `src/widget/lockscreen/` | PAM (`astal-auth`), fingerprint, multi-monitor |
| **Wallpaper** | `src/widget/wallpaper/` | Per-monitor, day/night auto-switch via `Gly` |
| **Settings GUI** | `src/widget/settings/` | Libadwaita prefs: General, Bar, Clock, Network, Weather |

### Bar Components
| Feature | Files | Notes |
|---------|-------|-------|
| **Workspaces** | `src/widget/bar/workspaces.tsx` | Hyprland workspaces with client icons, special workspace support |
| **Clock** | `src/widget/bar/clock.tsx` | Digital clock + popover calendar + world clock |
| **Weather (bar)** | `src/widget/bar/weather.tsx` | Compact weather button with popover |
| **System Indicators** | `src/widget/bar/systemIndicators.tsx` | Recording, Power Profile, BT, Network, Battery, Mic, Audio, DND |
| **System Usage** | `src/widget/bar/systemUsage.tsx` | **CPU, RAM, temperature, disk** — polled every 1s via `libgtop` |
| **Launcher Toggle** | `src/widget/bar/launcher.tsx` | Nix flake icon toggles app launcher |

### Quick Settings Components
| Feature | Files | Notes |
|---------|-------|-------|
| **Brightness Slider** | `src/widget/quicksettings/sliders.tsx` | Screen brightness via `brightnessctl` |
| **Speaker Slider** | `src/widget/quicksettings/sliders.tsx` + `common/slider.tsx` | Master volume with debounce |
| **Microphone Slider** | `src/widget/quicksettings/sliders.tsx` | Mic volume + mute |
| **Audio Endpoint Control** | `src/widget/common/audioControl.tsx` | Expandable list of ALL endpoints with default selection + per-endpoint volume |
| **System Tray** | `src/widget/quicksettings/tray.tsx` | SNI tray items with D-Bus menus |
| **Power Menu** | `src/widget/common/powerMenu.tsx` | Lock, Log Out, Suspend, Reboot, Power Off |
| **Notification List** | `src/widget/quicksettings/notificationList.tsx` | Grouped by app, DND toggle, Clear All |
| **Button Grid** | `src/widget/quicksettings/button-grid/` | 2-column grid of toggle buttons |

### Button Grid Toggles
| Feature | Files | Notes |
|---------|-------|-------|
| **Auto-cpufreq** | `src/lib/autoCpufreq.ts` + `button-grid/autoCpufreq.tsx` | Cycles power-saver/balanced/performance |
| **Power Profiles** | `button-grid/powerprofiles.tsx` | Fallback when auto-cpufreq unavailable |
| **Color Scheme** | `button-grid/colorScheme.tsx` + `src/lib/colorScheme.ts` | Light/Dark/Auto with sunrise/sunset logic |
| **Bluetooth** | `button-grid/bluetooth.tsx` | Toggle + device list with connect/disconnect |
| **Network** | `button-grid/network.tsx` | WiFi toggle + AP scan + password dialog |
| **Screenshot/Recording** | `button-grid/screenshot.tsx` + `src/lib/screenshot.ts` | Screenshot (full/area) + recording (full/area/window/output) |
| **Caffeinated** | `button-grid/caffeinated.tsx` + `src/lib/inhibit.ts` | Idle inhibit toggle |
| **Touchpad** | `button-grid/touchpad.tsx` + `src/lib/touchpad.ts` | Enable/disable touchpad via evdev grab |

### QS Expander Cards
| Feature | Files | Notes |
|---------|-------|-------|
| **Media Player** | `expander/media.tsx` | MPRIS with cover art, position slider, playback controls |
| **Battery** | `expander/battery.tsx` | Detailed battery with energy rate, capacity, level bar |
| **Calendar** | `expander/calendar.tsx` | `Gtk.Calendar` + date display |
| **Weather** | `expander/weather.tsx` | Full weather card with refresh |
| **World Clock** | `expander/worldClock.tsx` | Configurable timezone list |

### Library Services
| Feature | Files | Notes |
|---------|-------|-------|
| **Brightness Manager** | `src/lib/brightness.ts` | Screen + keyboard backlight via `brightnessctl` |
| **Color Scheme Manager** | `src/lib/colorScheme.ts` | Light/dark/auto with `org.gnome.desktop.interface` GSettings |
| **Fingerprint Auth** | `src/lib/fingerprint.ts` | `fprintd` D-Bus integration for lock screen |
| **Geolocation** | `src/lib/geolocation.ts` | GeoClue2 → IP fallback (`ipapi.co`) |
| **Weather Service** | `src/lib/weather.ts` | `GWeather` (MET Norway), auto-location |
| **Screenshot/Recording Service** | `src/lib/screenshot.ts` | `grim`/`slurp` + `wf-recorder` with controllable subprocess |
| **Touchpad Service** | `src/lib/touchpad.ts` | Python evdev grab script |
| **Inhibit Service** | `src/lib/inhibit.ts` | GTK `ApplicationInhibitFlags.IDLE` |
| **Monitor Tracking** | `src/lib/monitors.ts` | Reactive Gdk monitor list + Hyprland mapping |
| **Settings Context** | `src/lib/settings.ts` | Reactive GSettings via `gnim-schemas` |
| **Request Handler** | `src/lib/requestHandler.ts` | CLI dispatch: toggle, lock, screenshot, record |

### Settings Pages
| Feature | Files | Notes |
|---------|-------|-------|
| **General** | `src/widget/settings/general.tsx` | Theme, wallpaper day/night picker |
| **Bar** | `src/widget/settings/bar.tsx` | Position, disk usage, temp path, system monitor cmd |
| **Clock** | `src/widget/settings/clock.tsx` | Timezone add/remove |
| **Network** | `src/widget/settings/network.tsx` | WiFi toggle, signal strength, scan button |
| **Weather** | `src/widget/settings/weather.tsx` | Auto-loc, lat/lon, detect location |

---

## 2. Partially Implemented (Gap Between Roadmap and Reality)

### 2.1 — Audio Device Selector (Roadmap 1.6)

**What exists:** `src/widget/common/audioControl.tsx`
- Expandable list of ALL audio endpoints (speakers, microphones)
- Radio buttons to select the default endpoint
- Per-endpoint volume sliders

**What the roadmap wants:** Same thing, essentially.

**Verdict:** ✅ **Already implemented.** Roadmap 1.6 should be marked `[DONE]` or removed. The current UI is arguably better than a simple dropdown — it shows volumes inline.

---

### 2.2 — System Resource Monitors (Roadmap 0.6)

**What exists:** `src/widget/bar/systemUsage.tsx`
- CPU usage via `glibtop_cpu`
- RAM usage via `glibtop_mem`
- Temperature via configurable `tempPath`
- Disk usage via `glibtop_fsusage` (toggleable via `show-disk-usage`)
- Polls every 1000ms
- Click opens configurable system monitor app

**What the roadmap wants:** Icon + percentage in bar, tooltip details, click opens monitor.

**Verdict:** ✅ **Already implemented.** Roadmap 0.6 is effectively done. Minor enhancements possible (CPU temp auto-detection, network speed, GPU), but core feature exists.

---

### 2.3 — Screenshot & Recording UI (Roadmap 3.9)

**What exists:**
- `src/lib/screenshot.ts` — Full GObject singleton with:
  - `screenshot(fullscreen)` — uses `grim`
  - `toggleRecording()` — uses `wf-recorder` with SIGINT stop
  - `recordArea()`, `recordWindow()`, `recordOutput()`
  - `audio` property for audio inclusion
  - `recording` property with signals
- `src/widget/quicksettings/button-grid/screenshot.tsx` — QS button with:
  - Main click: toggle recording
  - Dropdown: Screenshot, Area Screenshot, Record, Record Area, Record Window, Record Output
  - Audio checkbox
- `src/widget/bar/systemIndicators.tsx` — Recording indicator in bar
- `src/lib/requestHandler.ts` — CLI: `screenshot`, `screenshot-area`, `record`, `record-area`, `record-window`, `record-output`
- Nix module wraps `grim`, `slurp`, `wf-recorder`, `wl-clipboard`

**What the roadmap wants:** Screenshot + recording UI.

**Verdict:** ✅ **Already implemented.** Roadmap 3.9 and the matrix are wrong. This should be moved to `[DONE]`.

---

### 2.4 — Notification Enhancements (Roadmap 1.7)

**What exists:**
- Popups with hover-pause ✅
- Auto-dismiss after 5s ✅
- DND toggle ✅
- Grouped notifications in QS ✅

**What's missing from the roadmap's vision:**
- Persistent **notification history** (notifications are lost after dismissal)
- Progress indicator for auto-dismiss countdown
- Per-app ignore list in Settings

**Verdict:** ⚠️ **Partially done.** The popup behavior matches, but history and per-app settings are genuinely missing.

---

## 3. Genuinely Missing (Confirmed Gaps)

### Phase 0 — Quick Wins

| # | Feature | Status | Why Missing |
|---|---------|--------|-------------|
| 0.3 | **Keyboard Layout Indicator** | `[DONE]` | Implemented in `src/lib/keyboard.ts` (GObject singleton with `hyprctl devices -j` parsing). |
| 0.4 | **Polkit Agent** | `[TODO]` | Not in Nix module. `hyprpolkitagent` not referenced anywhere. |
| 0.5 | **Window Title in Bar** | `[DONE]` | Implemented in `src/widget/bar/windowTitle.tsx`. Shows app icon + title with truncation. |

**Note:** 0.6 (System Resource Monitors) is DONE — see §2.2.

---

### Phase 1 — Daily Workflow

| # | Feature | Status | Why Missing |
|---|---------|--------|-------------|
| 1.1 | **Clipboard History Manager** | `[DONE]` | Implemented in `src/lib/clipboard.ts` (74 lines). `cliphist` integration with launcher search mode. |
| 1.2 | **Night Light / Blue Light Filter** | `[DONE]` | Implemented in `src/lib/nightLight.ts` (210 lines). `hyprsunset` subprocess + QS toggle + auto-schedule. |
| 1.3 | **Per-Application Volume Mixer** | `[DONE]` | Implemented in `src/lib/appMixer.ts` (246 lines). Parses `pw-dump` JSON for per-app audio streams with mute/volume control. |
| 1.4 | **System Updates Checker** | `[TODO]` | No update polling logic. No badge in bar. |
| 1.5 | **Idle / Auto-Lock Controls** | `[DONE]` | Implemented in `src/lib/hypridle.ts` (433 lines). Generates `hypridle.conf` from GSettings, manages subprocess. |
| 1.6 | **Audio Output/Input Device Selector** | `[DONE]` | ✅ Already implemented in `common/audioControl.tsx` — see §2.1. |
| 1.7 | **Notification History** | `[DONE]` | Implemented in `src/lib/notificationHistory.ts` (167 lines). Persistent JSON history in QS with clear/remove actions. |

---

### Phase 2 — Window Management UX

| # | Feature | Status | Why Missing |
|---|---------|--------|-------------|
| 2.1 | **Window Switcher (Alt-Tab)** | `[DONE]` | Implemented in `src/widget/windowswitcher/index.tsx` (214 lines). MRU-ordered overlay with keyboard navigation. |
| 2.2 | **Dock / Taskbar** | `[DONE]` | Implemented in `src/widget/dock/index.tsx` (98 lines). Bottom dock with pinned apps + running indicators. |
| 2.3 | **Workspace Overview / Exposé** | `[TODO]` | No full-screen workspace grid. |
| 2.4 | **Bar Module Toggle UI** | `[DONE]` | Implemented via GSettings keys in `src/lib/gschema.ts` (show-window-title, show-workspaces, show-system-resources, show-clock, show-weather, show-system-indicators, etc.). |

---

### Phase 3 — Polish & Differentiation

| # | Feature | Status | Why Missing |
|---|---------|--------|-------------|
| 3.1 | **Dynamic Wallpaper-Driven Theming** | `[DONE]` | Implemented in `src/lib/theming.ts`. `matugen` integration with accent color extraction and CSS injection. |
| 3.3 | **Color Picker** | `[TODO]` | `hyprpicker` not wrapped/used. No QS button. |
| 3.4 | **Calendar Events Integration** | `[TODO]` | Calendar is just `Gtk.Calendar` widget. No EDS/ICS backend. |
| 3.5 | **Launcher Enhancements** | `[TODO]` | No calculator, emoji, web search, or window switching in launcher. |
| 3.6 | **Auto-Hide / Floating Bar** | `[TODO]` | No `bar-mode` GSettings key. Bar is always `EXCLUSIVE`. No margin/rounding modes. |
| 3.7 | **Searchable Settings** | `[TODO]` | No search entry in Settings window. |
| 3.8 | **Theme Editor** | `[TODO]` | No color picker in Settings. No live CSS injection for custom colors. |
| 3.9 | **Screenshot & Recording UI** | `[DONE]` | ✅ Already fully implemented — see §2.3. |
| 3.10 | **Internationalization (i18n)** | `[TODO]` | No `po/` directory. No `_()` wrappers. `main.ts` calls `bindtextdomain` but no `.mo` files are built. |
| 3.11 | **Monitor Configuration UI** | `[TODO]` | No visual monitor arrangement in Settings. |
| 3.12 | **Keyboard Hint Navigation** | `[TODO]` | No Flash.nvim-style hint system. |

---

## 4. Exists But NOT in the Roadmap

These features are implemented but have no corresponding roadmap item:

| Feature | Files | Why It Matters |
|---------|-------|----------------|
| **Auto-cpufreq Integration** | `src/lib/autoCpufreq.ts` + QS button | Power management — unique feature most shells don't have |
| **Fingerprint Authentication** | `src/lib/fingerprint.ts` + lockscreen | Biometric unlock via `fprintd` |
| **Touchpad Toggle** | `src/lib/touchpad.ts` + QS button | Evdev grab-based touchpad disable |
| **Geolocation Service** | `src/lib/geolocation.ts` | GeoClue2 + IP fallback for weather auto-location |
| **Idle Inhibit (Caffeinated)** | `src/lib/inhibit.ts` + QS button | Prevents screen lock |
| **World Clock** | `src/widget/bar/clock.tsx` + `expander/worldClock.tsx` | Multiple timezone display |
| **Power Profile / Auto-cpufreq Toggle** | `button-grid/powerprofiles.tsx` + `autoCpufreq.tsx` | CPU governor control |

---

## 5. GSettings Schema Gaps

Current schema keys in `src/lib/gschema.ts`:

### `bar` schema
- `position` (int) — bar position
- `temp-path` (string) — thermal sensor file
- `system-monitor` (string) — monitor app command
- `show-disk-usage` (bool) — disk usage visibility

**Missing keys needed by roadmap:**
- `show-workspaces`, `show-window-title`, `show-system-resources`, `show-media`, `show-clock`, `show-weather`, `show-battery`, `show-network`, `show-bluetooth` — for module toggles (2.4)
- `bar-mode` (string: normal/floating/auto-hide) — for auto-hide (3.6)
- `bar-margin` (int) — for floating mode (3.6)

### `general` schema
- `color-scheme` (int) — theme mode
- `wallpaper-day` (string) — day wallpaper path
- `wallpaper-night` (string) — night wallpaper path
- `timezones` (string array) — world clock zones

**Missing keys needed by roadmap:**
- `night-light-enabled` (bool) — Night Light toggle (1.2)
- `night-light-temperature` (int) — color temperature (1.2)
- `night-light-auto-schedule` (bool) — sunset→sunrise (1.2)
- `idle-timeout` (int) — auto-lock delay (1.5)
- `auto-lock-enabled` (bool) — auto-lock toggle (1.5)
- `screen-dim-enabled` (bool) — dim before lock (1.5)
- Theme color keys (accent, destructive, etc.) — for theme editor (3.8)

### `weather` schema
- `latitude`, `longitude`, `auto-location` — complete for current needs

---

## 6. Version Inconsistencies

AGENTS.md says version is `0.2.0`, but:
- `meson.build`: `version: '0.2.1'`
- `package.json`: `"version": "0.2.1"`

`nix/desktop-shell.nix` was not checked for version — AGENTS.md says all three must be kept in sync.

---

## 7. Architecture Observations

### Strengths
- **Clean singleton pattern** — All services use `@register()` + `get_default()`
- **Reactive GSettings** — `gnim-schemas` provides live settings updates
- **Gnim context** — `SettingsProvider` wraps entire widget tree
- **Modular bar** — Bar components are separate files, easy to extend
- **Per-monitor awareness** — Wallpaper, bar, lockscreen all instantiate per-monitor
- **CLI integration** — `requestHandler` supports multiple commands cleanly
- **Controllable subprocesses** — `screenshot.ts` correctly uses `subprocessv()` + `signal(2)` for wf-recorder

### Weaknesses / Technical Debt
- **Hardcoded `/tmp` path** — `touchpad.ts` writes to `/tmp/shade-touchpad-toggle.py`
- **No i18n infrastructure** — `main.ts` calls `bindtextdomain` but no `.po` files exist
- **Error swallowing** — `wl-copy` errors in `screenshot.ts` caught with empty handler
- **GSettings schema bloat risk** — Adding 15+ new keys for module toggles and settings will make `gschema.ts` large; consider splitting or documenting migration
- **No hot-reload** — Styles require full rebuild/restart
- **Limited launcher** — Only app search; no evaluators, no clipboard history, no window switching
- **Bar is not truly modular** — Components are separate files but rendered unconditionally; no runtime toggles

---

## 8. Recommended Roadmap Corrections

### Mark as DONE
| Item | Reason |
|------|--------|
| **0.6 System Resource Monitors** | Already in `systemUsage.tsx` |
| **1.6 Audio Device Selector** | Already in `audioControl.tsx` |
| **3.9 Screenshot & Recording UI** | Fully implemented with QS button, bar indicator, CLI, and service |

### Move to Different Phase
| Item | From | To | Reason |
|------|------|-----|--------|
| **3.10 i18n** | Phase 3 | Phase 1 | Medium effort, high accessibility impact. `gettext` infrastructure is foundational. |
| **1.7 Notification History** | Phase 1 | Phase 1 (keep) | Partially done (popups work). Only history and per-app settings are missing. |

### Add New Items
| Item | Phase | Why |
|------|-------|-----|
| **Touchpad Toggle** | Phase 0 (existing) | Already done, document it |
| **Auto-cpufreq Integration** | Phase 0 (existing) | Already done, unique feature |
| **Fingerprint Auth** | Phase 0 (existing) | Already done, document it |
| **Launcher Frecency Ranking** | Phase 1 | `AstalApps.frequency` is used but not weighted by recency |
| **Notification Actions** | Phase 1 | Popups show actions but may not handle all action types |

### Re-prioritize Based on Astal Rice Research
| Item | Priority | Reason |
|------|----------|--------|
| **Dynamic Theming (3.1)** | High | matshell/colorshell/Ateon all have this; major visual differentiator |
| **Launcher Enhancements (3.5)** | High | faiyt-ags sets the bar; math/emoji/web search are expected |
| **Per-App Volume (1.3)** | High | Standard in HyprPanel, faiyt-ags; AstalWp may support it |
| **Window Title in Bar (0.5)** | Medium | Nearly every bar has this; low effort |
| **Bar Module Toggle UI (2.4)** | Medium | HyprPanel/faiyt-ags have this; user control |
| **Night Light (1.2)** | Medium | Standard desktop feature |
| **Clipboard History (1.1)** | Medium | `cliphist` + `wl-clipboard` are standard Hyprland tools |

---

> **Next steps:**
> 1. Update ROADMAP.md to mark 0.6, 1.6, and 3.9 as `[DONE]`
> 2. Add "Exists but not in roadmap" features to the matrix
> 3. Re-prioritize Phase 1/3 based on this analysis
> 4. Address the version inconsistency (`0.2.0` vs `0.2.1`)
