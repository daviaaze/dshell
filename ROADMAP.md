# Shade Shell Roadmap

> Living document tracking planned features, improvements, and technical debt.
> Update status as work progresses. Mark items `[DONE]` when merged and tested.

---

## Legend

| Status | Meaning |
|--------|---------|
| `[TODO]` | Not started — up for grabs |
| `[WIP]` | In progress — someone is working on it |
| `[DONE]` | Complete — merged, tested, and working |
| `[BLOCKED]` | Waiting on external dependency or decision |

| Effort | Meaning |
|--------|---------|
| `Trivial` | < 30 min — config change, uncomment code, one-liner |
| `Low` | Few hours — isolated component, no new dependencies |
| `Medium` | 1–2 days — touches multiple files, needs design decisions |
| `High` | 3–7 days — complex feature, new service, architectural work |

---

## Phase 0 — Quick Wins (Immediate)

> Features that are nearly free. Do these first for maximum impact.

---

### 0.1 — Re-enable Media Player Widget

- **Status:** `[DONE]` (see `src/widget/quicksettings/expander/media.tsx`)
- **Effort:** Trivial
- **Why:** Fully implemented in `src/widget/quicksettings/expander/media.tsx` but commented out in `expander/index.tsx`.
- **Files:**
  - `src/widget/quicksettings/expander/index.tsx`
- **Approach:**
  1. Uncomment `import { Media, MediaIcon } from "./media"`
  2. Uncomment `<MediaIcon />` in `Heading`
  3. Uncomment `<Media />` in `Revealer`
  4. Verify no runtime errors with `AstalMpris` when no players are active
- **Acceptance:**
  - [ ] Media icon appears in expander header when a player is running
  - [ ] Media card shows in expander with cover art, title/artist, playback controls
  - [ ] Nothing breaks when no MPRIS players are active
  - [ ] Tested with Spotify, Firefox (YouTube), and a local player

---

### 0.2 — Replace Instant Shutdown with Power Menu

- **Status:** `[DONE]` (see `src/widget/common/powerMenu.tsx`)
- **Effort:** Low
- **Why:** Currently the power button in Quick Settings tray immediately calls `systemctl poweroff`. Every other shell shows a confirmation menu with Lock / Log Out / Suspend / Reboot / Power Off.
- **Files:**
  - `src/widget/quicksettings/tray.tsx`
  - New: `src/widget/common/powerMenu.tsx` (or inline dialog)
- **Approach:**
  1. Create a small `Gtk.Popover` or `Adw.MessageDialog` with 5 actions:
     - Lock → `setScreenlocked(true)`
     - Log Out → `hyprctl dispatch exit` or `loginctl terminate-session`
     - Suspend → `systemctl suspend`
     - Reboot → `systemctl reboot`
     - Power Off → `systemctl poweroff` (destructive style)
  2. Replace the direct `systemctl poweroff` in `TrayBox` with a popover trigger
  3. Add keyboard shortcut support (e.g., `Super+Shift+E` opens power menu)
- **Acceptance:**
  - [ ] Clicking power button opens a menu, does not shut down immediately
  - [ ] All 5 session actions work correctly
  - [ ] Power Off has `destructive-action` styling
  - [ ] Menu closes on escape or click outside
  - [ ] Optional: add confirmation dialog for Power Off / Reboot

---

### 0.3 — Add Keyboard Layout Indicator to Bar

- **Status:** `[DONE]` (see `src/lib/keyboard.ts`)
- **Effort:** Low
- **Why:** Essential for multi-language users. Shows current XKB layout and allows switching. Standard in Waybar, HyprPanel, and GNOME.
- **Files:**
  - `src/widget/bar/systemIndicators.tsx`
  - New: `src/lib/keyboard.ts`
  - `src/lib/gschema.ts`
- **Approach:**
  1. Create `Keyboard` singleton that parses `hyprctl devices -j` every 2s via `AstalIO.Process.exec_async`
  2. Extract `keyboards[].active_keymap` (e.g., "English (US)", "Portuguese (Brazil)")
  3. Derive short code: "US", "BR", "DE" by splitting on space/parentheses
  4. Add indicator to `systemIndicators.tsx` (between network and battery)
  5. Click calls `hyprctl switchxkblayout [mainKeyboard] next`
  6. Tooltip shows full layout name and all available layouts
  7. Add GSettings key `show-keyboard-layout` (bool, default true) to bar schema
  8. Hide indicator entirely when only one layout is configured
- **Hyprland API:**
  - `hyprctl devices -j` → parse `keyboards[].active_keymap`, `keyboards[].name`
  - `hyprctl switchxkblayout [name] next`
- **Edge Cases:**
  - Hyprland must have `kb_layout` with multiple values in config for switching to work
  - Some keyboards report keymap as locale codes ("us", "br") — normalize to uppercase
- **Acceptance:**
  - [ ] Layout short code (e.g., "US", "BR") visible in bar when multiple layouts configured
  - [ ] Indicator completely hidden when only one layout is available
  - [ ] Click cycles to next layout immediately
  - [ ] Tooltip shows full layout name (e.g., "English (US)")
  - [ ] Updates within 2s of external layout change (e.g., `hyprctl switchxkblayout`)
  - [ ] Toggleable in Settings → Bar

---

### 0.4 — Autostart Polkit Authentication Agent

- **Status:** `[TODO]`
- **Effort:** Trivial
- **Why:** GUI apps requesting elevation (GParted, virt-manager, some installers) need a polkit agent running. Without it, they hang or fail silently. This is a standard expectation of any desktop environment.
- **Files:**
  - `nix/module.nix`
  - `nix/hyprland/default.nix`
- **Approach:**
  1. Add `pkgs.hyprpolkitagent` to the NixOS module's `systemPackages` when `programs.shade.shell.enable` is true
  2. Add `exec-once = hyprpolkitagent` to the generated Hyprland config
  3. Ensure the agent is NOT wrapped with `uwsm-app` — polkit agents must run outside uwsm to work correctly
  4. Verify `hyprpolkitagent` is available in nixpkgs unstable; if not, fallback to `lxqt-policykit-agent` or `polkit_gnome`
- **Acceptance:**
  - [ ] Running `pkexec echo test` from a terminal inside the Shade session shows an auth dialog
  - [ ] Agent auto-starts on Hyprland launch
  - [ ] Agent is not duplicated on shell restart
  - [ ] Auth dialog appears within 2s of `pkexec` invocation
  - [ ] Works for both native Wayland and XWayland apps requesting elevation

---

### 0.5 — Window Title in Bar

- **Status:** `[DONE]` (see `src/widget/bar/windowTitle.tsx`)
- **Effort:** Low
- **Why:** Standard in nearly every bar (Waybar, HyprPanel, faiyt-ags). Shows what window is focused and which app it belongs to. Currently Shade only shows workspace indicators with client icons, but no prominent active window title.
- **Files:**
  - `src/widget/bar/index.tsx`
  - New: `src/widget/bar/windowTitle.tsx`
  - `src/lib/gschema.ts`
- **Approach:**
  1. Create `WindowTitle` component using `AstalHyprland.Hyprland.get_default().focused_client`
  2. Show app icon (from `client.class` mapped to icon name via `AstalApps.Application`) + window title (`client.title`)
  3. Truncate long titles with `max-width-chars` and `ellipsize=END`
  4. Place in bar `CenterBox` center child, between workspaces (start) and clock (end)
  5. Hidden when no window is focused (`client.address === "0x0"`)
  6. Add GSettings key `show-window-title` (bool, default true)
  7. Optional interactions:
     - Middle-click → close window (`hyprctl dispatch closewindow address:${client.address}`)
     - Right-click → context menu: Minimize, Maximize, Close, Move to Workspace
     - Scroll → cycle windows of same class
