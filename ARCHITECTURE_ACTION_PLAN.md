# Shade Shell — Architecture Action Plan

> **Purpose:** Bridge the gap between the [AUDIT.md](./AUDIT.md) (bugs/debt) and [ROADMAP.md](./ROADMAP.md) (features) by inserting structural refactoring work. This document is ordered by dependency — later phases assume earlier phases are complete.
>
> **Rule:** Do not add new ROADMAP features until the foundation (Phase A) is solid. Features built on leaking singletons and god widgets become legacy immediately.

---

## Legend

| Status | Meaning |
|--------|---------|
| `[TODO]` | Not started |
| `[WIP]` | In progress |
| `[DONE]` | Merged and verified |
| `[BLOCKED]` | Waiting on another item in this plan |

| Effort | Meaning |
|--------|---------|
| `Trivial` | < 1 hour |
| `Low` | Few hours — isolated change |
| `Medium` | 1–2 days — touches multiple files |
| `High` | 3–7 days — new service or architectural layer |

| Priority | Meaning |
|----------|---------|
| `P0` | Crash, leak, or blocks other work |
| `P1` | Significantly improves maintainability |
| `P2` | Enables future features or packaging |

---

## Phase A — Foundation Hardening

> Fix the remaining crash bugs, memory leaks, and initialization fragility before building anything new. Most items here are unfixed AUDIT.md issues.

---

### A.1 — Fix Remaining P0/P1 Crash Bugs

- **Status:** `[DONE]`
- **Effort:** Low
- **Priority:** P0
- **Cross-refs:** AUDIT.md P0.14, P1.2–P1.13, P1.17

**Items:**

| ID | File | Issue | Fix |
|----|------|-------|-----|
| A.1.1 | `src/App.tsx` | `Gdk.Display.get_default()!` crashes headlessly | Guard null, print graceful error, exit |
| A.1.2 | `src/widget/common/slider.tsx` | Subscription leak — never unsubscribed | Store unsub in `onCleanup` |
| A.1.3 | `src/widget/lockscreen/index.tsx` | Fingerprint listeners accumulate per lock | Disconnect in `onCleanup` or use `createBinding` |
| A.1.4 | `src/widget/wallpaper/index.tsx` | `Gly.Loader.load()` blocks main thread | Load async or use `Gtk.Image` with file path |
| A.1.5 | `src/lib/screenshot.ts` | Race condition on rapid record toggle | Set guard flag synchronously before async op |
| A.1.6 | `src/lib/autoCpufreq.ts` | Recursive `setTimeout` leak + snap typo | Store timeout ID, clear on dispose, fix service name |
| A.1.7 | `src/lib/inhibit.ts` | Cookie leak on repeated inhibit | Uninhibit old cookie before acquiring new one |
| A.1.8 | `src/lib/weather.ts` | Signal leak on auto-location toggle | Disconnect previous handler before connecting new one |
| A.1.9 | `src/lib/geolocation.ts` | GeoClue race + no dedup + heavy `curl` | Listen to `LocationUpdated` signal, debounce `detect()`, consider `Soup` |
| A.1.10 | `src/lib/monitors.ts` | Factory creates duplicate state + wrong signal | Make singleton, use `"items-changed"`, handle null display |
| A.1.11 | `src/widget/osd/index.tsx` | Duplicate popups on rapid changes | Deduplicate by type, reset timeout on re-trigger |
| A.1.12 | `src/lib/touchpad.ts` | Orphaned Python daemon + stale lock file | Verify PID validity, use `Gio.FileMonitor`, write to `$XDG_RUNTIME_DIR` |
| A.1.13 | `src/widget/quicksettings/button-grid/network.tsx` | `Gtk.Entry` `visibility: false` may be invalid constructor syntax | Use `set_visibility(false)` |

**Acceptance:**
- [ ] All items above have individual commits
- [ ] Run VM test for 30 min, verify no memory growth in `gjs` process
- [ ] `journalctl --user _COMM=shade-shell` shows no JS ERRORs during normal usage

---

### A.2 — Extract `ShellState` Singleton

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P1
- **Cross-refs:** AUDIT.md P2.5, P2.8

**Problem:** `src/widget/index.tsx` exports `launcherOpen`, `qsOpen`, `screenlocked` as module-level reactive state. `requestHandler.ts`, `applauncher`, `quicksettings`, `bar/launcher`, and `bar/systemIndicators` all import these directly. CLI layer depends on presentation layer.

