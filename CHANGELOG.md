# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Shared logger utility** (`src/lib/logger.ts`) — replaces all inline `const timestamp = ...` patterns with `logger.log()` that auto-prefixes every message with `[Shade] HH:MM:SS.ffffff -`
- **SKILL.md** — pi-agent skill definition with YAML frontmatter for the agent skills ecosystem
- **YAML frontmatter in AGENTS.md** — metadata fields for pi-agent integration
- **Media player widget** re-enabled in Quick Settings expander — shows active MPRIS players with cover art, controls, and playback status
- **Power menu** in Quick Settings tray — replaces instant shutdown with a popover containing Lock, Log Out, Suspend, Reboot, and Power Off options
- **`ShellState` singleton** (`src/lib/shellState.ts`) — centralizes reactive state for launcher, quick settings, and screen lock; decouples CLI layer from widgets
- **`WindowManager` singleton** (`src/lib/windowManager.ts`) — replaces direct `app.*` window mutations with a typed registry
- **`MonitorService` singleton** (`src/lib/monitors.ts`) — deduplicates monitor tracking and fixes hot-plug via proper `items-changed` signal
- **Utility modules** — `src/lib/gjsUtils.ts` (`toArray`, `listLength`), `src/lib/audio.ts` (`getVolumeIcon`), `src/lib/time.ts` (`fmtOffset`, `cityName`)
- **Widget mount isolation** — each widget in `src/widget/index.tsx` is wrapped in `try/catch` so one failure does not prevent others from mounting
- **Bar indicator decomposition** — `systemIndicators.tsx` split into individual components under `src/widget/bar/indicators/`
- **Network widget decomposition** — `network.tsx` split into `utils.ts`, `apList.tsx`, `passwordDialog.tsx`, `wifiPopover.tsx`, and `index.tsx`
- **NixOS module layering** — new `programs.shade.desktop` option group; Hyprland imports are now conditional on `desktop.enable` instead of unconditional
- **Lazy-loaded Settings window** — `Adw.PreferencesWindow` is no longer created eagerly on startup; created on first open via `shade-shell toggle settings`
- **Touchpad Python script extraction** — removed standalone data/scripts/toggle-touchpad.py; lightweight embedded grab script remains in `touchpad.ts`; EC hardware toggle is the preferred path
- **Window title in bar** — shows active window title + app icon in the bar center; hidden on empty workspace
- **Keyboard layout indicator** — shows current XKB layout short code (e.g., "US", "BR") in system indicators; click cycles layout
- **Bar module toggles** — all bar components (launcher, workspaces, window title, system resources, clock, weather, system indicators, keyboard layout) can be shown/hidden individually from Settings → Bar
- **Night Light** — `NightLight` singleton manages `hyprsunset` subprocess for blue light filtering; QS toggle with temperature slider (2000K–6500K) and auto-schedule via sunrise/sunset; settings in Settings → General
- **Idle / Auto-Lock controls** — `Hypridle` singleton generates `~/.config/hypr/hypridle.conf` dynamically and manages `hypridle` subprocess; QS toggle with lock timeout and dim-before-lock options; respects Caffeinated inhibit state
- **Clipboard History** — launcher prefix mode: typing `>` switches to clipboard search via `cliphist`; shows text preview and image indicators; Enter copies selected item back to clipboard
- **Per-Application Volume Mixer** — `AppMixer` polls `pw-dump` for audio output streams; shows app icon, name, mute toggle, and volume slider for each active stream in Quick Settings below speaker slider
- **Notification History** — `NotificationHistory` singleton persists last 100 notifications to `$XDG_CACHE_HOME/shade/notifications.json`; QS notification list has history view with timestamps and per-entry delete; popup shows countdown progress bar
- **Dynamic Theming (Material You)** — `Theming` singleton runs `matugen` on wallpaper change to extract accent colors; injects CSS via `Gtk.CssProvider`; toggle and regenerate button in Settings → General
- **Window Switcher (Alt-Tab)** — `src/widget/windowswitcher/` with MRU sorting, keyboard navigation (Tab/Shift+Tab/Enter/Escape/Q), app icons, and workspace badges; bound to `Super+Tab` in Hyprland config
- **Dock / Taskbar** — `src/widget/dock/` with pinned + running apps, active/running indicators, left-click focus/launch, right-click context menu (Focus/Close/Pin); settings in Settings → Bar

### Fixed

