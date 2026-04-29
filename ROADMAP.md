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

- **Status:** `[DONE]`
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

- **Status:** `[DONE]`
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

- **Status:** `[TODO]`
- **Effort:** Low
- **Why:** Essential for multi-language users. Shows current XKB layout and allows switching.
- **Files:**
  - `src/widget/bar/systemIndicators.tsx`
  - `src/lib/keyboard.ts` (new, optional)
- **Approach:**
  1. Read keyboard layout from `AstalHyprland.Hyprland.get_default().get_monitor()` or parse `hyprctl devices -j` / `hyprctl switchxkblayout`
  2. Add indicator to `systemIndicators.tsx` (between network and battery, or near clock)
  3. Click cycles to next layout
  4. Tooltip shows full layout name
- **Hyprland API:**
  - `hyprctl devices -j` → parse `keyboards[].active_keymap`
  - `hyprctl switchxkblayout [device] next`
- **Acceptance:**
  - [ ] Layout code (e.g., "US", "BR") visible in bar when multiple layouts configured
  - [ ] Hidden (or shows single layout) when only one layout is configured
  - [ ] Click cycles to next layout
  - [ ] Updates immediately on external layout change (e.g., `hyprctl`)

---

### 0.4 — Autostart Polkit Authentication Agent

- **Status:** `[TODO]`
- **Effort:** Trivial
- **Why:** GUI apps requesting elevation (GParted, virt-manager, some installers) need a polkit agent running. Without it, they hang or fail silently.
- **Files:**
  - `nix/module.nix`
- **Approach:**
  1. Add `pkgs.hyprpolkitagent` (or `lxqt-policykit-agent` / `polkit_gnome`) to the NixOS module
  2. Add `exec-once = hyprpolkitagent` to the generated Hyprland config when `programs.shade.enable` is true
  3. Alternatively: spawn it from `App.tsx` on first launch
- **Acceptance:**
  - [ ] Running `pkexec echo test` from a terminal inside the Shade session shows an auth dialog
  - [ ] Agent is not duplicated on shell restart

---

## Phase 1 — Daily Workflow (Short Term)

> Features that users interact with every day. High impact, moderate effort.

---

### 1.1 — Clipboard History Manager

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** `cliphist` + `wl-clipboard` is in virtually every Hyprland dotfile. Integrating it into Shade eliminates an external dependency and feels native.
- **Files:**
  - `src/lib/clipboard.ts` (new)
  - `src/widget/applauncher/index.tsx` OR `src/widget/quicksettings/` (new panel)
- **Approach — Option A (cliphist integration):**
  1. Add `cliphist` + `wl-clipboard` to Nix wrapper packages
  2. Start `wl-paste --watch cliphist store` as a managed subprocess on shell startup
  3. Query history via `AstalIO.Process.exec_async("cliphist list")`
  4. Decode images if needed (`cliphist decode [id]`)
  5. UI: either a launcher prefix (`> `) or a dedicated QS panel