**Approach:**
1. Create `src/lib/shellState.ts`:
   ```ts
   @register()
   class ShellState extends Object {
     @getter(Boolean) declare launcherOpen: boolean
     @setter(Boolean) declare setLauncherOpen: (v: boolean) => void
     @getter(Boolean) declare qsOpen: boolean
     @setter(Boolean) declare setQsOpen: (v: boolean) => void
     @getter(Boolean) declare screenlocked: boolean
     @setter(Boolean) declare setScreenlocked: (v: boolean) => void

     toggleLauncher() { this.setLauncherOpen(!this.launcherOpen) }
     toggleQuickSettings() { this.setQsOpen(!this.qsOpen) }

     // Mutual exclusion orchestration
     openLauncher() {
       this.setLauncherOpen(true)
       if (barVertical.get()) this.setQsOpen(false)
     }
     openQuickSettings() {
       this.setQsOpen(true)
       if (barVertical.get()) this.setLauncherOpen(false)
     }
   }
   ```
2. Migrate `requestHandler.ts` to use `ShellState.get_default()`
3. Migrate all widgets to consume `ShellState` via `createBinding`
4. Remove shared state exports from `widget/index.tsx`; keep it as a pure mount orchestrator

**Acceptance:**
- [ ] `requestHandler.ts` no longer imports `#/widget`
- [ ] `widget/index.tsx` does not export reactive state
- [ ] Mutual exclusion logic (launcher ↔ quicksettings on vertical bar) lives in `ShellState`, not in widget `onNotifyVisible` handlers
- [ ] All existing toggle commands work identically

---

### A.3 — Extract `WindowManager` Singleton

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P1

**Problem:** Widgets imperatively push into `app.bar[]`, `app.wallpaper[]`, `app.lockscreen[]` and assign `app.quicksettings = self`. `App.tsx` is both an `Adw.Application` and a global window registry.

**Approach:**
1. Create `src/lib/windowManager.ts`:
   ```ts
   @register()
   class WindowManager extends Object {
     @getter(Array) declare bars: Astal.Window[]
     @getter(Array) declare wallpapers: Astal.Window[]
     @getter(Array) declare lockscreens: Astal.Window[]
     @getter(Object) declare quicksettings: Astal.Window | null
     @getter(Object) declare osd: Astal.Window | null
     @getter(Object) declare applauncher: Astal.Window | null
     @getter(Object) declare notifications: Astal.Window | null

     registerBar(win: Astal.Window) { ... }
     unregisterBar(win: Astal.Window) { ... }
     // etc.
   }
   ```
2. Instantiate `WindowManager` in `App.tsx` before `SettingsProvider`
3. Replace all `app.bar.push(self)` with `WindowManager.get_default().registerBar(self)`
4. Replace `app.quicksettings = self` with `WindowManager.get_default().quicksettings = self`
5. Update `requestHandler.ts` to use `WindowManager` for `toggle bar`

**Acceptance:**
- [ ] No widget mutates `app` directly
- [ ] `App.tsx` properties for window arrays are removed or deprecated
- [ ] `requestHandler.ts` uses `WindowManager` for visibility toggles
- [ ] Lock screen `onRealize` logic uses `WindowManager.lockscreens` instead of `app.lockscreen`

---

### A.4 — Fix Service Initialization Order

- **Status:** `[DONE]`
- **Effort:** Low
- **Priority:** P1
- **Cross-refs:** AUDIT.md P2.5

**Problem:** `ColorScheme`, `Weather`, and `Inhibit` call `useSettings()` inside constructors. This only works because they're lazily instantiated inside the `SettingsProvider` tree. It is fragile and untestable.

**Approach:**
1. In each singleton, replace constructor settings access with an `init(settings)` method:
   ```ts
   // colorScheme.ts
   init(generalSettings: GeneralSettings) {
     this.#settings = generalSettings
     this.#applyScheme()
   }
   ```
2. In `App.tsx`, after `SettingsProvider` is ready, call:
   ```ts
   ColorScheme.get_default().init(settings.general)
   Weather.get_default().init(settings.weather)
   Inhibit.get_default().init(app) // pass app ref explicitly
   ```
3. Remove `#/App` import from `inhibit.ts`