- **Edge Cases:**
  - Empty workspace → hide completely (don't show "Desktop" placeholder unless user wants it)
  - Very long titles (e.g., browser tab) → truncate at ~40 chars
  - Special characters in title → sanitize for Pango markup
- **Acceptance:**
  - [ ] Shows active window title + app icon when a window is focused
  - [ ] Updates within 100ms of focus change
  - [ ] Completely hidden on empty workspace
  - [ ] Long titles truncate with ellipsis, never overflow bar
  - [ ] Middle-click closes the focused window
  - [ ] Toggleable in Settings → Bar

---

### 0.6 — System Resource Monitors in Bar

- **Status:** `[DONE]` (see `src/widget/bar/systemUsage.tsx`)
- **Effort:** Low
- **Why:** A basic implementation exists in `systemUsage.tsx`, but it lacks polish, configurability, and several metrics compared to HyprPanel/faiyt-ags.
- **Files:**
  - `src/widget/bar/systemUsage.tsx`
  - `src/widget/bar/index.tsx`
  - `src/lib/gschema.ts`
- **Current State:**
  - `systemUsage.tsx` already polls CPU, RAM, disk usage, and temperature via `libgtop` every 1000ms
  - Temperature requires manual `temp-path` configuration; no auto-detection
  - Presented as `Gtk.LevelBar` widgets in a compact bar section
  - Click opens a configurable system monitor command
- **Missing / To Improve:**
  1. **CPU temperature auto-detection** — Scan `/sys/class/hwmon/hwmon*/temp*_input` at startup; pick highest reading or first valid sensor. Fall back to `temp-path` if user overrides.
  2. **Network speed monitoring** — Use `glibtop_netlist` + `glibtop_netload` to show ↓↑ speeds in bar.
  3. **GPU usage** (optional) — Parse `nvidia-smi` output for NVIDIA GPUs; show as optional module.
  4. **Visual polish** — Replace plain `LevelBar` with icon + percentage label (e.g., ` 12%` ` 4.2G`). Use `Adw.Clamp` or fixed width to prevent bar jitter.
  5. **Tooltip details** — On hover, show: CPU load average, RAM used/total, disk used/total, network iface + speed.
  6. **Per-module visibility toggles** — Add GSettings keys `show-cpu`, `show-ram`, `show-temp`, `show-disk`, `show-net` so users can hide individual monitors without hiding the whole block.
  7. **Polling interval setting** — Allow 1s, 2s, 5s via GSettings.
- **Acceptance:**
  - [ ] CPU usage shows as icon + percentage (e.g., ` 12%`)
  - [ ] RAM usage shows as icon + percentage (e.g., ` 4.2G / 16G`)
  - [ ] CPU temperature auto-detected without manual `temp-path` config
  - [ ] Network ↓↑ speed visible in bar when enabled
  - [ ] Tooltip shows detailed breakdown on hover
  - [ ] Each metric can be toggled on/off independently in Settings → Bar
  - [ ] Click opens configured system monitor
  - [ ] Updates dynamically, CPU overhead <1%

---

### 0.7 — Power Profile Review

- **Status:** `[TODO]`
- **Effort:** Low
- **Why:** `auto-cpufreq` integration was removed (no longer in use). Current power profile widget
  (`powerprofiles.tsx`) uses `AstalPowerProfiles` directly with`power-profiles-daemon`.
  Needs visual feedback on switch and tooltip info.
- **Files:**
  - `src/widget/quicksettings/button-grid/powerprofiles.tsx`
  - `src/lib/powerProfiles.ts`
- **Acceptance:**
  - [ ] Profile switch shows spinner/loading state
  - [ ] Tooltip shows current profile + governor
  - [ ] Falls back gracefully if `power-profiles-daemon` is not running

---

### 0.8 — Idle Inhibit (Caffeinated) Review

- **Status:** `[WIP]`
- **Effort:** Low
- **Why:** Already implemented but tightly coupled to `app` singleton, has no cookie overflow protection, and lacks a bar indicator. Needs decoupling and polish for production.
- **Files:**
  - `src/lib/inhibit.ts`
  - `src/widget/quicksettings/button-grid/caffeinated.tsx`
  - `src/widget/bar/systemIndicators.tsx`
- **Current State:**
  - `Inhibit` singleton uses GTK `ApplicationInhibitFlags.IDLE`
  - Tightly coupled to `app` from `App.tsx` — will throw if `app` doesn't exist
  - Hardcoded reason string: `"toggled by shade-shell"`
  - Stores cookie in `#cookie` but has no overflow protection
  - QS button shows `suggested-action warning` CSS when active
  - No indicator in the bar when inhibit is active
- **Production Gaps:**
  1. **Bar indicator** — Add a coffee cup icon to `systemIndicators.tsx` when `inhibit.idle` is true. Click to disable.
  2. **Decouple from app** — Accept the application instance as a constructor parameter or use a lazy getter with null-check.
  3. **Cookie overflow protection** — If `inhibit()` is called repeatedly (bug), ensure old cookies are released before acquiring new ones.
  4. **Configurable reason** — Add GSettings `idle-inhibit-reason` (string, default "User requested"). Show in tooltip.
  5. **Settings integration** — Add toggle in Settings → General: "Show Caffeinated Indicator in Bar" (default: true).
  6. **Integration with Night Light / Idle Controls** — When inhibit is active, auto-lock (1.5) should be suppressed. Document this interaction.
- **Acceptance:**
  - [ ] Coffee cup icon appears in bar when inhibit is active
  - [ ] Clicking bar indicator disables inhibit
  - [ ] No crash if `app` is not yet initialized when `Inhibit.get_default()` is called
  - [ ] Repeated toggles do not leak inhibit cookies
  - [ ] Tooltip shows inhibit reason
  - [ ] Toggleable in Settings → General
  - [ ] Auto-lock (1.5) is suppressed when inhibit is active

---

### 0.9 — World Clock Review

- **Status:** `[WIP]`
- **Effort:** Low
- **Why:** Already implemented but lacks DST handling, 12h/24h format preference, and timezone abbreviation display. Needs polish for production.
- **Files:**
  - `src/widget/bar/clock.tsx`
  - `src/widget/quicksettings/expander/worldClock.tsx`
  - `src/lib/gschema.ts`
- **Current State:**
  - World clock list shows in bar popover and QS expander
  - Configurable via GSettings `timezones` string array
  - Updates every second via `GLib.timeout_add`
  - Shows time and offset (e.g., "+3h", "same time")
  - Settings → Clock page allows adding/removing timezones
- **Production Gaps:**
  1. **12h/24h format** — Add GSettings `clock-format` (string: `"12h"` or `"24h"`, default `"24h"`). Apply to bar clock, world clock, and QS world clock.
  2. **DST indicator** — Show a small sun/clock icon or "DST" label next to timezones currently in daylight saving time.
  3. **Timezone abbreviation** — Show abbreviation (e.g., "EST", "BRT", "AEDT") alongside city name.
  4. **Date display** — Show date (e.g., "Mon 28") next to time for timezones where it's a different day.
  5. **Performance** — Currently updates every second for all timezones. Use a single shared timer in `clock.tsx` and pass time down to world clock components to avoid multiple `timeout_add` sources.
  6. **Preset timezones** — In Settings → Clock, add a popover with common presets (New York, London, Tokyo, Sydney, São Paulo, Berlin) instead of requiring manual TZ identifier entry.
- **Acceptance:**
  - [ ] 12h/24h format toggle in Settings → Clock
  - [ ] World clock shows timezone abbreviation (e.g., "BRT")
  - [ ] DST status indicated visually
  - [ ] Different-day timezones show date (e.g., "Mon 28")
  - [ ] Single shared timer drives all clock updates
  - [ ] Preset timezone list in Settings for common cities
  - [ ] Format applies consistently to bar clock, popover, and QS expander

---

## Phase 1 — Daily Workflow (Short Term)

> Features that users interact with every day. High impact, moderate effort.

---

### 1.1 — Clipboard History Manager

- **Status:** `[DONE]` (see `src/lib/clipboard.ts`)
- **Effort:** Medium
- **Why:** `cliphist` + `wl-clipboard` is in virtually every Hyprland dotfile. Integrating it into Shade eliminates an external dependency and feels native. The launcher is the ideal place for this — prefix-based search (`> `) keeps it fast.
- **Files:**
  - `src/lib/clipboard.ts` (new)
  - `src/widget/applauncher/index.tsx`
  - `src/lib/gschema.ts`
- **Approach — Option A (cliphist, recommended):**
  1. Add `cliphist` to Nix wrapper packages (`wl-clipboard` is already wrapped)
  2. Start `wl-paste --watch cliphist store` as a managed subprocess on shell startup (or document that user must run it)
  3. Query history via `AstalIO.Process.exec_async("cliphist list")`
  4. Decode images if needed (`cliphist decode [id]`)
  5. UI: launcher prefix mode — typing `>` switches to clipboard search
- **Approach — Option B (native, more work):**
  1. Use `AstalIO.Process.subprocessv(["wl-paste", "--watch", ...])` to monitor clipboard ourselves
  2. Store history in `$XDG_CACHE_HOME/shade/clipboard.json` (max 500 entries)
  3. Render in UI with text preview and image thumbnails
- **UI Details:**
  - Launcher prefix: `>` (e.g., `> https` filters clipboard items containing "https")
  - Each result shows: text preview (first 60 chars), timestamp ("2m ago"), mime type icon
  - Image items show a 32px thumbnail preview
  - Pressing Enter on selected item copies it back to clipboard and closes launcher
  - `Ctrl+Delete` on selected item removes it from history
- **Security:**
  - Ignore clipboard from password managers: detect window class `keepassxc`, `bitwarden`, `1password`, `seahorse`, `gnome-keyring`
  - Never log or persist password-manager clipboard entries
- **Acceptance:**
  - [ ] Typing `>` in launcher switches to clipboard search mode
  - [ ] Clipboard items show text preview + timestamp
  - [ ] Image items show thumbnail preview
  - [ ] Enter copies selected item back to clipboard
  - [ ] History accumulates automatically (via cliphist or native monitor)
  - [ ] Max 500 entries, oldest evicted
  - [ ] Password manager clipboard entries are ignored
  - [ ] `Ctrl+Delete` removes item from history
  - [ ] "Clear History" button in QS or launcher UI

---

### 1.2 — Night Light / Blue Light Filter Toggle

- **Status:** `[DONE]` (see `src/lib/nightLight.ts`)
- **Effort:** Low–Medium
- **Why:** GNOME, KDE, macOS, and Windows all have this. Users expect it in Quick Settings. Reduces eye strain in evening hours.
- **Files:**
  - `src/lib/nightLight.ts` (new)
  - `src/widget/quicksettings/button-grid/` (new toggle)
  - `src/widget/settings/general.tsx`
  - `src/lib/gschema.ts`
  - `nix/module.nix`
- **Backend Decision: Use `hyprsunset`**
  - Native Hyprland tool, no D-Bus complexity
  - Simple CLI: `hyprsunset --temperature 3000` / `hyprsunset --identity`
  - Add `pkgs.hyprsunset` to Nix wrapper packages
- **Approach:**
  1. Create `NightLight` singleton that manages a `hyprsunset` subprocess
  2. Add GSettings keys to `general` schema:
     - `night-light-enabled` (bool, default false)
     - `night-light-temperature` (int, default 3500, range 2000–6500)
     - `night-light-auto-schedule` (bool, default false)
  3. Add toggle to QS button grid (sun icon when off, sun-with-lines when on)
  4. Dropdown shows temperature slider (2000K–6500K) + "Auto Schedule" switch
  5. Settings → General: full Night Light section with temperature slider and auto-schedule
  6. Auto-schedule: reuse `ColorScheme` sunrise/sunset times. Enable at sunset, disable at sunrise.
  7. On startup: if enabled, spawn `hyprsunset`; if disabled, ensure no process is running
- **Edge Cases:**
  - If `hyprsunset` is not installed, show toggle as disabled with tooltip "Install hyprsunset"
  - User manually runs `hyprsunset` → Shade should detect and sync state (poll every 5s)
  - Changing temperature while active → kill old process, start new one with new temp
- **Acceptance:**
  - [ ] Toggle in QS turns night light on/off within 1s
  - [ ] Temperature slider adjusts from 2000K (warm/red) to 6500K (cool/white)
  - [ ] Auto-schedule enables at sunset, disables at sunrise using existing weather data
  - [ ] State persists across shell restarts via GSettings
  - [ ] Settings → General has dedicated Night Light section
  - [ ] No conflict with manual color scheme (light/dark) switching
  - [ ] Gracefully handles missing `hyprsunset` binary

---

### 1.3 — Per-Application Volume Mixer

- **Status:** `[DONE]` (see `src/lib/appMixer.ts`)
- **Effort:** Medium
- **Why:** Current audio controls only show ENDPOINTS (output devices like headphones vs speakers). Users want to control STREAMS per-app: "Discord at 30%, Spotify at 80%, Firefox muted." This is standard in GNOME Settings, pavucontrol, and HyprPanel.
- **Files:**
  - `src/widget/common/audioControl.tsx`
  - `src/widget/quicksettings/sliders.tsx`
  - `src/lib/gschema.ts`
- **Approach:**
  1. Research AstalWp API for audio streams/nodes:
     - Check if `AstalWp` exposes `WpObject` / `WpNode` with `media.class` or `node.name`
     - If AstalWp doesn't expose streams, use `wpctl status` parsing or `pw-dump` JSON
  2. Create new `AppStreamMixer` component showing a list of audio-producing applications
  3. Each stream row shows:
     - App icon (lookup via `AstalApps` from `node.name` or `app.name`)
     - App name (e.g., "Discord", "Firefox")
     - Stream description (e.g., "Playback", "Mic")
     - Mute toggle button
     - Volume slider (0–100%)
  4. Place below the main speaker slider in QS, inside a collapsible section (default collapsed)
  5. Show only when at least one stream is active
  6. Update dynamically as apps start/stop audio
- **Astal API Research Needed:**
  - `AstalWp` — does it have `streams`, `nodes`, or `clients` properties?
  - If not, parse `pw-dump` JSON for nodes with `media.class = "Stream/Output/Audio"`
  - Volume control via `wpctl set-volume [id] 0.X` or PipeWire D-Bus
- **Acceptance:**
  - [ ] Collapsible "Applications" section appears below speaker slider when streams are active
  - [ ] Each active audio app shown with icon, name, mute toggle, volume slider
  - [ ] Volume changes apply immediately to that app only
  - [ ] Mute toggle mutes/unmutes that app only
  - [ ] List updates within 1s of app starting/stopping audio
  - [ ] Empty when no apps are playing audio (section hidden or shows "No active audio")
  - [ ] Does not interfere with endpoint (device) selection in `audioControl.tsx`

---

### 1.4 — System Updates Checker

- **Status:** `[TODO]`
- **Effort:** Low
- **Why:** One-click visibility into pending updates is a standard bar feature (HyprPanel, Waybar custom scripts, GNOME extensions). For NixOS users, knowing when `nix flake update` has new inputs is valuable.
- **Files:**
  - `src/lib/updates.ts` (new)
  - `src/widget/bar/systemIndicators.tsx`
  - `src/lib/gschema.ts`
- **Approach:**
  1. Create `Updates` singleton that detects OS and runs appropriate checker:
     - **NixOS (primary):** Run `nixos-rebuild dry-build 2>&1` and parse "these derivations will be built" count. Cache result for 30 min.
     - **Arch:** Run `checkupdates` (from `pacman-contrib`) and count lines.
     - **Fedora:** Run `dnf check-update --quiet` and count lines.
     - **Fallback:** Check for existence of `/run/miso/bootmnt` or `/etc/NIXOS` to detect OS.
  2. Poll every 30 minutes via `GLib.timeout_add_seconds`
  3. Show in `systemIndicators.tsx` as a small badge: `package-upgrade-symbolic` + count
  4. Click opens terminal with update command:
     - NixOS: `defaultTerminal -e sudo nixos-rebuild switch`
     - Arch: `defaultTerminal -e sudo pacman -Syu`
  5. Add GSettings key `show-updates` (bool, default true)
  6. Hide indicator entirely when count is 0
  7. Tooltip shows: "N packages pending update" + "Last checked: 12:34"
- **Performance Considerations:**
  - `nixos-rebuild dry-build` can take 10–30s on slow machines; run in background thread
  - Use `AstalIO.Process.exec_async` to avoid blocking UI
  - Cache last result and timestamp; show cached count while checking
- **Acceptance:**
  - [ ] Shows pending update count badge when > 0
  - [ ] Completely hidden when system is up to date
  - [ ] Click opens terminal with appropriate update command
  - [ ] Polls every 30 minutes automatically
  - [ ] Tooltip shows count and last-check time
  - [ ] Works on NixOS (primary target)
  - [ ] Toggleable in Settings → Bar
  - [ ] Does not block UI while checking

---

### 1.5 — Idle / Auto-Lock / Screen Dimming Controls

- **Status:** `[DONE]` (see `src/lib/hypridle.ts`)
- **Effort:** Medium
- **Why:** Users expect Quick Settings toggles for screen auto-lock and idle timeout. Currently Shade only has a manual "Lock" button. `hypridle` is the standard Hyprland idle manager but Shade has no UI for it.
- **Files:**
  - `src/lib/hypridle.ts` (new)
  - `src/widget/quicksettings/button-grid/` (new toggle)
  - `src/widget/settings/general.tsx`
  - `src/lib/gschema.ts`
  - `nix/module.nix`
- **Approach:**
  1. Add `pkgs.hypridle` to Nix wrapper packages
  2. Create `Hypridle` singleton that manages `~/.config/hypr/hypridle.conf`:
     - Generate config dynamically from GSettings
     - Start/stop `hypridle` subprocess via `AstalIO.Process.subprocessv`
  3. Add GSettings keys to `general` schema:
     - `auto-lock-enabled` (bool, default true)
     - `idle-timeout` (int, default 300, range 60–1800 seconds)
     - `screen-dim-enabled` (bool, default true)
     - `screen-dim-timeout` (int, default 240, must be < idle-timeout)
  4. Add toggle to QS button grid: lock icon with "Auto Lock" label
  5. Dropdown shows: idle timeout slider (1–30 min), dim toggle, dim timeout slider
  6. Settings → General: full Idle Management section with all options
  7. Generated `hypridle.conf` example:
     ```
     general {
       lock_cmd = shade-shell lockscreen
       before_sleep_cmd = shade-shell lockscreen
     }
     listener {
       timeout = 240
       on-timeout = brightnessctl -s set 10%
       on-resume = brightnessctl -r
     }
     listener {
       timeout = 300
       on-timeout = shade-shell lockscreen
     }
     ```
- **Edge Cases:**
  - If user already has a custom `hypridle.conf`, backup and warn, or merge settings
  - If `hypridle` is not installed, show toggle disabled
  - Idle inhibitor (Caffeinated) must override auto-lock — when `inhibit.idle` is true, disable hypridle listeners temporarily
- **Acceptance:**
  - [ ] Toggle in QS enables/disables auto-lock immediately
  - [ ] Timeout slider changes idle delay (1–30 min)
  - [ ] Screen dims to 10% brightness N seconds before lock (N configurable)
  - [ ] Changes apply without Hyprland restart (restart hypridle subprocess)
  - [ ] Caffeinated mode overrides auto-lock (no lock while inhibit is active)
  - [ ] State persists across shell restarts via GSettings
  - [ ] Settings → General has dedicated Idle Management section

---

### 1.6 — Audio Output/Input Device Selector

- **Status:** `[DONE]` (see `src/widget/common/audioControl.tsx`)
- **Effort:** Low
- **Why:** A basic expandable endpoint list exists in `audioControl.tsx`, but it is buried behind an expander button, lacks device-type icons, and does not prominently show the active device. matshell, HyprPanel, and faiyt-ags expose this as a clean dropdown directly on the volume slider.
- **Files:**
  - `src/widget/common/audioControl.tsx`
  - `src/widget/quicksettings/sliders.tsx`
- **Current State:**
  - `audioControl.tsx` lists all endpoints with radio buttons + per-endpoint volume sliders
  - Speaker and mic sliders in QS use this component
  - No indication of which device is currently active on the collapsed slider row
- **Missing / To Improve:**
  1. **Prominent active device label** — Show the current default output name as subtitle under the speaker slider (e.g., "Headphones — Bose QC45"). Same for mic.
  2. **Device-type icons** — Map endpoint names/icons: `audio-headphones-symbolic`, `audio-speakers-symbolic`, `audio-headset-symbolic`, `audio-card-symbolic`, `bluetooth-symbolic`.
  3. **Quick-switch popover** — Add a `Gtk.MenuButton` with popover to the speaker/mic slider rows for one-click switching without expanding the full endpoint list.
  4. **Bluetooth audio handling** — Ensure Bluetooth headsets appear correctly and can be selected.
  5. **Auto-hide when single device** — If only one output/input exists, hide the switcher to reduce clutter.
- **Astal API Research Needed:**
  - Check `AstalWp` endpoint properties for `icon-name`, `form-factor`, or `device.bus` to infer icon type
- **Acceptance:**
  - [ ] Active output device name shown as subtitle under speaker slider
  - [ ] Active input device name shown as subtitle under mic slider
  - [ ] Clicking a small icon on the slider opens a popover with all devices
  - [ ] Each device row shows a relevant icon (headphones, speakers, mic, headset)
  - [ ] Clicking a device in the popover immediately switches default
  - [ ] Popover auto-updates when devices are plugged/unplugged
  - [ ] Popover hidden when only one device is available

---

### 1.7 — Notification History & Enhanced Popups

- **Status:** `[DONE]` (see `src/lib/notificationHistory.ts`)
- **Effort:** Medium
- **Why:** Current notifications auto-dismiss after 5s and are lost forever. The popup already pauses on hover, but there is no persistent log, no dismiss countdown, and no per-app control. colorshell, faiyt-ags, and HyprPanel all keep history.
- **Files:**
  - `src/widget/notifications/`
  - `src/widget/quicksettings/notificationList.tsx`
  - `src/widget/settings/general.tsx`
  - `src/lib/gschema.ts`
- **Current State:**
  - Popups have hover-pause ✅
  - Auto-dismiss after 5s ✅
  - DND toggle ✅
  - Grouped notification list in QS ✅
  - No persistent history ❌
  - No progress indicator ❌
  - No per-app ignore list ❌
- **Approach:**
  1. **Persistent History:**
     - Create `NotificationHistory` singleton storing last 100 notifications
     - Serialize to `$XDG_CACHE_HOME/shade/notifications.json` on change
     - Load on startup
  2. **Enhanced Popups:**
     - Add thin horizontal `Gtk.ProgressBar` at bottom of popup showing remaining time
     - Progress bar color: `accent` → `warning` as time runs out
  3. **History UI in QS:**
     - Add "History" tab or section to QS notification list
     - Show last 20 notifications with timestamp (e.g., "12:34 — Discord: Message from @user")
     - Click to re-open/copy content
     - `Ctrl+Delete` to remove individual entries
  4. **Per-app Settings:**
     - Settings → General: "Notifications" section
     - List of apps that have sent notifications
     - Per-app toggle: "Show popups" / "Show in history" / "Ignore entirely"
     - Global "Ignore list" text entry for app names (comma-separated)
  5. Add GSettings keys:
     - `notification-history-limit` (int, default 100)
     - `notification-show-progress` (bool, default true)
     - `notification-ignored-apps` (string array, default [])
- **Acceptance:**
  - [ ] Popup shows thin progress bar counting down 5s
  - [ ] Progress bar changes color as deadline approaches
  - [ ] History section in QS shows last 20 notifications with timestamps
  - [ ] History persists across shell restarts
  - [ ] "Clear History" button removes all stored notifications
  - [ ] Settings → General has per-app notification controls
  - [ ] Ignored apps never show popups or history entries
  - [ ] History JSON stored in `$XDG_CACHE_HOME/shade/notifications.json`

---

### 1.8 — Fingerprint Authentication Review

- **Status:** `[WIP]`
- **Effort:** Medium
- **Why:** Already implemented in the lock screen but has weak error handling, no type safety on D-Bus signals, and no guard against calling `start()` before `init()` completes. Security-sensitive code needs hardening.
- **Files:**
  - `src/lib/fingerprint.ts`
  - `src/widget/lockscreen/index.tsx`
- **Current State:**
  - `FingerprintAuth` singleton talks to `fprintd` over D-Bus
  - `init()` probes for devices asynchronously
  - `start()` / `stop()` control verification
  - `g-signal` handler manually parses `VerifyStatus` from D-Bus params
  - Lock screen shows spinner, status messages, and auto-restarts on `verify-no-match`
- **Production Gaps:**
  1. **Type safety** — D-Bus signal params are parsed as `GLib.Variant` with manual indexing. Add helper functions with runtime type checks to prevent crashes if fprintd changes its API.
  2. **Init-before-start guard** — Add internal state machine (`UNINITIALIZED` → `INITIALIZING` → `READY` → `VERIFYING`). Reject `start()` calls with clear error if state is not `READY`.
  3. **Multiple devices** — Currently only uses first device from `GetDevices`. Support enumerating all devices and trying each if the first fails.
  4. **Timeout handling** — If verification hangs (>30s), auto-cancel and show "Fingerprint timeout — try again" message.
  5. **Error messages** — Map fprintd error codes to human-readable strings: `verify-no-match` → "Fingerprint did not match", `verify-retry-scan` → "Please try again", `verify-swipe-too-short` → "Swipe was too short".
  6. **Settings integration** — Add toggle in Settings → General: "Enable Fingerprint" (default: auto-detect). If no fingerprint reader is detected, hide the option.
  7. **PAM fallback clarity** — Ensure lock screen always shows password entry even when fingerprint is enabled. Fingerprint should be a convenience, not a requirement.
- **Security Considerations:**
  - Never store fingerprint data locally — all biometrics stay in fprintd
  - Ensure `stop()` is called on lock screen unlock to prevent background verification
- **Acceptance:**
  - [ ] D-Bus signal parsing has runtime type checks (no crash on unexpected params)
  - [ ] `start()` rejected with clear error if `init()` has not completed
  - [ ] Verification timeout after 30s with user-visible message
  - [ ] All fprintd error codes mapped to human-readable strings
  - [ ] Multiple fingerprint devices enumerated and tried
  - [ ] Password entry always visible alongside fingerprint
  - [ ] "Enable Fingerprint" toggle in Settings → General
  - [ ] `stop()` called reliably on unlock to prevent background verification

---

### 1.9 — Touchpad Toggle Review

- **Status:** `[WIP]`
- **Effort:** Low
- **Why:** Already implemented but embeds a full Python script as a template literal, writes to a hardcoded `/tmp` path, and has no hot-plug support. These are production-blocking issues.
- **Files:**
  - `src/lib/touchpad.ts`
  - `src/widget/quicksettings/button-grid/touchpad.tsx`
  - `data/scripts/toggle-touchpad.py`
  - `meson.build`
- **Current State:**
  - `TOGGLE_SCRIPT` is a 40+ line Python string embedded in `touchpad.ts`
  - Script writes to `/tmp/shade-touchpad-disabled.pid` and forks an evdev grab daemon
  - At runtime, if `${bindir}/toggle-touchpad.py` doesn't exist, writes to `/tmp/shade-touchpad-toggle.py`
  - Touchpad detection scans `/sys/class/input/event*/device/name` for "touchpad"
  - Polls state every 2s via `GLib.timeout_add`
- **Production Gaps:**
  1. **Extract Python script to file** — Move `TOGGLE_SCRIPT` to `data/scripts/toggle-touchpad.py`. Install via Meson to `${pkgdatadir}/scripts/`. Reference at runtime instead of embedding.
  2. **Remove `/tmp` dependency** — Use `$XDG_RUNTIME_DIR/shade/` (e.g., `/run/user/1000/shade/`) for PID file and fallback script. `/tmp` is world-writable and a security risk.
  3. **Hot-plug support** — Currently only detects touchpad at module load. Add `Gio.FileMonitor` on `/sys/class/input/` to detect new touchpads and auto-enable.
  4. **Multiple touchpads** — Some laptops have external + internal touchpads. Enumerate all and disable/enable all matching devices.
  5. **Settings integration** — Add toggle in Settings → General: "Show Touchpad Toggle" (default: auto-detect). Hide if no touchpad found.
  6. **Hyprland integration** — Consider using `hyprctl keyword input:[device]:enabled true/false` as an alternative to evdev grab (cleaner, no Python needed). Evaluate which method is more reliable.
- **Acceptance:**
  - [ ] Python script lives in `data/scripts/toggle-touchpad.py`, installed by Meson
  - [ ] No hardcoded `/tmp` paths — uses `$XDG_RUNTIME_DIR/shade/`
  - [ ] Hot-plug: new touchpad detected within 5s of connection
  - [ ] Multiple touchpads all disabled/enabled together
  - [ ] QS toggle hidden when no touchpad is detected
  - [ ] Toggleable in Settings → General
  - [ ] Evaluated `hyprctl` alternative documented in code comments

---

### 1.10 — Geolocation Service Review

- **Status:** `[WIP]`
- **Effort:** Low
- **Why:** Already implemented but has no retry mechanism, poor error logging, and doesn't clean up D-Bus proxies. Weather auto-location depends on this, so reliability matters.
- **Files:**
  - `src/lib/geolocation.ts`
  - `src/lib/weather.ts`
  - `src/widget/settings/weather.tsx`
- **Current State:**
  - `Geolocation` singleton tries GeoClue2 D-Bus first, falls back to `ipapi.co` IP geolocation
  - `detect()` is fire-and-forget; no retry if both fail
  - GeoClue client started with `RequestedAccuracyLevel = 4` (street-level)
  - After getting location, calls `Stop` on GeoClue client but does not clean up proxy
  - IP fallback has no error logging on JSON parse failure
  - Weather service connects to `Geolocation.locationChanged` but may create multiple connections if auto-location is toggled repeatedly
- **Production Gaps:**
  1. **Retry mechanism** — If GeoClue fails, retry after 30s (max 3 attempts). If IP fallback fails, retry after 60s.
  2. **Error logging** — All failures logged via `print()` with clear context: "GeoClue failed: [reason]", "IP fallback failed: [reason]".
  3. **Proxy cleanup** — Dispose of GeoClue D-Bus proxy after `Stop` to prevent memory leaks.
  4. **Connection deduplication** — In `weather.ts`, disconnect old handler before connecting new one when auto-location is toggled.
  5. **Offline cache** — Cache last known location to `$XDG_CACHE_HOME/shade/location.json` with timestamp. If geolocation fails and cache is <24h old, use cached location.
  6. **Privacy indicator** — When geolocation is active, show a small location-dot icon in the bar (next to weather) with tooltip "Using location services". Respects GNOME location privacy settings if possible.
  7. **Manual override** — If user manually sets lat/lon in Settings → Weather, disable auto-location and don't poll geolocation.
- **Acceptance:**
  - [ ] GeoClue retries up to 3 times with 30s delay
  - [ ] IP fallback retries with 60s delay
  - [ ] All failures logged with clear error messages
  - [ ] GeoClue proxy disposed after use
  - [ ] Weather service does not create duplicate location change handlers
  - [ ] Last known location cached for 24h offline fallback
  - [ ] Location privacy indicator in bar when active
  - [ ] Manual lat/lon entry disables auto-location polling

---

## Phase 2 — Window Management UX (Medium Term)

> These are the biggest gaps vs. GNOME/KDE. They change how users interact with windows.

---

### 2.1 — Window Switcher (Alt-Tab Replacement)

- **Status:** `[DONE]` (see `src/widget/windowswitcher/index.tsx`)
- **Effort:** High
- **Why:** The single biggest UX gap vs. GNOME/KDE. Tiling WMs without a visual Alt-Tab switcher feel incomplete. `hyprshell` exists solely because of this need. Currently users must rely on workspace indicators or Hyprland's built-in (invisible) switcher.
- **Files:**
  - New: `src/widget/windowswitcher/`
  - `nix/hyprland/binds.nix`
- **Approach — MVP (text + icons, Phase 2):**
  1. Create `WindowSwitcher` component as `Astal.Window` with `layer=OVERLAY`, `keymode=EXCLUSIVE`
  2. Bind to `Super+Tab` in Hyprland config (or make configurable)
  3. Query `AstalHyprland.get_default().clients` on open
  4. Render as horizontal row or vertical list of cards:
     - App icon (48px, from `AstalApps` lookup on `client.class`)
     - Window title (truncated to 30 chars)
     - Workspace number badge (small pill)
     - Monitor indicator (dot color per monitor)
  5. Highlight selected item with `accent` background
  6. Keyboard navigation:
     - `Tab` / `→` — next window
     - `Shift+Tab` / `←` — previous window
     - `Enter` or release `Super` — focus selected
     - `Escape` — cancel without switching
     - `Q` — close selected window
  7. Sort by most-recently-focused (MRU) using `AstalHyprland.active.client` history
- **Approach — Advanced (thumbnails, defer to Phase 3+):**
  1. Use `grim` on window geometry to capture thumbnails
  2. Cache in `$XDG_CACHE_HOME/shade/thumbnails/`
  3. Show as a grid of window previews
- **Hyprland Integration:**
  - `AstalHyprland.get_default().clients` for window list
  - `client.focus()` to focus (or `hyprctl dispatch focuswindow address:${client.address}`)
  - `client.workspace.id` for workspace grouping
- **Acceptance:**
  - [ ] Opens on `Super+Tab` (bound in Hyprland config)
  - [ ] Shows all open windows sorted by MRU
  - [ ] Each item shows app icon + title + workspace number
  - [ ] `Tab` cycles forward, `Shift+Tab` cycles backward
  - [ ] Releasing `Super` focuses selected window
  - [ ] `Escape` cancels without switching
  - [ ] Centered on active monitor, fixed max-width
  - [ ] `Q` closes selected window without leaving switcher
  - [ ] Updates immediately when windows open/close/focus changes

---

### 2.2 — Dock / Taskbar for Running Apps

- **Status:** `[DONE]` (see `src/widget/dock/index.tsx`)
- **Effort:** Medium
- **Why:** The bar workspaces show clients per workspace, but there is no persistent taskbar showing running apps across all workspaces. GNOME's `dash-to-dock` is the most popular extension ever for a reason. A dock provides familiar window management.
- **Files:**
  - New: `src/widget/dock/`
  - `src/lib/gschema.ts`
  - `src/widget/settings/bar.tsx`
- **Approach:**
  1. Create `Dock` widget as `Astal.Window` with `layer=TOP`, anchored to bottom
  2. `Gtk.Box` with `Gtk.Button` children (icon-only, 48px)
  3. **Pinned apps:**
     - GSettings `dock-pinned-apps` (string array of desktop file IDs, e.g., `["firefox.desktop", "org.gnome.Nautilus.desktop"]`)
     - Settings → Bar: "Dock" section with app picker (use `AstalApps` to list installed apps)
  4. **Running apps:**
     - Merge `AstalHyprland.clients` with pinned list
     - Deduplicate by `client.class` → app identity
     - Running apps get a small indicator dot (4px, `accent` color) below the icon
     - Active (focused) app gets a larger underline or pill indicator
  5. **Interactions:**
     - Left-click running → `client.focus()`
     - Left-click pinned not running → `GLib.spawn_command_line_async("uwsm-app -t service -- desktopfile")`
     - Right-click → `Gtk.PopoverMenu` with: Focus, Close, Pin/Unpin, Move to Workspace N
     - Scroll → cycle focus between windows of same app class
  6. Add GSettings:
     - `dock-enabled` (bool, default false)
     - `dock-auto-hide` (bool, default false)
     - `dock-icon-size` (int, default 48, range 24–64)
- **Acceptance:**
  - [ ] Dock appears at bottom of screen when enabled in Settings
  - [ ] Shows pinned apps in configured order
  - [ ] Running apps show a small indicator dot
  - [ ] Active (focused) app highlighted distinctly
  - [ ] Left-click focuses running app or launches pinned app
  - [ ] Right-click shows context menu with window actions
  - [ ] Scroll cycles windows of same app class
  - [ ] Pinned apps configurable in Settings → Bar
  - [ ] Toggleable on/off in Settings

---

### 2.3 — Workspace Overview / Exposé

- **Status:** `[TODO]`
- **Effort:** High
- **Why:** GNOME Activities overview and macOS Mission Control set the standard. For tiling WMs, this is harder but `Hyprspace` plugin proves it's desired. Currently Shade has no way to see all workspaces and windows at once.
- **Files:**
  - New: `src/widget/overview/`
  - `nix/hyprland/binds.nix`
- **Approach — MVP (icon grid, recommended for Phase 2):**
  1. Full-screen `Astal.Window` with `layer=OVERLAY`, `keymode=EXCLUSIVE`
  2. Triggered by `Super+A` (add to Hyprland binds)
  3. Grid layout: 2 rows × N columns of workspace cards
  4. Each workspace card:
     - Workspace number / name as header
     - Grid of app icons (32px) representing open windows
     - Active workspace highlighted with `accent` border
  5. Click workspace card → switch to that workspace
  6. Click app icon inside card → focus that window
  7. Search entry at top filters workspaces/windows by name
  8. `Escape` or `Super+A` again to close
- **Approach — Advanced (thumbnails, defer to Phase 3+):**
  1. Use `grim` to capture each window's geometry as thumbnail
  2. Cache thumbnails to `$XDG_CACHE_HOME/shade/thumbnails/`
  3. Show workspace cards with live window thumbnails
  4. Drag-and-drop to move windows between workspaces
- **Alternative (low effort):**
  - Document how to install `Hyprspace` plugin alongside Shade
  - Add `bind = SUPER, TAB, overview:toggle` or similar Hyprland integration
- **Acceptance:**
  - [ ] `Super+A` opens full-screen workspace overview
  - [ ] All workspaces visible in a grid
  - [ ] Each workspace shows its open windows as app icons
  - [ ] Active workspace visually highlighted
  - [ ] Click workspace → switch to it
  - [ ] Click window icon → focus that window
  - [ ] Search filters workspaces and windows by name
  - [ ] `Escape` closes overview
  - [ ] Does not conflict with existing `SUPER+Space` launcher bind

---

### 2.4 — Bar Module Toggle UI

- **Status:** `[DONE]` (see `src/lib/gschema.ts (bar module toggle keys)`)
- **Effort:** Medium
- **Why:** HyprPanel and faiyt-ags let users enable/disable individual bar modules from a settings UI. Shade's bar layout is currently hardcoded in `bar/index.tsx` — every module is always visible. Users on small screens or minimal setups want to hide e.g., weather, system resources, or world clock.
- **Files:**
  - `src/widget/settings/bar.tsx`
  - `src/lib/gschema.ts`
  - `src/widget/bar/index.tsx`
- **Approach:**
  1. Add GSettings boolean keys to `bar` schema for each module:
     | Key | Default | Module |
     |-----|---------|--------|
     | `show-launcher-toggle` | true | Nix flake launcher button |
     | `show-workspaces` | true | Workspace indicators |
     | `show-window-title` | true | Active window title (0.5) |
     | `show-system-resources` | true | CPU/RAM/temp monitors |
     | `show-media` | true | Media player mini-widget |
     | `show-clock` | true | Clock + calendar popover |
     | `show-weather` | true | Weather button + popover |
     | `show-system-tray` | true | System indicators cluster (BT, net, battery, audio) |
  2. In `bar/index.tsx`, wrap each `CenterBox` child in a `With` or conditional based on settings
  3. Settings → Bar: add "Modules" section with a list of `Adw.SwitchRow` items
  4. Changes apply immediately via Gnim reactivity (no restart)
  5. If all modules in a `CenterBox` section are hidden, the section collapses gracefully
- **Acceptance:**
  - [ ] Settings → Bar has "Modules" section with toggle for each bar component
  - [ ] Toggling off a module immediately hides it in the bar
  - [ ] Toggling on immediately shows it
  - [ ] All 8+ modules are individually toggleable
  - [ ] Changes persist across restarts
  - [ ] Bar does not crash or look broken when all center modules are hidden
  - [ ] New modules added to bar automatically appear in the toggle list

---

## Phase 3 — Polish & Differentiation (Long Term)

> Features that make Shade stand out from other AGS shells.

---

### 3.1 — Dynamic Wallpaper-Driven Theming (Material You)

- **Status:** `[DONE]` (see `src/lib/theming.ts`)
- **Effort:** Medium
- **Why:** `matugen`, `pywal`, and Material You color extraction are extremely popular in the r/unixporn and Hyprland communities. matshell, colorshell, and Ateon all have this. The entire shell adapting to the wallpaper is a major visual differentiator.
- **Files:**
  - `src/lib/theming.ts` (new)
  - `src/App.tsx` (CSS injection)
  - `src/widget/settings/general.tsx`
  - `nix/desktop-shell.nix`
- **Backend Decision: Use `matugen`**
  - Rust-based, fast, generates Material You compliant palettes
  - Nixpkgs has `matugen` package
  - Outputs JSON or template-based colors
- **Approach:**
  1. Add `matugen` to Nix wrapper packages
  2. Create `Theming` singleton:
     - On wallpaper change (listen to GSettings `wallpaper-day` / `wallpaper-night` changes), run:
       `matugen image <wallpaper-path> --json`
     - Parse JSON output for `colors.primary`, `colors.secondary`, `colors.tertiary`, `colors.error`
  3. Generate CSS string with GTK4 custom properties:
     ```css
     @define-color accent_color #3584e4;
     @define-color accent_bg_color #3584e4;
     @define-color destructive_color #c01c28;
     @define-color success_color #26a269;
     @define-color warning_color #ae7b03;
     ```
  4. Inject via `Gtk.CssProvider` at `STYLE_PROVIDER_PRIORITY_USER + 1` (overrides Libadwaita defaults)
  5. Settings → General:
     - Toggle: "Dynamic Theming" (default: off until stable)
     - Button: "Regenerate from current wallpaper"
     - Preview swatches showing extracted colors
  6. Optional: write accent color to Hyprland active border via `hyprctl keyword general:col.active_border "rgba(XXXXXXff)"`
- **Edge Cases:**
  - `matugen` not installed → disable toggle, show "Install matugen to enable"
  - Very dark wallpapers → ensure text contrast is readable
  - User sets custom theme colors via Theme Editor (3.8) → dynamic theming should not override manual colors unless explicitly regenerated
- **Acceptance:**
  - [ ] Changing wallpaper triggers color extraction within 2s
  - [ ] Bar, QS, settings, and lock screen all use extracted accent color
  - [ ] Colors are readable on both light and dark themes (contrast ratio > 4.5:1)
  - [ ] Can be disabled in Settings → General
  - [ ] Manual "Regenerate" button available
  - [ ] Preview swatches show extracted palette before applying
  - [ ] Optional: Hyprland border color syncs with shell accent

---

### 3.3 — Color Picker Integration

- **Status:** `[TODO]`
- **Effort:** Low
- **Why:** `hyprpicker` is standard in Hyprland setups. Designers and developers frequently need to sample colors from the screen. faiyt-ags includes this as a bar utility button.
- **Files:**
  - `src/lib/colorPicker.ts` (new)
  - `src/widget/quicksettings/button-grid/` or `src/widget/bar/`
  - `nix/desktop-shell.nix`
- **Approach:**
  1. Add `hyprpicker` to Nix wrapper packages
  2. Create `ColorPicker` utility:
     - Runs `hyprpicker -n` (no fork, outputs hex to stdout)
     - Captures output via `AstalIO.Process.exec_async`
  3. Add button:
     - QS button-grid: small utility button with `color-select-symbolic`
     - Or bar utility area (if bar module toggles exist)
  4. After picking:
     - Copy hex to clipboard via `wl-copy`
     - Show OSD toast with:
       - Color swatch (32px square filled with picked color)
       - Hex value (e.g., `#3584e4`)
       - RGB value (e.g., `rgb(53, 132, 228)`)
     - Toast auto-dismisses after 3s
  5. Add Hyprland keybind: `SUPER+SHIFT+C` → `shade-shell colorpicker`
  6. Add CLI command: `shade-shell colorpicker`
- **Acceptance:**
  - [ ] Clicking button changes cursor to crosshair (hyprpicker)
  - [ ] Clicking anywhere copies hex color to clipboard
  - [ ] OSD toast shows color swatch + hex + RGB values
  - [ ] Toast auto-dismisses after 3s
  - [ ] `SUPER+SHIFT+C` triggers color picker
  - [ ] Works on both light and dark screen regions

---

### 3.4 — Calendar Events Integration

- **Status:** `[TODO]`
- **Effort:** Medium–High
- **Why:** Basic calendar widgets show dates. Showing actual events (from GNOME Online Accounts, Nextcloud, local `.ics`) is what makes a calendar useful. Currently Shade's calendar is just a `Gtk.Calendar` widget with no event data.
- **Files:**
  - `src/lib/calendar.ts` (new)
  - `src/widget/quicksettings/expander/calendar.tsx`
  - `src/widget/settings/general.tsx`
- **Approach:**
  1. **Backend options (prioritized):**
     - **EDS (Evolution Data Server):** Use `libecal` via GObject introspection. Access system calendar sources. Most robust but complex.
     - **Local ICS:** Read `~/.local/share/gnome-shell/calendar.ics` or user-configured path. Simple but manual.
     - **vdirsyncer:** Read from `~/.calendars/` directory. Good for CalDAV users.
  2. Create `CalendarEvents` singleton:
     - Query events for current month on calendar open
     - Cache results for 5 minutes
  3. UI changes to `expander/calendar.tsx`:
     - Add small colored dots (4px circles) on calendar days that have events
     - Dot colors map to calendar source (work = blue, personal = green, etc.)
     - Below `Gtk.Calendar`, add `Gtk.ListBox` showing today's events:
       - Event time (e.g., "14:00 – 15:00")
       - Event title
       - Calendar source name (small caption)
     - Clicking a day with events updates the list to that day's events
  4. Settings → General: "Calendar" section
     - Calendar source selection (checkbox list of detected sources)
     - "Add ICS file" button with file picker
- **Acceptance:**
  - [ ] Calendar shows colored dots on days with events
  - [ ] Today's events listed below calendar
  - [ ] Clicking a day with events shows that day's event list
  - [ ] Works with at least one backend (EDS or local ICS)
  - [ ] Settings allows selecting which calendar sources to display
  - [ ] Events cache for 5 minutes to avoid repeated queries

---

### 3.5 — Launcher Enhancements (Calculator, Emoji, Web Search, Window Switch)

- **Status:** `[TODO]`
- **Effort:** Low (each)
- **Why:** Power-user features that make the launcher a true "universal search" tool. faiyt-ags and colorshell set the bar here with prefix-based search modes. Shade's launcher is currently app-search only.
- **Files:**
  - `src/widget/applauncher/index.tsx`
  - `src/widget/applauncher/evaluators/` (new directory)
  - `data/emoji.json` or `src/lib/emojiData.ts` (new)
- **Approach:**
  1. **Prefix-based mode switching:**
     - No prefix → app search (existing behavior)
     - `=` or starts with digit/operator → calculator
     - `:` → emoji search
     - `?` or `!` → web search
     - `>` → clipboard history (1.1)
     - `w ` or matches window title → window switch
  2. **Calculator:**
     - Detect: input starts with `=` or matches `/^[\d\s+\-*/().^%]+$/`
     - Evaluate with safe JS math (no `eval` — use a parser or `Function` with limited scope)
     - Show result as first selectable item: `= 2+2*3` → `8`
     - Support: `+`, `-`, `*`, `/`, `^`, `%`, `sin`, `cos`, `sqrt`, `pi`
  3. **Emoji:**
     - Create `emojiData.ts` with 1500+ emoji entries: `{ emoji: "👍", keywords: ["thumbs up", "+1", "like"] }`
     - Trigger: prefix `:` or search contains only letters + spaces
     - Show grid of 6 emoji per row with name below
     - Click copies to clipboard and closes launcher
     - Arrow keys navigate grid
  4. **Web Search:**
     - Trigger: prefix `?` or `!`
     - Show result: "Search DuckDuckGo for 'query'"
     - Enter opens default browser: `xdg-open "https://duckduckgo.com/?q=query"`
  5. **Window Switch:**
     - Trigger: prefix `w ` or input matches an open window title/class
     - Show: app icon + window title + "Switch to Window" label
     - Enter focuses the window
  6. UI changes:
     - Show small prefix badges (e.g., "= Calculator", "🎭 Emoji") above results when a prefix is detected
     - Result count limit: 10 per mode
- **Acceptance:**
  - [ ] `= 2+2*3` shows result `8` as selectable item
  - [ ] `= sqrt(16) + pi` shows `~7.14`
  - [ ] `:thumbs` shows 👍 and related thumbs emojis
  - [ ] `? how to center a div` shows "Search DuckDuckGo" result
  - [ ] `w fire` shows "Switch to Firefox" if Firefox is open
  - [ ] Prefix badge appears above results indicating active mode
  - [ ] Each mode limits to 10 results
  - [ ] Enter on any result executes the action and closes launcher

---

### 3.6 — Auto-Hide / Floating Bar Modes

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** Modern shells support floating bars with rounded corners/gaps, and auto-hide when a window overlaps or maximizes. Currently Shade's bar is always `EXCLUSIVE` (reserves screen space) with no margin or rounding options.
- **Files:**
  - `src/widget/bar/index.tsx`
  - `src/lib/gschema.ts`
  - `src/widget/settings/bar.tsx`
  - `src/shade.css`
- **Approach:**
  1. Add GSettings keys to `bar` schema:
     - `bar-mode` (string): `"normal"`, `"floating"`, `"auto-hide"`
     - `bar-margin` (int): pixels of gap from screen edges (default 8, range 0–24)
     - `bar-border-radius` (int): corner radius in px (default 12, range 0–24)
  2. **Normal mode** (default): current behavior — `EXCLUSIVE`, no margin, no rounding
  3. **Floating mode:**
     - Set `Astal.Window` margins to `bar-margin`
     - Apply `border-radius: ${radius}px` via CSS to bar window
     - Keep `EXCLUSIVE` but with reduced effective area
     - Background should be semi-transparent or blurred
  4. **Auto-hide mode:**
     - Set `Astal.Layer.TOP` instead of `EXCLUSIVE`
     - Listen to `AstalHyprland` events for maximized/fullscreen clients on each monitor
     - When a maximized window appears on a monitor, animate that monitor's bar out (slide up/down/left/right based on position)
     - When maximized window closes or minimizes, animate bar back in
     - Reveal on edge hover: add `Gtk.EventControllerMotion` to a 2px invisible trigger area at screen edge
  5. Settings → Bar: add "Bar Mode" section with dropdown + margin/radius sliders
- **Edge Cases:**
  - Vertical bar (left/right) → auto-hide slides left/right, not up/down
  - Multi-monitor → each monitor's bar hides independently based on its own maximized windows
  - Fullscreen video → bar should hide immediately
  - `bar-margin` in normal mode should have no effect (only floating)
- **Acceptance:**
  - [ ] Floating mode shows bar with gaps and rounded corners
  - [ ] Auto-hide hides bar when maximized window is present on that monitor
  - [ ] Auto-hide reveals bar when moving mouse to screen edge
  - [ ] Animation is smooth (200ms CSS transition)
  - [ ] Settings → Bar has mode dropdown + margin/radius sliders
  - [ ] Changes apply immediately without restart
  - [ ] Vertical bar auto-hide works correctly (slides horizontally)

---

### 3.7 — Searchable Settings

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** As settings grow, finding the right option becomes difficult. GNOME Settings, macOS System Preferences, and faiyt-ags all have search. This is essential for a settings-heavy app.
- **Files:**
  - `src/widget/settings/index.tsx`
  - `src/widget/settings/search.tsx` (new)
- **Approach:**
  1. Add `Gtk.SearchEntry` in `Adw.HeaderBar` of Settings window
  2. Build a static search index at compile time or on first open:
     ```ts
     const searchIndex = [
       { id: "bar-position", label: "Bar Position", keywords: ["bar", "position", "top", "bottom", "left", "right"], page: "bar", widget: "positionToggle" },
       { id: "night-light", label: "Night Light", keywords: ["night", "blue", "light", "temperature", "eye"], page: "general", widget: "nightLightSection" },
       // ... all settings
     ]
     ```
  3. On search input, fuzzy-match against `label` and `keywords`
  4. Show results in a dropdown `Gtk.Popover` or replace the page content:
     - Each result: icon + label + breadcrumb ("Bar → Position")
     - Click navigates to the correct `Adw.PreferencesPage` and calls `scroll-to` on the target widget
  5. Highlight matched text in results (bold)
  6. `Escape` clears search and returns to previous page
  7. Empty state: "No results for 'query'" + "Try different keywords"
- **Maintenance:**
  - Each new settings page must register its searchable items in the index
  - Consider a helper function `registerSearchItem()` to enforce this
- **Acceptance:**
  - [ ] Search entry visible in Settings header bar
  - [ ] Typing filters results in real-time (<100ms)
  - [ ] Results show icon + label + breadcrumb path
  - [ ] Clicking result navigates to correct page and scrolls to setting
  - [ ] Matched text is bolded in results
  - [ ] Works across all pages (General, Bar, Clock, Network, Weather)
  - [ ] `Escape` clears search and restores previous page
  - [ ] Empty state shown with helpful message when no results match

---

### 3.8 — Theme Editor with Live Preview

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** colorshell and faiyt-ags have live theme editing. Shade requires users to edit CSS or rely entirely on Libadwaita defaults. A simple color editor lets users personalize without touching code. This pairs well with Dynamic Theming (3.1) — users can override extracted colors.
- **Files:**
  - `src/widget/settings/general.tsx` (new "Appearance" section)
  - `src/lib/theming.ts`
  - `src/App.tsx` (CSS injection)
  - `src/lib/gschema.ts`
- **Approach:**
  1. Add GSettings keys to `general` schema:
     - `accent-color` (string, default "", empty = use Libadwaita default)
     - `destructive-color` (string, default "")
     - `success-color` (string, default "")
     - `warning-color` (string, default "")
     - `custom-theme-enabled` (bool, default false)
  2. Settings → General: "Appearance" section at top
     - `Adw.SwitchRow`: "Custom Colors" (master toggle)
     - When enabled, show rows with `Gtk.ColorDialogButton` for each color
     - Preview card below: shows `Gtk.Button` (suggested, destructive, success) and a sample card
  3. `Theming` singleton:
     - Watches GSettings color keys
     - On change, generates CSS with `@define-color` rules
     - Injects via `Gtk.CssProvider` at `STYLE_PROVIDER_PRIORITY_USER + 1`
     - If `custom-theme-enabled` is false, remove the provider (restore defaults)
  4. "Reset to Defaults" button clears all custom colors and disables toggle
  5. Dynamic Theming (3.1) integration:
     - When matugen generates colors, populate these GSettings keys
     - If user then manually edits a color, override only that specific color
- **Acceptance:**
  - [ ] "Custom Colors" toggle in Settings → General
  - [ ] Color pickers for accent, destructive, success, warning
  - [ ] Live preview card shows buttons/cards with selected colors
  - [ ] Changes apply to entire shell within 500ms
  - [ ] "Reset to Defaults" restores Libadwaita colors
  - [ ] Toggle off removes all custom colors
  - [ ] Dynamic theming (3.1) populates these fields when enabled
  - [ ] Manual color edits override dynamic theming for that specific color only

---

### 3.9 — Screenshot & Screen Recording UI

- **Status:** `[WIP]`
- **Effort:** Medium
- **Why:** A backend service (`screenshot.ts`) and QS button-grid already exist, but the UX is incomplete: no bar utility button, no OSD confirmation, saved paths are not standardized, and there is no annotation support.
- **Files:**
  - `src/lib/screenshot.ts`
  - `src/widget/quicksettings/button-grid/screenshot.tsx`
  - `src/widget/bar/systemIndicators.tsx`
  - `nix/hyprland/binds.nix`
- **Current State:**
  - `Screenshot` singleton handles `grim`/`slurp` screenshots and `wf-recorder` recording with controllable subprocess
  - QS button-grid has screenshot/recording button with dropdown modes + audio checkbox
  - Recording indicator appears in `systemIndicators.tsx`
  - CLI supports `screenshot`, `screenshot-area`, `record`, `record-area`, `record-window`, `record-output`
  - `grim`, `slurp`, `wf-recorder`, `wl-copy` are already in the Nix wrapper
- **Missing / To Improve:**
  1. **Bar utility button** — Add a screenshot button to the bar's utility section (or make it optional via module toggle). One-click full screenshot, right-click for modes.
  2. **OSD confirmation** — After screenshot, show a brief OSD toast with thumbnail + "Copied to clipboard / Saved to ~/Pictures/Screenshots".
  3. **Standardized save paths** — Default to `~/Pictures/Screenshots/` and `~/Videos/Screencasts/` with timestamped filenames (`shade_2026-04-29_07-35-57.png`). Make paths configurable in Settings.
  4. **Annotation support** — Add `swappy` integration for area screenshots: capture → `swappy -f <file>` → save.
  5. **Recording quality presets** — Add GSettings for recording bitrate/fps; expose "High Quality" and "Standard" in QS dropdown.
  6. **Hyprland keybinds** — Add `SUPER+SHIFT+S` (area screenshot), `SUPER+ALT+R` (toggle recording) to `binds.nix`.
  7. **Clipboard-only mode** — Add a GSettings toggle: screenshots copy to clipboard only (no file saved).
- **Acceptance:**
  - [ ] Optional screenshot button in bar (toggleable in Settings)
  - [ ] Area screenshot opens `slurp`, then shows OSD toast with preview
  - [ ] Screenshots saved to `~/Pictures/Screenshots/shade_YYYY-MM-DD_HH-MM-SS.png`
  - [ ] Recordings saved to `~/Videos/Screencasts/shade_YYYY-MM-DD_HH-MM-SS.mp4`
  - [ ] OSD toast confirms save path and action after screenshot
  - [ ] Optional annotation via `swappy` for area screenshots
  - [ ] Recording quality preset selectable in Settings
  - [ ] `SUPER+SHIFT+S` binds to area screenshot in Hyprland config
  - [ ] No duplicate recording processes on repeated clicks

---

### 3.10 — Internationalization (i18n)

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** colorshell supports 6 languages with community contributions. Shade is English-only. `main.ts` already calls `bindtextdomain` and `textdomain`, but no `.po` files exist and no strings are wrapped. Given the author's native language is Portuguese (BR), this is both personally relevant and a genuine accessibility improvement.
- **Files:**
  - `po/` directory (new)
  - All `src/widget/` and `src/lib/` files (wrap strings)
  - `meson.build`
  - `src/main.ts`
- **Approach:**
  1. **Meson setup:**
     - Add `i18n` module to `meson.build`
     - Add `i18n.gettext(import.meta.domain)` to build
  2. **String extraction:**
     - Wrap ALL user-facing strings in `_()` (alias for `gettext()`):
       - Widget labels, button text, tooltips, settings descriptions
       - Error messages shown to user (not debug `print()` statements)
     - Use `ngettext()` for plural forms (e.g., "1 notification" / "N notifications")
  3. **Create `po/messages.pot`:**
     - Run `xgettext` or `meson compile` to extract strings
  4. **Portuguese (BR) translation:**
     - Create `po/pt_BR.po` from template
     - Translate all ~200–400 strings
  5. **Auto-detection:**
     - `main.ts` already calls `GLib.get_language_names()` implicitly via gettext
     - Ensure `TEXTDOMAIN` and `LOCALEDIR` are correct at install time
  6. **Contribution process:**
     - Add `docs/TRANSLATING.md` with instructions
     - List available languages and completion percentage
  7. **Future languages:** Spanish, French, German, Japanese, Russian
- **Acceptance:**
  - [ ] All user-visible UI strings wrapped in `_()`
  - [ ] `po/messages.pot` extracts all translatable strings
  - [ ] `po/pt_BR.po` exists with complete Portuguese (BR) translation
  - [ ] Running Shade on `pt_BR` locale shows Portuguese text
  - [ ] Missing translations fall back to English gracefully
  - [ ] Build installs `.mo` files to correct locale directory
  - [ ] `docs/TRANSLATING.md` documents how to add new languages

---

### 3.11 — Monitor Configuration UI

- **Status:** `[TODO]`
- **Effort:** Medium–High
- **Why:** faiyt-ags has a visual monitor arrangement tool with drag-and-drop positioning, resolution selection, and scale configuration. Currently Shade users must manually edit `~/.config/hypr/hyprland.conf` to change monitor layouts.
- **Files:**
  - New: `src/widget/settings/monitors.tsx`
  - `src/lib/monitors.ts`
  - `src/widget/settings/index.tsx`
- **Approach:**
  1. Add "Monitors" page to Settings window (after "Network")
  2. Read current monitor state:
     - `Gdk.Display` for physical sizes and positions
     - `AstalHyprland.get_default().monitors` for resolution, scale, refresh rate, transform
  3. Visual canvas:
     - `Gtk.DrawingArea` or `Gtk.Fixed` container
     - Draw rectangles for each monitor at relative scale (e.g., 1920x1080 → 384x216px)
     - Label each with name + resolution
     - Active monitor highlighted with `accent` border
  4. Drag-and-drop:
     - `Gtk.GestureDrag` on each monitor rectangle
     - Move monitor representation on canvas
     - Edge snapping: when within 10px of another monitor's edge, snap to align
  5. Per-monitor settings panel (appears when monitor is selected):
     - Resolution dropdown: parse from `hyprctl monitors` or `wlr-randr` / `xrandr` fallback
     - Refresh rate dropdown
     - Scale: `1`, `1.25`, `1.5`, `2`
     - Transform: `0°`, `90°`, `180°`, `270°`, `flipped`, `flipped-90`, etc.
  6. Action buttons:
     - "Apply" → construct `hyprctl keyword monitor <name>,<res>@<rate>,<pos>,<scale>,transform,<transform>` for each monitor
     - "Reset" → re-read current Hyprland state and revert canvas
     - "Auto-align" → arrange monitors in a horizontal row with zero gaps
  7. Warn if proposed layout would place monitors outside virtual desktop bounds
- **Edge Cases:**
  - Hot-plug during configuration → refresh canvas, preserve unsaved changes for existing monitors
  - Changing scale may require Hyprland restart for some apps → warn user
  - Mirror/duplicate mode → add toggle, but defer if too complex
- **Acceptance:**
  - [ ] Visual canvas shows all monitors at relative scale
  - [ ] Monitors can be dragged to reposition
  - [ ] Edge snapping aligns monitors automatically
  - [ ] Per-monitor resolution, refresh rate, scale, and rotation configurable
  - [ ] "Apply" updates Hyprland configuration immediately
  - [ ] "Reset" reverts to current layout
  - [ ] "Auto-align" arranges monitors in a horizontal row
  - [ ] Warning shown if layout requires restart or is invalid

---

### 3.12 — Keyboard Hint Navigation

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** faiyt-ags implements Flash.nvim-style keyboard hints for mouse-less control. Press `Ctrl+Space`, letter badges appear on all clickable elements, type the letter to activate. This is excellent for accessibility, keyboard-centric users, and small touchscreens.
- **Files:**
  - New: `src/widget/common/hintNavigation.tsx`
  - `src/App.tsx` (global keybind)
- **Approach:**
  1. Global keybind: `Ctrl+Space` activates hint mode (bind via `Gtk.EventControllerKey` on app level)
  2. Scope detection:
     - Determine which `Astal.Window` is currently focused/top-level
     - Only register hints for widgets within that window
  3. Widget traversal:
     - Walk GTK widget tree recursively via `get_first_child()` / `get_next_sibling()`
     - Identify "actionable" widgets: `Gtk.Button`, `Gtk.ToggleButton`, `Gtk.Switch`, `Gtk.Slider`, `Gtk.Entry`, `Gtk.MenuButton`
     - Skip insensitive (`sensitive=false`) widgets
  4. Badge assignment:
     - Single letters (A–Z) for first 26 elements
     - Two-letter combos (AA–ZZ) for more elements
     - Assign in reading order (top-to-bottom, left-to-right)
  5. Badge rendering:
     - Create overlay `Gtk.Label` widgets with CSS class `hint-badge`
     - Position near target widget using `Gtk.Fixed` overlay or absolute positioning
     - Style: small pill, `accent` background, white text, `font-size: 10px`, `padding: 2px 6px`
  6. Input handling:
     - Buffer typed letters (for two-letter combos)
     - On match: simulate click/activate on target widget, then deactivate hint mode
     - On mismatch: flash red and continue
     - `Escape`: deactivate immediately
     - `Backspace`: clear letter buffer
  7. Auto-deactivate:
     - When target window loses focus
     - When any widget action is triggered
     - After 10 seconds of inactivity
- **Acceptance:**
  - [ ] `Ctrl+Space` activates hint mode in any Shade window
  - [ ] Letter badges appear on all actionable widgets in active window
  - [ ] Typing single letter (A–Z) activates that widget
  - [ ] Typing two letters (AA–ZZ) activates widgets beyond 26
  - [ ] Badges assigned in visual reading order (top→bottom, left→right)
  - [ ] `Escape` cancels without action
  - [ ] Works in Quick Settings, Settings, Bar, Launcher, Lock Screen
  - [ ] Does not interfere with normal typing when hint mode is off
  - [ ] Auto-deactivates after 10s inactivity or window focus loss

---

## Technical Debt & Refactors

> Internal improvements that don't add user-facing features but improve maintainability.

---

### TD.1 — Consolidate Astal Import Pattern

- **Status:** `[TODO]`
- **Why:** Some files use `gi://Astal?version=4.0`, others may use different patterns. Standardize.
- **Files:** All `src/` files

---

### TD.2 — Extract Common Dialog Pattern

- **Status:** `[TODO]`
- **Why:** Password dialog (network), power menu, and future dialogs all need the same pattern: overlay window, exclusive keymode, escape to close.
- **Files:** New `src/widget/common/dialogShell.tsx`

---

### TD.3 — Settings Schema Migration Strategy

- **Status:** `[TODO]`
- **Why:** Adding new GSettings keys requires schema migration. Document how to handle schema changes for existing users (e.g., `glib-compile-schemas` on startup, versioning).
- **Files:** `src/lib/gschema.ts`, docs

---

### TD.4 — Reduce `any` Usage

- **Status:** `[TODO]`
- **Why:** AGENTS.md notes that `no-explicit-any` is disabled. While pragmatic, key services would benefit from stricter typing.
- **Files:** `src/lib/` services

---

### TD.5 — Keyboard Shortcuts Configuration

- **Status:** `[TODO]`
- **Why:** Currently keybinds are hardcoded in `nix/hyprland/binds.nix`. A settings page for Shade-specific shortcuts (toggle QS, launcher, lock, screenshot, etc.) would be better.
- **Files:** New `src/widget/settings/shortcuts.tsx`, `src/lib/gschema.ts`

---

## Appendix: Feature Comparison Matrix (Quick Reference)

**Legend:**
- ✅ = Fully implemented
- ⚠️ = Partially implemented / needs polish
- ❌ = Not implemented

| Feature | Shade Now | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---------|-----------|---------|---------|---------|---------|
| **Core Shell** |
| Status Bar | ✅ | — | — | — | — |
| App Launcher | ✅ | — | — | — | — |
| Quick Settings | ✅ | — | — | — | — |
| Notifications | ✅ | — | — | — | — |
| OSD | ✅ | — | — | — | — |
| Lock Screen | ✅ | — | — | — | — |
| Wallpaper | ✅ | — | — | — | — |
| Settings GUI | ✅ | — | — | — | — |
| Media Player | ✅ | 0.1 | — | — | — |
| Power Menu | ✅ | 0.2 | — | — | — |
| **Phase 0 — Quick Wins** |
| Keyboard Layout | ❌ | 0.3 | — | — | — |
| Polkit Agent | ❌ | 0.4 | — | — | — |
| Window Title in Bar | ❌ | 0.5 | — | — | — |
| System Resource Monitors | ⚠️ | 0.6 | — | — | — |
| Power Profile & Auto-cpufreq | ⚠️ | 0.7 | — | — | — |
| Idle Inhibit (Caffeinated) | ⚠️ | 0.8 | — | — | — |
| World Clock | ⚠️ | 0.9 | — | — | — |
| **Phase 1 — Daily Workflow** |
| Clipboard History | ❌ | — | 1.1 | — | — |
| Night Light | ❌ | — | 1.2 | — | — |
| Per-App Volume | ❌ | — | 1.3 | — | — |
| Updates Checker | ❌ | — | 1.4 | — | — |
| Idle Controls | ❌ | — | 1.5 | — | — |
| Audio Device Selector | ⚠️ | — | 1.6 | — | — |
| Notification History | ❌ | — | 1.7 | — | — |
| Fingerprint Auth Review | ⚠️ | — | 1.8 | — | — |
| Touchpad Toggle Review | ⚠️ | — | 1.9 | — | — |
| Geolocation Review | ⚠️ | — | 1.10 | — | — |
| **Phase 2 — Window Management** |
| Window Switcher | ❌ | — | — | 2.1 | — |
| Dock | ❌ | — | — | 2.2 | — |
| Workspace Overview | ❌ | — | — | 2.3 | — |
| Bar Module Toggle UI | ❌ | — | — | 2.4 | — |
| **Phase 3 — Polish** |
| Dynamic Theming | ❌ | — | — | — | 3.1 |
| Color Picker | ❌ | — | — | — | 3.3 |
| Calendar Events | ❌ | — | — | — | 3.4 |
| Launcher Enhancements | ❌ | — | — | — | 3.5 |
| Auto-Hide Bar | ❌ | — | — | — | 3.6 |
| Searchable Settings | ❌ | — | — | — | 3.7 |
| Theme Editor | ❌ | — | — | — | 3.8 |
| Screenshot & Recording | ⚠️ | — | — | — | 3.9 |
| i18n | ❌ | — | — | — | 3.10 |
| Monitor Config UI | ❌ | — | — | — | 3.11 |
| Keyboard Hint Navigation | ❌ | — | — | — | 3.12 |
