# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Media player widget** re-enabled in Quick Settings expander — shows active MPRIS players with cover art, controls, and playback status

### Added

- **Power menu** in Quick Settings tray — replaces instant shutdown with a popover containing Lock, Log Out, Suspend, Reboot, and Power Off options

### Fixed

- **`setScreelocked` typo** fixed to `setScreenlocked` across all files (index, lockscreen, requestHandler, tray)
- **Settings wallpaper dialog** no longer crashes when user cancels the file picker
- **Weather widgets** (bar and QS expander) now handle null `info` gracefully during initialization
- **Settings network panel** now uses reactive `createBinding` for wifi/wired instead of one-time property access
- **OSD monitor** now correctly tracks focused monitor instead of hardcoding monitor 1
- **Disk usage** formula fixed to show actual used percentage
- **App launcher** no longer crashes on empty search + Enter
- **Media player** skip-backward icon name and null-safe app icon lookup
- **Color scheme** names now correctly return "Light" and "Dark" instead of "Auto"
- **Keyboard brightness** setter now uses percentage (`%`) instead of absolute value
- **Brightness module** no longer crashes on startup when no backlight devices exist (desktop PCs, VMs)
- **`dev` script** now compiles schemas with `glib_compile_schemas` and uses `&&` chaining
- **Wallpaper install path** now correctly installs to `datadir/shade-shell/`

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