**Acceptance:**
- [ ] No singleton constructor calls `useSettings()`
- [ ] `Inhibit` does not import `#/App`
- [ ] Services can be imported in test files without a Gnim context
- [ ] Shell starts and settings apply correctly

---

### A.5 — Extract Utility Modules

- **Status:** `[DONE]`
- **Effort:** Low
- **Priority:** P1
- **Cross-refs:** AUDIT.md P2.1–P2.3, P2.6

**Problem:** Duplicated logic scattered across widgets: `toArray<T>()` for `GLib.List`, volume icon mapping, time formatting, magic numbers.

**Approach:**
1. Create `src/lib/gjsUtils.ts`:
   - `toArray<T>(list: GLib.List<T> | Gio.ListModel | null): T[]`
   - `listLength(list: any): number`
2. Create `src/lib/audio.ts`:
   - `getVolumeIcon(volume: number, muted: boolean): string`
   - Move duplicated logic from `audioControl.tsx` and `systemIndicators.tsx`
3. Create `src/lib/time.ts`:
   - `fmtOffset(date: GLib.DateTime, ref: GLib.DateTime): string`
   - `cityName(tz: string): string`
   - Move duplicated logic from `clock.tsx` and `worldClock.tsx`
4. Replace all inline occurrences with imports

**Acceptance:**
- [ ] `toArray` exists in one place, used by `network.tsx`, `workspaces.tsx`, `monitors.ts`
- [ ] Single `getVolumeIcon` used by bar and QS
- [ ] Single time formatter used by bar clock and world clock
- [ ] No magic numbers remain in bar/systemUsage (extract named constants)

---

## Phase B — Structural Decoupling

> Break down god widgets and introduce isolation. This makes the codebase testable and prevents "one widget crash = whole session dead."

---

### B.1 — Decompose `systemIndicators.tsx`

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P1

**Problem:** `systemIndicators.tsx` (172 lines) is a god widget that directly instantiates 8 different indicators inline. A failure in any Astal service (e.g., NetworkManager not ready) can break the entire panel.

**Approach:**
1. Create `src/widget/bar/indicators/` directory:
   - `audio.tsx` — speaker/mic volume + scroll handler
   - `network.tsx` — wifi/wired icon + tooltip
   - `bluetooth.tsx` — device state
   - `battery.tsx` — level + warning classes
   - `power.tsx` — auto-cpufreq / powerprofiles
   - `dnd.tsx` — do-not-disturb
   - `recording.tsx` — screenshot recording status
2. Each indicator is a self-contained component that handles its own Astal service binding
3. `systemIndicators.tsx` becomes a thin assembly:
   ```tsx
   <Gtk.Box>
     <RecordingIndicator />
     <AudioIndicator />
     <NetworkIndicator />
     <BluetoothIndicator />
     <BatteryIndicator />
     <PowerIndicator />
     <DndIndicator />
   </Gtk.Box>
   ```
4. Add GSettings `show-*` keys for each indicator (prerequisite for ROADMAP 2.4)

**Acceptance:**
- [ ] Each indicator lives in its own file
- [ ] Removing an indicator file does not break compilation of others
- [ ] Astal service returning `null` in one indicator does not prevent others from rendering
- [ ] Scroll-to-change-volume logic lives only in `audio.tsx`

---

### B.2 — Decompose `network.tsx`

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P1

**Problem:** `quicksettings/button-grid/network.tsx` (305 lines) contains SSID decoding, BSSID comparison, password dialog, AP list, and connection state machine all inline.

**Approach:**
1. Create `src/widget/quicksettings/network/`:
   - `utils.ts` — `ssidOf()`, `bssidOf()`, `bssidEquals()`, `bytesToString()`, `toArray()`
   - `apList.tsx` — `For each={aps}` list item component
   - `passwordDialog.tsx` — standalone `Adw.MessageDialog` for WPA
   - `wifiPopover.tsx` — scan button + AP list + enable toggle
   - `index.tsx` — `SplitButton` assembly
2. Extract network utilities to `src/lib/network.ts` if used by settings panel too

**Acceptance:**
- [ ] No file > 150 lines in the network widget directory
- [ ] Password dialog is reusable (settings panel can import it)
- [ ] `network.tsx` no longer contains byte-array decoding logic

---

### B.3 — Introduce Widget Mount Isolation

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P1