- **P0/P1 crash bugs** — display null guard, slider subscription leak, fingerprint listener accumulation, wallpaper async loading, screenshot race condition, auto-cpufreq timeout leak, inhibit cookie leak, weather signal leak, geolocation dedup + retry, touchpad stale lock file
- **Service initialization order** — `Weather`, `ColorScheme`, and `Inhibit` no longer call `useSettings()` in constructors; they use explicit `init()` methods
- **`setScreelocked` typo** fixed to `setScreenlocked` across all files (index, lockscreen, requestHandler, tray)
- **Settings wallpaper dialog** no longer crashes when user cancels the file picker
- **`GObject.notify()` property names** fixed to use kebab-case (`"launcher-open"` instead of `"launcherOpen"`) in `ShellState` setters — signals were silently not firing, breaking all reactive bindings
- **`AstalNotifd` 25-second D-Bus timeout** avoided in `NotificationHistory` constructor — deferred `Notifd.get_default()` to `GLib.idle_add` to prevent blocking the main loop
- **Notification popup widget** no longer crashes with "out of tracking context" — restructured to mount immediately in Gnim scope and defer only `Notifd.get_default()` via `onMount` + `GLib.idle_add`
- **`@signal()` decorator in `FingerprintAuth`** fixed — uses proper GObject types (`GObject.TYPE_STRING`) instead of raw `String` constructor, which caused `No signal 'statusChanged'` errors
- **Tray icon null safety** — `gicon` null guard added to prevent `string_to_string` assertion failures
- **Notification null safety** — `notif.app_icon`, `notif.summary`, `notif.body` guards against null values
- **Startup time reduced** — removed 25-second Notifd D-Bus timeout from startup sequence by deferring initialization
- **README.md** rewritten with full project documentation, architecture overview, and quick-start guide
- **Weather widgets** (bar and QS expander) now handle null `info` gracefully during initialization
- **Settings network panel** now uses reactive `createBinding` for wifi/wired instead of one-time property access
- **Temperature reading** in systemUsage is now async via Gio instead of blocking the UI thread every second
- **`setInterval` leaks** eliminated across bar clock, systemUsage, world clock, and lock screen — now use `GLib.timeout_add` with proper `GLib.source_remove` cleanup
- **Workspace client iteration** no longer crashes — `GLib.List` from AstalHyprland is converted to JS array before passing to `For`
- **Notification popups** no longer dismiss while being hovered — timeout pauses on mouse enter and resumes on leave
- **OSD popups** now reset their timeout on every re-trigger instead of using the original timeout
- **App launcher** now shows "No apps found" when search yields no results and closes on Escape key
- **App launcher / Quick Settings crash** fixed — removed `<For>` nested inside `<With>` which caused gnim to throw "nesting Fragments are not yet supported" and prevented all widgets after `applauncher()` from mounting
- **OSD monitor** now correctly tracks focused monitor instead of hardcoding monitor 1
- **Disk usage** formula fixed to show actual used percentage
- **App launcher** no longer crashes on empty search + Enter
- **Media player** skip-backward icon name and null-safe app icon lookup
- **Color scheme** names now correctly return "Light" and "Dark" instead of "Auto"
- **Keyboard brightness** setter now uses percentage (`%`) instead of absolute value
- **Brightness module** no longer crashes on startup when no backlight devices exist (desktop PCs, VMs)
- **`dev` script** now compiles schemas with `glib_compile_schemas` and uses `&&` chaining
- **Wallpaper install path** now correctly installs to `datadir/shade-shell/`
- **Nix module** fixed: `bindm` syntax, removed unloaded plugin config, added `package` option, fixed `layerrule` syntax (`blur on`, `ignore_alpha`), neutralized personal defaults, added missing wrapper packages
- **Flake wrapper packages** expanded: added `cliphist`, `hyprsunset`, `hypridle`, `matugen`; added `astal-cava` to build inputs
- **Hyprland binds** added `SUPER+TAB` for window switcher; fixed `XF86TouchpadToggle` to use installed script path instead of `/tmp`

## [0.2.1] - 2026-04-29

### Fixed

- **Bluetooth indicator** now reflects connected device state (shows `bluetooth-active-symbolic` when a device is connected, with tooltip listing device names)
- **Battery indicator** colors dynamically based on `warning_level`: red (`error`) for critical/action level, orange (`warning`) for low/discharging
- **App launcher search** now grabs focus when opened and clears its text + resets the app list when closed
- **Auto-cpufreq state reading** fixed by reading the internal Python pickle file (`/opt/auto-cpufreq/override.pickle`) instead of the non-existent `--get-state` CLI flag

## [0.2.0] - 2026-04-28

### Added

- **Recording modes** — `wf-recorder` now supports selective recording:
  - `Record Area` — interactive region selection via `slurp`
  - `Record Window` — captures the currently focused Hyprland window
  - `Record Output` — captures the focused monitor
  - `Record Audio` toggle — enables `-a` audio capture for recordings
- New CLI commands: `record-area`, `record-window`, `record-output`
- Quick Settings screenshot button dropdown reorganized into Screenshot and Record sections

## [0.1.0] - 2024-06

### Added

- Initial release of Shade Shell
- Status bar with workspaces, system usage, clock, weather, and system indicators
- App launcher with fuzzy search
- Quick Settings panel with toggles, sliders, system tray, and notifications
- Notification popups with auto-dismiss
- OSD for volume and brightness
- PAM-based lock screen across all monitors
- Per-monitor wallpaper with day/night switching
- Libadwaita preferences window
- Screenshot and screen recording support via `grim`, `slurp`, and `wf-recorder`
- NixOS module and VM for testing