- **Approach — Option B (native implementation):**
  1. Use `AstalIO.Process.subprocessv(["wl-paste", "--watch", ...])` to monitor clipboard ourselves
  2. Store history in a `Gio.ListStore` or JSON file in `$XDG_CACHE_HOME/shade/clipboard.json`
  3. Render in UI with text preview (and image thumbnails if image/* mime)
- **Acceptance:**
  - [ ] Clipboard history accumulates automatically as user copies text/images
  - [ ] UI shows list with search/filter
  - [ ] Clicking an item copies it back to clipboard and closes UI
  - [ ] Optional: "Clear History" button
  - [ ] Optional: max history limit (e.g., 500 items)
  - [ ] Optional: ignore passwords (detect `keepassxc`, `bitwarden`, `password` in window class)

---

### 1.2 — Night Light / Blue Light Filter Toggle

- **Status:** `[TODO]`
- **Effort:** Low–Medium
- **Why:** GNOME, KDE, macOS, and Windows all have this. Users expect it in Quick Settings.
- **Files:**
  - `src/lib/nightLight.ts` (new)
  - `src/widget/quicksettings/button-grid/` (new toggle)
  - `src/widget/settings/general.tsx`
- **Approach:**
  1. **Backend options:**
     - `hyprsunset` (newer, Hyprland-native) — `hyprsunset --temperature 3000`
     - `wl-gammarelay-rs` (D-Bus gamma control)
     - `wlsunset` (simpler, sunrise/sunset based)
  2. Add Night Light toggle to Quick Settings button grid
  3. Add temperature slider (2000K–6500K) in dropdown or QS panel
  4. Add settings in General page: enable, temperature, auto-schedule (sunset→sunrise)
  5. For auto-schedule, reuse existing `ColorScheme` sunrise/sunset logic
- **Acceptance:**
  - [ ] Toggle turns night light on/off immediately
  - [ ] Slider adjusts color temperature smoothly
  - [ ] Auto-schedule enables at sunset, disables at sunrise
  - [ ] State persists across shell restarts (GSettings)
  - [ ] Does not conflict with manual color scheme switching

---

### 1.3 — Per-Application Volume Mixer

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** Current audio slider only controls the default device. Users want to mute/change volume per app (Discord vs. Music vs. Browser).
- **Files:**
  - `src/widget/common/audioControl.tsx`
  - `src/widget/quicksettings/sliders.tsx`
- **Approach:**
  1. `AstalWp` exposes audio streams. Inspect what properties are available on `WpObject` / `WpNode`.
  2. In `AudioEndpointControl` or a new component, list all `audio.streams` (or equivalent Astal API).
  3. Each stream row: app icon, app name, mute toggle, volume slider.
  4. Show in Quick Settings below the main speaker slider (collapsible section).
- **Astal API Research Needed:**
  - Check if `AstalWp` has a `streams` or `nodes` property beyond `defaultSpeaker` / `defaultMicrophone`
  - If not exposed, may need to extend AstalWp bindings or use `pw-cli` / `wpctl`
- **Acceptance:**
  - [ ] List shows all active audio streams (apps playing audio)
  - [ ] Each stream has independent volume slider
  - [ ] Each stream has mute toggle
  - [ ] List updates dynamically as apps start/stop playing audio
  - [ ] Optionally: show stream "role" (music, video, game, notification)

---

### 1.4 — System Updates Checker

- **Status:** `[TODO]`
- **Effort:** Low
- **Why:** One-click visibility into pending updates is a standard bar feature (HyprPanel, Waybar custom scripts, GNOME extensions).
- **Files:**
  - `src/lib/updates.ts` (new)
  - `src/widget/bar/systemIndicators.tsx`
- **Approach:**
  1. Detect distro/Nix channel and run appropriate checker:
     - NixOS: `nixos-rebuild dry-build` or `nix flake metadata` (expensive) — maybe just check `nix-channel --list` or a custom flag
     - Arch: `checkupdates` (from `pacman-contrib`)
     - Fedora: `dnf check-update`
  2. Poll every 30–60 minutes
  3. Show count badge in bar (e.g., package-upgrade-symbolic + "12")
  4. Click opens terminal with update command or opens default package manager
  5. Hide when count is 0
- **Acceptance:**
  - [ ] Shows pending update count when > 0
  - [ ] Hidden when system is up to date
  - [ ] Click action opens update tool
  - [ ] Works on NixOS (primary target) and ideally Arch

---

### 1.5 — Idle / Auto-Lock / Screen Dimming Controls

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** Users expect Quick Settings toggles for screen auto-lock and idle timeout. `hypridle` is the standard but Shade has no UI for it.
- **Files:**
  - `src/lib/hypridle.ts` (new)
  - `src/widget/quicksettings/button-grid/` (new toggle)
- **Approach:**
  1. Parse existing `~/.config/hypr/hypridle.conf` or generate one
  2. Provide toggles:
     - Auto-lock on/off
     - Screen dim before lock on/off
     - Idle timeout slider (1–30 min)
  3. Use `AstalIO.Process` to reload `hypridle` config or send signals
  4. Alternatively: manage `hypridle` as a subprocess and generate config dynamically
- **Acceptance:**
  - [ ] Toggle disables/enables auto-lock behavior
  - [ ] Timeout slider changes idle delay
  - [ ] Screen dimming reduces brightness before lock
  - [ ] Changes apply without Hyprland restart

---

## Phase 2 — Window Management UX (Medium Term)

> These are the biggest gaps vs. GNOME/KDE. They change how users interact with windows.

---

### 2.1 — Window Switcher (Alt-Tab Replacement)

- **Status:** `[TODO]`
- **Effort:** High
- **Why:** The single biggest UX gap. Tiling WMs without a visual window switcher feel incomplete. `hyprshell` exists solely because of this need.
- **Files:**
  - New: `src/widget/windowswitcher/` (or `src/widget/overview/`)
- **Approach — MVP (text + icons):**
  1. `Astal.Window` with `layer=OVERLAY`, `keymode=EXCLUSIVE`
  2. Triggered by `Super+Tab` or `Alt+Tab` (bind in Hyprland config)
  3. Grid/list of all open clients from `AstalHyprland`
  4. Each item: app icon, window title, workspace number, monitor indicator
  5. Arrow keys / Tab to navigate, Enter/Release to focus, Escape to cancel
  6. Release modifier key to activate selected window
- **Approach — Advanced (thumbnails):**
  1. Use `grim` on window geometry to capture live thumbnails
  2. Cache thumbnails to avoid performance issues
  3. Show in a grid with live previews
  4. This is significantly more complex; consider deferring
- **Hyprland Integration:**
  - `AstalHyprland.get_default().clients` for window list
  - `client.focus()` to focus
  - `client.workspace.id` for grouping
- **Acceptance:**
  - [ ] Opens on `Alt+Tab` / `Super+Tab`
  - [ ] Shows all open windows across all workspaces/monitors
  - [ ] Keyboard navigation works (arrow keys, Tab, Enter)
  - [ ] Releasing modifier focuses selected window
  - [ ] Closes on Escape without switching
  - [ ] Appears centered on active monitor
  - [ ] Optional: group by workspace or monitor
  - [ ] Optional: show window class icon

---

### 2.2 — Dock / Taskbar for Running Apps

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** The bar workspaces show clients, but a persistent dock with pinned favorites + running indicators is what users expect from GNOME/KDE/macOS. `dash-to-dock` is the most popular GNOME extension ever.
- **Files:**
  - New: `src/widget/dock/`
- **Approach:**
  1. `Astal.Window` with `layer=TOP`, anchored to bottom (or follow bar position)
  2. `Gtk.Box` with app icons
  3. **Pinned apps:** Read from a GSettings list (user-configurable in Settings)
  4. **Running apps:** Merge with `AstalHyprland.clients`, show indicator dot under running apps
  5. **Behavior:**
     - Click running app → focus it
     - Click pinned but not running → launch it
     - Right-click → context menu (close, float, pin/unpin, workspace)
     - Scroll → cycle windows of same app
  6. Auto-hide option: hide when maximized window is present
  7. Intellihide: hide when window overlaps
- **Acceptance:**
  - [ ] Shows pinned apps (configurable in Settings)
  - [ ] Running apps have an indicator dot or highlight
  - [ ] Click focuses or launches
  - [ ] Right-click context menu with window actions
  - [ ] Optional: auto-hide when maximized
  - [ ] Optional: intellihide
  - [ ] Optional: vertical mode for left/right bar setups

---

### 2.3 — Workspace Overview / Exposé

- **Status:** `[TODO]`
- **Effort:** High
- **Why:** GNOME Activities overview and macOS Mission Control set the standard. For tiling WMs, this is harder but `Hyprspace` plugin proves it's desired.
- **Files:**
  - New: `src/widget/overview/` or integrate with window switcher
- **Approach:**
  1. Full-screen `Astal.Window` with `layer=OVERLAY`, `keymode=EXCLUSIVE`
  2. Show all workspaces in a grid
  3. Each workspace shows its windows as thumbnails or icon grids
  4. Click workspace to switch, click window to focus
  5. Drag-and-drop to move windows between workspaces
  6. Triggered by `Super` (tap) or `Super+A` — may conflict with Hyprland binds
- **Alternative:**
  - Instead of building from scratch, document how to use `Hyprspace` plugin alongside Shade
  - Or build a simpler "workspace grid" without thumbnails (just app icons per workspace)
- **Acceptance:**
  - [ ] Full-screen overlay showing all workspaces
  - [ ] Each workspace shows its windows
  - [ ] Click to switch workspace or focus window
  - [ ] Escape to close
  - [ ] Optional: drag-and-drop window moving

---

## Phase 3 — Polish & Differentiation (Long Term)

> Features that make Shade stand out from other AGS shells.

---

### 3.1 — Dynamic Wallpaper-Driven Theming (Material You)

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** `matugen`, `pywal`, and Material You color extraction are extremely popular in the r/unixporn and Hyprland communities. The entire shell adapting to the wallpaper is a "wow" feature.
- **Files:**
  - `src/lib/theming.ts` (new)
  - `src/App.tsx` (CSS injection)
  - `src/widget/settings/general.tsx`
- **Approach:**
  1. Integrate `matugen` (Rust, fast, Material You algorithm) or `pywal`
  2. On wallpaper change, extract dominant colors
  3. Generate CSS custom properties (`--accent`, `--accent-bg`, `--destructive`, etc.)
  4. Inject into GTK via `Gtk.CssProvider`
  5. Update Libadwaita accent color if possible
  6. Optional: generate Hyprland border colors too (write to Hyprland config or use `hyprctl`)
- **Acceptance:**
  - [ ] Changing wallpaper updates shell accent colors automatically
  - [ ] Colors look good on both light and dark themes
  - [ ] Can be disabled in Settings
  - [ ] Optional: manual "Regenerate" button

---

### 3.2 — CAVA Audio Visualizer

- **Status:** `[TODO]`
- **Effort:** Low
- **Why:** Eye candy. Popular in AGS rices and HyprPanel. `AstalCava` exists as an Astal service.
- **Files:**
  - New widget in bar or QS
- **Approach:**
  1. Add `astal-cava` to flake inputs / Nix packages
  2. Use `AstalCava` service to get audio frequency data
  3. Render as a small bar visualizer in the status bar (near media controls) or in QS
  4. `Gtk.DrawingArea` or `Gtk.LevelBar` array
- **Acceptance:**
  - [ ] Visualizer reacts to system audio output
  - [ ] Shows only when audio is playing (or always, user preference)
  - [ ] Doesn't use excessive CPU

---

### 3.3 — Color Picker Integration

- **Status:** `[TODO]`
- **Effort:** Low
- **Why:** `hyprpicker` is standard in Hyprland setups. A Quick Settings button or keybind to pick a color and copy hex to clipboard is useful.
- **Files:**
  - `src/lib/colorPicker.ts` (new)
- **Approach:**
  1. Add `hyprpicker` to Nix wrapper packages
  2. Button in QS or bar that runs `hyprpicker -a` (auto-copy) or `hyprpicker -n` (no fork) and captures output
  3. Optional: show a small toast with the picked color + hex value
- **Acceptance:**
  - [ ] Clicking button starts color picker cursor
  - [ ] Selected color hex is copied to clipboard
  - [ ] Optional: OSD shows color swatch + hex code

---

### 3.4 — Calendar Events Integration

- **Status:** `[TODO]`
- **Effort:** Medium–High
- **Why:** Basic calendar widgets show dates. Showing actual events (from GNOME Online Accounts, Nextcloud, local `.ics`) is what makes a calendar useful.
- **Files:**
  - `src/lib/calendar.ts` (new)
  - `src/widget/quicksettings/expander/calendar.tsx`
- **Approach:**
  1. Use `libecal` / Evolution Data Server (EDS) via GObject introspection
  2. Or read from standard calendar directories (`~/.local/share/gnome-shell/calendar.ics`)
  3. Or integrate with `vdirsyncer` / CalDAV
  4. Show event dots/markers on calendar days
  5. Show event list below calendar when a day with events is selected
- **Acceptance:**
  - [ ] Calendar shows markers on days with events
  - [ ] Selecting a day shows that day's events
  - [ ] Works with at least one backend (EDS or local ICS)

---

### 3.5 — Launcher Enhancements (Calculator, Emoji, Web Search)

- **Status:** `[TODO]`
- **Effort:** Low (each)
- **Why:** Power-user features that make the launcher a true "universal search" tool.
- **Files:**
  - `src/widget/applauncher/index.tsx`
- **Approach:**
  1. **Calculator:** Detect math expressions (e.g., starts with `=` or matches `/^[\d\s+\-*/().]+$/`). Evaluate with `GLib.spawn_command_line_sync("bc", ...)` or a JS math parser. Show result as first item.
  2. **Emoji:** Maintain a JSON map of emoji names. Prefix `:` or trigger on search. Copy selected emoji to clipboard.
  3. **Web Search:** Prefix `?` or `!` or fallback when no app matches. Open default browser with search query (DuckDuckGo, Google).
  4. **Window Switching:** When input matches a window title/class, show "Switch to Window" action.
- **Acceptance:**
  - [ ] `= 2+2` shows result `4` as selectable item
  - [ ] `:thumbs` shows 👍 as selectable item
  - [ ] `? how to center a div` opens browser search
  - [ ] Typing a window title shows "Focus Firefox" action

---

### 3.6 — Auto-Hide / Floating Bar Modes

- **Status:** `[TODO]`
- **Effort:** Medium
- **Why:** Modern shells support floating bars with rounded corners/gaps, and auto-hide when a window overlaps or maximizes.
- **Files:**
  - `src/widget/bar/index.tsx`
  - `src/lib/gschema.ts`
  - `src/widget/settings/bar.tsx`
- **Approach:**
  1. Add GSettings keys:
     - `bar-mode`: `normal`, `floating`, `auto-hide`
     - `bar-margin`: int (pixels)
  2. Floating mode: apply margin + rounded corners via CSS
  3. Auto-hide: listen to Hyprland events for maximized/fullscreen windows on current monitor; animate bar out/in
  4. May need `Astal.Layer.TOP` instead of `EXCLUSIVE` for floating modes
- **Acceptance:**
  - [ ] Floating mode shows bar with gaps from screen edges
  - [ ] Auto-hide hides bar when maximized window is present
  - [ ] Bar reappears on edge hover (or keybind)

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

| Feature | Shade Now | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---------|-----------|---------|---------|---------|---------|
| Status Bar | ✅ | — | — | — | — |
| App Launcher | ✅ | — | — | — | — |
| Quick Settings | ✅ | — | — | — | — |
| Notifications | ✅ | — | — | — | — |
| OSD | ✅ | — | — | — | — |
| Lock Screen | ✅ | — | — | — | — |
| Wallpaper | ✅ | — | — | — | — |
| Settings GUI | ✅ | — | — | — | — |
| Screenshot/Recording | ✅ | — | — | — | — |
| Media Player | ✅ | 0.1 | — | — | — |
| Power Menu | ✅ | 0.2 | — | — | — |
| Keyboard Layout | ❌ | 0.3 | — | — | — |
| Polkit Agent | ❌ | 0.4 | — | — | — |
| Clipboard History | ❌ | — | 1.1 | — | — |
| Night Light | ❌ | — | 1.2 | — | — |
| Per-App Volume | ❌ | — | 1.3 | — | — |
| Updates Checker | ❌ | — | 1.4 | — | — |
| Idle Controls | ❌ | — | 1.5 | — | — |
| Window Switcher | ❌ | — | — | 2.1 | — |
| Dock | ❌ | — | — | 2.2 | — |
| Workspace Overview | ❌ | — | — | 2.3 | — |
| Dynamic Theming | ❌ | — | — | — | 3.1 |
| CAVA Visualizer | ❌ | — | — | — | 3.2 |
| Color Picker | ❌ | — | — | — | 3.3 |
| Calendar Events | ❌ | — | — | — | 3.4 |
| Launcher Enhancements | ❌ | — | — | — | 3.5 |
| Auto-Hide Bar | ❌ | — | — | — | 3.6 |