**Problem:** `widgets()` mounts sequentially in a single `createRoot`. An exception in `applauncher` prevents `notifications`, `quicksettings`, `LockScreen`, and `settings` from ever mounting.

**Approach:**
1. Wrap each widget call in `widget/index.tsx` with a try/catch that logs the error but continues:
   ```ts
   export const widgets = () => {
     const safe = (name: string, fn: () => void) => {
       try { fn() }
       catch (e) { print(`[Shade] Widget ${name} failed to mount:`, e) }
     }
     safe("wallpaper", Wallpaper)
     safe("bar", bar)
     safe("osd", osd)
     // ...
   }
   ```
2. For critical widgets (bar, wallpaper), the error should still be fatal — but non-critical widgets (settings, notifications) should fail gracefully
3. Alternatively, investigate if Gnim supports error boundaries; if so, use them

**Acceptance:**
- [ ] A thrown error in `applauncher` does not prevent `quicksettings` from mounting
- [ ] Error is visible in `journalctl` with clear widget name
- [ ] Bar and wallpaper failures are still fatal (no point in a shell without a bar)

---

### B.4 — Extract `MonitorService` Singleton

- **Status:** `[DONE]`
- **Effort:** Low
- **Priority:** P1

**Problem:** `monitors()` is called independently by `bar`, `wallpaper`, and `lockscreen`, creating duplicate `Gio.ListStore` subscriptions and reactive states.

**Approach:**
1. Convert `src/lib/monitors.ts` from a factory function to a singleton:
   ```ts
   @register()
   class MonitorService extends Object {
     @getter(Array) declare monitors: Gdk.Monitor[]
     static get_default() { ... }
   }
   ```
2. Replace `monitors()` calls with `createBinding(MonitorService.get_default(), "monitors")`
3. Fix the `"notify"` signal bug — use `"items-changed"`

**Acceptance:**
- [ ] Only one `Gio.ListStore` subscription exists at runtime
- [ ] Monitor hot-plug works (verify with `hyprctl output` add/remove in VM)
- [ ] Bar, wallpaper, and lock screen all react to monitor changes

---

## Phase C — Shell vs. Desktop Environment Boundary

> Shade calls itself a "shell" but packages like a "desktop environment." This phase makes it truly composable.

---

### C.1 — Restructure NixOS Module (Shell / Desktop Layers)

- **Status:** `[DONE]`
- **Effort:** High
- **Priority:** P2
- **Cross-refs:** AUDIT.md P2.20, P2.21

**Problem:** `nix/module.nix` unconditionally imports `hyprland.nixosModules.default` and `./hyprland`, and sets extensive Hyprland defaults. Users cannot adopt Shade incrementally.

**Approach:**
1. Restructure options:
   ```nix
   programs.shade = {
     enable = mkEnableOption "Shade shell";
     package = mkPackageOption pkgs "shade-shell" { };

     shell = {
       enable = mkEnableOption "Shade shell components (bar, QS, launcher, etc.)" // true;
       blur = mkEnableOption "Layer blur for gtk4-layer-shell" // true;
     };

     desktop = {
       enable = mkEnableOption "Shade desktop environment defaults (Hyprland config, keybinds, apps)" // false;
       hyprland = {
         enable = mkEnableOption "Hyprland module integration" // false;
         # ... existing hyprland settings, but NOT imported unconditionally
       };
     };
   };
   ```
2. When `programs.shade.shell.enable = true`:
   - Install `shade-shell`, `adwaita-icon-theme`
   - Set up PAM for `astal-auth`
   - Add `uwsm-app -t service -- shade-shell` to `exec-once`
   - Add optional `layerrule` blur
3. When `programs.shade.desktop.enable = true`:
   - Import `hyprland.nixosModules.default`
   - Import `./hyprland/default.nix` and `./hyprland/binds.nix`
   - Install default apps (`firefox`, `ghostty`, etc.)
4. Update VM config to use `desktop.enable = true`
5. Document migration in CHANGELOG.md

**Acceptance:**
- [ ] Existing VM still works with `desktop.enable = true`
- [ ] User can set `shell.enable = true` + `desktop.enable = false` and use their own Hyprland config without conflict
- [ ] `nix flake check` passes
- [ ] README updated with new option structure

---

### C.2 — Lazy-Load Settings Window

- **Status:** `[DONE]`
- **Effort:** Low
- **Priority:** P2
- **Cross-refs:** AUDIT.md P3.1

**Problem:** `settings()` (full `Adw.PreferencesWindow`) is created eagerly on shell startup even though most users rarely open it.

**Approach:**
1. In `widget/index.tsx`, replace `settings()` with a stub that registers a callback:
   ```ts
   let settingsWindow: Adw.Window | null = null
   export const openSettings = () => {
     if (!settingsWindow) settingsWindow = createSettingsWindow()
     settingsWindow.present()
   }
   ```
2. Update `tray.tsx` to call `openSettings()` instead of `app.settings.visible = true`
3. Update `requestHandler.ts` to support `shade-shell toggle settings` → `openSettings()`

**Acceptance:**
- [ ] `Adw.PreferencesWindow` is not in the GTK widget tree on startup
- [ ] First open of Settings is < 200ms slower (acceptable)
- [ ] Settings window still closes and re-opens correctly

---

### C.3 — Extract Touchpad Python Script

- **Status:** `[DONE]`
- **Effort:** Low
- **Priority:** P1
- **Cross-refs:** AUDIT.md P1.13, P2.20; ROADMAP 1.9

**Problem:** 65 lines of Python are embedded as a template literal in `touchpad.ts`. Writes to `/tmp` (world-writable, symlink attack risk).

**Approach:**
1. Move script entirely to `data/scripts/toggle-touchpad.py` (already partially there)
2. Update `meson.build` to install to `${pkgdatadir}/scripts/`
3. At runtime, reference `${datadir}/shade-shell/scripts/toggle-touchpad.py`
4. Use `$XDG_RUNTIME_DIR/shade/` for PID file instead of `/tmp`
5. Evaluate `hyprctl keyword input:...` as alternative and document decision

**Acceptance:**
- [ ] No Python code in `src/lib/touchpad.ts`
- [ ] No hardcoded `/tmp` paths
- [ ] Script is installed by Meson and referenced via `datadir`
- [ ] Touchpad toggle still works in VM

---

## Phase D — Feature Development (On Solid Ground)

> Only begin these after Phase A and B are complete. New features should use the patterns established above: consume `ShellState`, register windows via `WindowManager`, and avoid `useSettings()` in singleton constructors.

---

### D.1 — Clipboard History Manager

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P2
- **Cross-refs:** ROADMAP 1.1

**Blocked by:** A.2 (ShellState), B.3 (mount isolation) — clipboard UI lives in applauncher, which must not crash the shell.

**Approach:**
1. Create `src/lib/clipboard.ts` singleton
2. Use `cliphist` (add to Nix wrapper packages) or native `wl-paste --watch`
3. Launcher prefix mode: `>` switches to clipboard search
4. Security: ignore password-manager window classes

**Acceptance:** See ROADMAP 1.1.

---

### D.2 — Night Light / Blue Light Filter

- **Status:** `[DONE]`
- **Effort:** Low–Medium
- **Priority:** P2
- **Cross-refs:** ROADMAP 1.2

**Blocked by:** A.4 (service initialization) — `NightLight` singleton should follow the same `init(settings)` pattern as `ColorScheme`.

**Approach:**
1. Create `src/lib/nightLight.ts` singleton managing `hyprsunset` subprocess
2. Reuse `ColorScheme` sunrise/sunset for auto-schedule
3. GSettings keys in `general` schema

**Acceptance:** See ROADMAP 1.2.

---

### D.3 — Per-Application Volume Mixer

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P2
- **Cross-refs:** ROADMAP 1.3

**Blocked by:** A.5 (audio utils extraction) — reuse extracted `src/lib/audio.ts`.

**Approach:**
1. Research `AstalWp` stream/node API
2. Create collapsible "Applications" section below speaker slider in QS
3. Each stream: app icon, name, mute toggle, volume slider

**Acceptance:** See ROADMAP 1.3.

---

### D.4 — Idle / Auto-Lock / Screen Dimming

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P2
- **Cross-refs:** ROADMAP 1.5

**Blocked by:** A.2 (ShellState), A.4 (service init) — `Hypridle` singleton must integrate with `ShellState.screenlocked` and `Inhibit` state.

**Approach:**
1. Create `src/lib/hypridle.ts` singleton
2. Generate `~/.config/hypr/hypridle.conf` dynamically from GSettings
3. Manage `hypridle` subprocess
4. When `Inhibit.idle === true`, pause hypridle listeners

**Acceptance:** See ROADMAP 1.5.

---

### D.5 — System Updates Checker

- **Status:** `[TODO]`
- **Effort:** Low
- **Priority:** P2
- **Cross-refs:** ROADMAP 1.4

**Approach:**
1. Create `src/lib/updates.ts` singleton
2. Detect OS, run appropriate checker (`nixos-rebuild dry-build`, `checkupdates`, `dnf check-update`)
3. Poll every 30 min, cache result
4. Show badge in bar indicators (after B.1 decomposition)

**Acceptance:** See ROADMAP 1.4.

**Implementation notes:**
- `UpdatesService` GObject singleton with `@getter/@setter` for `count` and `checking`
- OS detection via `/etc/os-release` (supports NixOS, Arch, Fedora)
- `exec_asyncv` with backend-specific output parsing; handles non-zero exit codes (e.g., dnf exits 100 when updates exist)
- Bar schema key `show-updates` (default true)
- Indicator widget at `src/widget/bar/indicators/updates.tsx` — clickable to trigger manual check, tooltip shows status

---

### D.6 — Bar Module Toggle UI

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P2
- **Cross-refs:** ROADMAP 2.4

**Blocked by:** B.1 (indicator decomposition) — must have individual indicator components before toggling them.

**Approach:**
1. Add GSettings `bar` keys: `show-launcher`, `show-workspaces`, `show-window-title`, `show-system-resources`, `show-clock`, `show-weather`, `show-system-indicators`
2. In `bar/index.tsx`, wrap each `CenterBox` child with `visible={settings.bar.showXxx}`
3. Settings → Bar: add "Modules" section with `Adw.SwitchRow` for each

**Acceptance:** See ROADMAP 2.4.

---

### D.7 — Notification History & Enhanced Popups

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P2
- **Cross-refs:** ROADMAP 1.7

**Blocked by:** A.1 (fix notification/timer leaks) — must fix P1.11/P1.12 before building on top.

**Approach:**
1. Create `src/lib/notificationHistory.ts` singleton
2. Serialize to `$XDG_CACHE_HOME/shade/notifications.json`
3. Add progress bar to popup
4. Add "History" section to QS notification list
5. Per-app ignore list in Settings → General

**Acceptance:** See ROADMAP 1.7.

---

## Phase E — Polish & Advanced Features

> Long-term differentiation. Only after Phases A–D are stable.

---

### E.1 — Dynamic Wallpaper-Driven Theming (Material You)

- **Status:** `[DONE]`
- **Effort:** Medium
- **Priority:** P3
- **Cross-refs:** ROADMAP 3.1

**Blocked by:** A.4 (service init pattern) — `Theming` singleton must follow `init()` pattern.

**Approach:**
1. Add `matugen` to Nix packages
2. Create `src/lib/theming.ts` singleton
3. On wallpaper change, run `matugen image <path> --json`
4. Inject generated CSS via `Gtk.CssProvider`

**Acceptance:** See ROADMAP 3.1.

---

## Quick Reference — Next 10 Actions

| Rank | Item | Phase | Effort | Why First? |
|------|------|-------|--------|------------|
| 1 | Fix remaining P0/P1 crash bugs | A.1 | Low | Stability prerequisite |
| 2 | Extract `ShellState` singleton | A.2 | Medium | Decouples CLI from widgets |
| 3 | Extract `WindowManager` singleton | A.3 | Medium | Stops `app` god object |
| 4 | Fix service init order | A.4 | Low | Makes services testable |
| 5 | Extract utility modules | A.5 | Low | Removes duplication |
| 6 | Decompose `systemIndicators.tsx` | B.1 | Medium | Prevents total panel crash |
| 7 | Widget mount isolation | B.3 | Medium | Graceful degradation |
| 8 | Extract `MonitorService` | B.4 | Low | Fixes hot-plug, deduplicates |
| 9 | Decompose `network.tsx` | B.2 | Medium | Maintainability |
| 10 | Restructure NixOS module | C.1 | High | Unblocks adoption |

---

## Document Maintenance

- Update status `[TODO]` → `[WIP]` → `[DONE]` as work progresses.
- When an item is done, update AUDIT.md and ROADMAP.md to cross-reference the commit.
- If a Phase D feature is started before its blockers are done, move it back to blocked and explain why.
- Revisit this plan after every release to re-prioritize.
