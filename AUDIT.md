# Shade Shell — Critical Code Audit

> Comprehensive review of the current codebase. Items are categorized by severity and area.
> Use this to prioritize fixes before adding new features.

---

## Severity Legend

| Severity | Meaning |
|----------|---------|
| **P0 — Crash/Data Loss** | Will crash the shell, corrupt state, or cause data loss. Fix immediately. |
| **P1 — Bug/Leak** | Incorrect behavior, memory leak, or race condition. Fix before next release. |
| **P2 — Polish/Debt** | Inconsistency, duplication, or maintainability issue. Fix when convenient. |
| **P3 — Nice-to-have** | Improvement or optimization opportunity. |

---

## P0 — Crash / Data Loss (Fix Immediately)

### P0.1 — Bar crashes on workspace client iteration (`GLib.List` not iterable) **[FIXED]**
- **File:** `src/widget/bar/workspaces.tsx`
- **Problem:** `createBinding(ws, "clients")` returns a `GLib.List`. The `For` component spreads it with `[...iterable]`. `GLib.List` does **not** implement the JS iterator protocol in GJS. This throws a `TypeError` and crashes the entire bar.
- **Fix:** Import the `toArray<T>()` helper from `network.tsx` and convert clients before passing to `For`:
  ```ts
  const clients = createBinding(ws, "clients").as(c => toArray(c))
  ```
- **Related:** AGENTS.md already documents this pitfall. The workspace widget didn't follow its own advice.

---

### P0.2 — OSD forced to monitor 1 regardless of focus **[FIXED]**
- **File:** `src/widget/osd/index.tsx`
- **Problem:** `monitor={createBinding(hyprland, "focusedMonitor")(m => m.id && 1)}` — `m.id && 1` evaluates to `1` for any truthy monitor ID. OSD always appears on monitor 1, not the focused monitor.
- **Fix:** Change to `m => m.id`.

---

### P0.3 — Settings wallpaper file dialog crashes on cancel **[FIXED]**
- **File:** `src/widget/settings/general.tsx`
- **Problem:** `fileDialog.open_finish(res).get_path() ?? ""` — if the user cancels, `open_finish` may throw or return an object without `get_path()`. The unguarded access crashes.
- **Fix:** Wrap in `try/catch`:
  ```ts
  try {
    const path = fileDialog.open_finish(res)?.get_path()
    if (path) settings.wallpaperDay = path
  } catch { /* user cancelled */ }
  ```

---

### P0.4 — Weather null dereference in bar and QS **[FIXED]**
- **Files:** `src/widget/bar/weather.tsx`, `src/widget/quicksettings/expander/weather.tsx`
- **Problem:** `weather.as(w => w.get_icon_name())` and `weatherInfo.as(w => w.get_icon_name())` assume `info` is never null. During initialization or with an invalid location, `info` is null and these crash.
- **Fix:** Use `With` or `.as(w => w?.get_icon_name() ?? "")` with a fallback icon.

---

### P0.5 — Brightness module crashes on import (desktop PCs, VMs) **[FIXED]**
- **File:** `src/lib/brightness.ts`
- **Problem:** Module-level code runs `brightnessctl` and `bash` at import time. If `/sys/class/backlight` is empty (no backlight on desktop/VM), `head -1` returns empty string. `brightnessctl --device "" max` throws, crashing the entire shell on startup.
- **Fix:** Wrap the initial hardware probe in `try/catch`. Default to `available = false` if no devices are found. Defer detection to first use or constructor, not module top-level.

---

### P0.6 — Disk usage formula is mathematically wrong **[FIXED]**
- **File:** `src/widget/bar/systemUsage.tsx`
- **Problem:** `setDisk(diskTop.bavail / diskTop.bfree)` computes the ratio of *available* to *free* blocks, not used space. This is nonsensical. It should be `1 - (bavail / blocks)` or `(blocks - bfree) / blocks`. Also `bfree` can be 0, causing NaN.
- **Fix:** Use `glibtop_fsusage` fields correctly: `used = (fs.blocks - fs.bavail) / fs.blocks`.

---

### P0.7 — Temperature reading blocks UI thread every second **[FIXED]**
- **File:** `src/widget/bar/systemUsage.tsx`
- **Problem:** `AstalIO.Process.exec(`cat ${settings.bar.tempPath.get()}`)` is a **synchronous blocking call** inside a 1-second interval. If the file doesn't exist, `cat` hangs or fails, freezing the entire UI thread for 1 second every second.
- **Fix:** Use `Gio.File.new_for_path(path).load_contents_async()` or `AstalIO.Process.exec_async`. Never use synchronous exec in UI code.

---

### P0.8 — Hyprland config syntax errors (`bindm` malformed) **[FIXED]**
- **File:** `nix/hyprland/binds.nix`
- **Problem:** `"SUPER,SHIFT, movewindow"` and `"SUPER,CONTROL,resizewindow"` are invalid. `SHIFT` and `CONTROL` are modifiers, not keys. `bindm` requires `MOD, KEY, dispatcher`. Hyprland will reject the config.
- **Fix:** Use `bindm = SUPER, mouse:272, movewindow` and `bindm = SUPER, mouse:273, resizewindow` (standard Hyprland mouse binds). Remove the malformed lines.

---

### P0.9 — Touchpad script path/name mismatch **[FIXED]**
- **Files:** `nix/hyprland/binds.nix`, `src/lib/touchpad.ts`, `meson.build`
- **Problem:** The script is installed as `toggle-touchpad.py` in `bindir`, but the Hyprland bind looks for `python3 /tmp/shade-touchpad-toggle.py`. The `touchpad.ts` fallback also writes to `/tmp/shade-touchpad-toggle.py`. Three different names/paths.
- **Fix:** Standardize on one name and path. Use the installed bindir path in the Hyprland config, or use a GJS-native implementation and eliminate the Python script entirely.

---

### P0.10 — Wallpaper installed to wrong directory **[FIXED]**
- **Files:** `meson.build`, `src/lib/gschema.ts`
- **Problem:** `meson.build` installs wallpapers to `datadir` (e.g. `/usr/share/wp-day.jpg`), but `gschema.ts` references `${datadir}/shade-shell/wp-day.jpg`. Wallpapers won't be found at runtime.
- **Fix:** Either install to `datadir / 'shade-shell'` in `meson.build`, or update the schema default to point to `datadir` directly.

---

### P0.11 — `dev` script does not compile schemas **[FIXED]**
- **File:** `package.json`
- **Problem:** The `dev` script copies `.xml` files but never runs `glib_compile_schemas`. GSettings won't find the schemas, and the shell crashes on startup.
- **Fix:** Add `glib_compile_schemas ./dist/share/glib-2.0/schemas` after the copy step.

---

### P0.12 — `plugin.dynamic-cursors` config without loading plugin **[FIXED]**
- **File:** `nix/hyprland/default.nix`
- **Problem:** Lines 181-198 configure `plugin.dynamic-cursors`, but the `plugins` list is commented out. Hyprland may error or warn on unknown plugin keys.
- **Fix:** Remove the plugin config or uncomment the plugin import.

---

### P0.13 — App launcher crashes on empty search + Enter **[FIXED]**
- **File:** `src/widget/applauncher/index.tsx`
- **Problem:** `onActivate` does `apps.fuzzy_query(self.text)[0].launch()` without checking if the array is non-empty. Pressing Enter with no matches crashes.
- **Fix:** Guard with `if (results.length > 0) results[0].launch()`.

---

### P0.14 — `Gdk.Display.get_default()!` crashes headlessly
- **File:** `src/App.tsx`
- **Problem:** Non-null assertion assumes a display always exists. Running via SSH, on a TTY, or in CI causes an immediate null dereference.
- **Fix:** Check for null and print a graceful error message before exiting.

---

### P0.15 — Keyboard brightness setter broken (missing `%` suffix) **[FIXED]**
- **File:** `src/lib/brightness.ts`
- **Problem:** `set kbd(value)` runs `brightnessctl -d ${kbd} s ${value} -q` where `value` is 0–1. It sets absolute brightness to 0 or 1 instead of a percentage. Compare with `set screen(percent)` which correctly uses `${Math.floor(percent * 100)}%`.
- **Fix:** Append `%` to the keyboard brightness value.

---

## P1 — Bugs / Leaks / Race Conditions

### P1.1 — `setInterval` leaks everywhere (memory + CPU waste) **[FIXED]**
- **Files:** `src/widget/bar/clock.tsx`, `src/widget/bar/systemUsage.tsx`, `src/widget/quicksettings/expander/worldClock.tsx`, `src/widget/lockscreen/index.tsx`
- **Problem:** Every `setInterval` in the codebase is never cleared. If bars are destroyed (monitor disconnect), or the lock screen is unlocked, intervals continue firing forever.
- **Fix:** Store interval IDs and clear them in `onCleanup`. Consider using `GLib.timeout_add` with source IDs instead of `setInterval` for better GJS integration.
- **Affected intervals:**
  - Clock: 1000ms (x2 — bar clock + world clock)
  - System usage: 1000ms
  - Lock screen clock: 1000ms
  - Weather: `setInterval(..., 0.25 * 3600000)` (also uses `setInterval` instead of `GLib.timeout_add`)

---

### P1.2 — Slider subscription leak
- **File:** `src/widget/common/slider.tsx`
- **Problem:** `props.value.subscribe((v) => { ... })` is registered once per component instance and **never unsubscribed**. If the slider is destroyed, the subscription continues firing.
- **Fix:** Store the unsubscribe function and call it in `onCleanup`.

---

### P1.3 — Fingerprint listeners accumulate on every lock
- **File:** `src/widget/lockscreen/index.tsx`
- **Problem:** `fingerprint.connect("verified", ...)` and `fingerprint.connect("failed", ...)` are called every time the screen locks. The listeners accumulate on the singleton and never disconnect. After 10 locks, unlocking fires 10 `doUnlock` calls.
- **Fix:** Disconnect listeners in `onCleanup`, or use `createBinding` / `createComputed` instead of manual `connect`.

---

### P1.4 — Wallpaper image loading blocks main thread
- **File:** `src/widget/wallpaper/index.tsx`
- **Problem:** `Gly.Loader.new(wp).load().next_frame()` runs synchronously on the main thread. Large images cause UI freezes. No caching.
- **Fix:** Load asynchronously, cache textures, or use `Gtk.Image` with a file path and let GTK handle loading.

---

### P1.5 — Screenshot recording race condition
- **File:** `src/lib/screenshot.ts`
- **Problem:** `this.#recording = true` is set inside the `mkdir` callback. Rapid double-clicks pass the guard check before the first callback completes, starting two recordings.
- **Fix:** Set the guard flag synchronously before any async operation.

---

### P1.6 — Auto-cpufreq memory leak + snap typo
- **File:** `src/lib/autoCpufreq.ts`
- **Problem:**
  1. `#poll()` uses recursive `setTimeout` with no cancellation handle.
  2. `"snap.auto-cpufreq.service.service"` has `.service` duplicated.
  3. `set_active_profile` calls `pkexec` even when `#available === false`.
- **Fix:** Store timeout ID, clear on dispose. Fix snap service name. Guard profile setter.

---

### P1.7 — Inhibit cookie leak
- **File:** `src/lib/inhibit.ts`
- **Problem:** If `idle` is set to `true` repeatedly, `inhibit()` is called multiple times but only the latest cookie is stored. Previous inhibitors leak forever.
- **Fix:** Guard against duplicate inhibition, or uninhibit before re-inhibiting.

---

### P1.8 — Weather signal leak on auto-location toggle
- **File:** `src/lib/weather.ts`
- **Problem:** When `autoLocation` is toggled on, `settings.autoLocation.subscribe(...)` connects `geo.locationChanged` again. Turning it on/off multiple times accumulates duplicate handlers.
- **Fix:** Disconnect the previous handler before connecting a new one, or use a single reactive computed.

---

### P1.9 — GeoClue race condition + IP geolocation fallback
- **File:** `src/lib/geolocation.ts`
- **Problem:**
  1. After `client.call("Start")`, it immediately reads the cached property. GeoClue often updates asynchronously, so the cached value may be stale, causing a false fallback to IP geolocation.
  2. `detect()` has no deduplication — rapid calls spawn multiple sessions.
  3. `curl` subprocess for IP geolocation is heavy; no error handling on HTTP failure.
- **Fix:** Listen for GeoClue's `LocationUpdated` signal instead of reading cached property. Debounce `detect()`. Consider `Soup` instead of `curl`.

---

### P1.10 — Monitors factory leaks + wrong signal
- **File:** `src/lib/monitors.ts`
- **Problem:**
  1. `monitors()` is a factory, not a singleton. Every call creates new state + signal connections.
  2. `monitorList.connect("notify", ...)` is wrong — `Gio.ListModel` emits `"items-changed"`, not `"notify"`. Monitor hot-plug likely never works.
  3. `Gdk.Display.get_default()!` asserts display exists.
- **Fix:** Make `monitors` a singleton. Use `"items-changed"`. Handle null display.

---

### P1.11 — Notification popup dismisses while being read **[FIXED]**
- **File:** `src/widget/notifications/index.tsx`
- **Problem:** Auto-dismiss timer (5s) is not cancelable. If the user hovers over a notification, it still disappears.
- **Fix:** Clear the timeout on mouse enter, restart on mouse leave.

---

### P1.12 — OSD duplicate popups + no deduplication
- **File:** `src/widget/osd/index.tsx`
- **Problem:**
  1. Muting changes volume to 0, potentially triggering both volume and mute popups simultaneously.
  2. Rapid volume changes spawn multiple overlapping popups with independent timeouts, causing flicker.
- **Fix:** Deduplicate by type — if a popup of the same type is already showing, reset its timeout instead of spawning a new one.

---

### P1.13 — Touchpad orphaned process + stale lock file
- **File:** `src/lib/touchpad.ts`
- **Problem:**
  1. Python daemon forks and `pause()`s. If Shade crashes, the child may survive indefinitely.
  2. `#checkState()` only checks lock file existence, not PID validity. Dead processes leave stale state.
  3. Writing an executable to `/tmp` (world-writable) is a symlink attack risk.
- **Fix:** Use `libinput` or `xinput` instead of `EVIOCGRAB`. Or at minimum: verify PID, use `Gio.FileMonitor` instead of polling, write temp file securely.

---

### P1.14 — OSD popup timeout doesn't reset on re-trigger **[FIXED]**
- **File:** `src/widget/osd/popup.tsx`
- **Problem:** If the signal fires while already revealed, the popup stays visible but does NOT reset the 2-second timeout. A second volume change 1.5s after the first hides at 2s (original timeout), not 3.5s.
- **Fix:** Clear and restart the timeout on every signal emission.

---

### P1.15 — `colorSchemeName` always returns "Auto" **[FIXED]**
- **File:** `src/lib/colorScheme.ts`
- **Problem:** Both `LIGHT` and `DARK` cases return `"Auto"`. This is clearly a bug or unfinished code.
- **Fix:** Return `"Light"` and `"Dark"` respectively.

---

### P1.16 — `network.wifi` direct access in settings (AGENTS.md pitfall) **[FIXED]**
- **File:** `src/widget/settings/network.tsx`
- **Problem:** `const wifi = network.wifi` is evaluated once at construction. If the WiFi device appears later (e.g., after rfkill unblock), the settings panel shows null forever.
- **Fix:** Use `createBinding(network, "wifi")` with `With` or conditional rendering.

---

### P1.17 — Network password dialog visibility bug
- **File:** `src/widget/quicksettings/button-grid/network.tsx`
- **Problem:** `Gtk.Entry` constructor uses `visibility: false` which may not be valid in GJS/GTK4 constructor syntax. Should use `set_visibility(false)`.

---

### P1.18 — Media player icon name mangled **[FIXED]**
- **File:** `src/widget/quicksettings/expander/media.tsx`
- **Problem:** `iconName={"media-skip-backwiconNameard-symbolic"}` is a garbled string.
- **Fix:** Correct to `"media-skip-backward-symbolic"`.

---

### P1.19 — Media player `exact_query` non-null assertion **[FIXED]**
- **File:** `src/widget/quicksettings/expander/media.tsx`
- **Problem:** `apps.exact_query(entry)[0]!.iconName` will crash if the query returns empty.
- **Fix:** Use `?.iconName ?? "audio-x-generic-symbolic"`.

---

### P1.20 — App launcher no "no results" state + no keyboard nav **[FIXED]**
- **File:** `src/widget/applauncher/index.tsx`
- **Problem:** Empty search shows nothing. Arrow keys and Escape don't work.
- **Fix:** Add an `Adw.StatusPage` for empty state. Add key controller for Escape (close) and arrow keys (navigate list).

---

### P1.21 — `setScreelocked` typo propagates **[FIXED]**
- **Files:** `src/widget/index.tsx`, `src/widget/lockscreen/index.tsx`, `src/widget/quicksettings/tray.tsx`, `src/lib/requestHandler.ts`
- **Problem:** The misspelling `Screelocked` (missing 'n') is exported and imported in multiple files.
- **Fix:** Rename to `setScreenlocked` everywhere.

---

### P1.22 — `package.json` `latest` tags = non-reproducible builds
- **File:** `package.json`
- **Problem:** All devDependencies use `latest`. Major version bumps can break the build or linting.
- **Fix:** Pin to specific versions. Use `pnpm update` deliberately.

---

## P2 — Inconsistencies / Duplication / Polish

### P2.1 — Duplicated `autoCpufreq.tsx` and `powerprofiles.tsx`
- **Files:** `src/widget/quicksettings/button-grid/autoCpufreq.tsx`, `powerprofiles.tsx`
- **Problem:** ~90% identical code. Only the service and icon binding source differ.
- **Fix:** Extract a shared `ProfileToggle` component that accepts a service prop.

---

### P2.2 — Duplicated `fmtOffset` / `cityName` in clock and world clock
- **Files:** `src/widget/bar/clock.tsx`, `src/widget/quicksettings/expander/worldClock.tsx`
- **Problem:** Identical ~30-line formatting functions copied verbatim.
- **Fix:** Move to `src/lib/time.ts` or similar shared utility.

---

### P2.3 — Duplicated volume icon logic
- **Files:** `src/widget/common/audioControl.tsx`, `src/widget/bar/systemIndicators.tsx`
- **Problem:** `getVolumeIcon` and `getAudioIcon` do the same computation with different names.
- **Fix:** Unify in `src/lib/audio.ts`.

---

### P2.4 — Error handling patterns vary wildly
- **Files:** Many
- **Problem:**
  - `network.tsx`: `.catch((e: Error) => print(...))`
  - `bluetooth.tsx`: `try/catch` with `print(e)`
  - `systemUsage.tsx`: swallows all errors silently
  - `lockscreen.tsx`: `console.log(e)` (may not print in GJS)
  - `settings/general.tsx`: no error handling for file dialogs
- **Fix:** Standardize on `print()` for GJS logging, with consistent `try/catch` or `.catch()` patterns.

---

### P2.5 — State access patterns differ across components
- **Problem:** Some read `.get()` inside handlers, others use reactive bindings exclusively, some mix both.
- **Fix:** Prefer reactive bindings for display, `.get()` only inside event handlers where synchronous read is required.

---

### P2.6 — Magic numbers scattered
- **Files:** Many
- **Problem:** `100000` (temp), `8` (position threshold), `3600000` (hour in ms), `24`/`48`/`64` (pixel sizes).
- **Fix:** Extract named constants.

---

### P2.7 — Hardcoded personal defaults in schema
- **File:** `src/lib/gschema.ts`
- **Problem:** `timezones` defaults to `["America/Sao_Paulo", "Australia/Sydney"]`. Also hardcoded developer email in `weather.ts`.
- **Fix:** Use empty array or UTC defaults for timezones. Remove personal email from GWeather contact info.

---

### P2.8 — Power button is instant shutdown **[FIXED]**
- **File:** `src/widget/quicksettings/tray.tsx`
- **Problem:** One misclick shuts down the computer. No confirmation.
- **Fix:** At minimum, add a confirmation dialog. Ideally, replace with a power menu (see ROADMAP.md).

---

### P2.9 — `useMarkup` heuristic is naive
- **File:** `src/widget/common/notification.tsx`
- **Problem:** `useMarkup={notif.body.startsWith('<')}` treats `<3` as markup.
- **Fix:** Use a proper markup detection regex, or always escape and only enable markup for known-good notifications.

---

### P2.10 — Notification list "Clear All" has no confirmation
- **File:** `src/widget/quicksettings/notificationList.tsx`
- **Problem:** Easy to accidentally dismiss all notifications.
- **Fix:** Add a brief undo toast, or require confirmation for "Clear All".

---

### P2.11 — Settings entries not bound reactively
- **File:** `src/widget/settings/bar.tsx`
- **Problem:** `text={bar.tempPath.get() as string ?? ""}` sets initial text only. External changes don't update the entry.
- **Fix:** Bind the text prop to the setting accessor.

---

### P2.12 — Settings network panel uses direct property access **[FIXED]**
- **File:** `src/widget/settings/network.tsx`
- **Problem:** Same AGENTS.md pitfall as other network widgets. `wifi` and `wired` are read once at construction.
- **Fix:** Use `createBinding`.

---

### P2.13 — QS screenshot button main action is confusing
- **File:** `src/widget/quicksettings/button-grid/screenshot.tsx`
- **Problem:** Main `SplitButton` click toggles screen recording. But the popover also has a "Record" button. Users may expect the main button to take a screenshot.
- **Fix:** Consider making the main button take a screenshot (most common action) and move recording to the popover only.

---

### P2.14 — QS popover buttons are no-ops when state already matches
- **File:** `src/widget/quicksettings/button-grid/touchpad.tsx` (and others)
- **Problem:** "Touchpad On" only calls `toggle()` if already off. Clicking it when on does nothing, which feels broken.
- **Fix:** Buttons in popovers should explicitly set state, not conditionally toggle.

---

### P2.15 — `latest` tags in `eslint.config.js` dependencies
- **File:** `eslint.config.js`
- **Problem:** `typescript-eslint` v8 config differs from v7. Using `latest` risks breakage.
- **Fix:** Pin versions.

---

### P2.16 — `dev` script uses `;` (continues on failure) **[FIXED]**
- **File:** `package.json`
- **Problem:** `cp ... ; pnpm run build ; ...` continues even if copy or build fails.
- **Fix:** Use `&&` instead of `;`.

---

### P2.17 — `data/` ships duplicate GWeather/Notifd schemas
- **Files:** `data/io.astal.notifd.gschema.xml`, `data/org.gnome.GWeather4.*`
- **Problem:** These are normally provided by system packages. Shipping duplicates risks version mismatch.
- **Fix:** Remove from repo if system dependencies are guaranteed, or document why they're vendored.

---

### P2.18 — Missing `meta` in Nix derivation **[FIXED]**
- **File:** `nix/desktop-shell.nix`
- **Problem:** No `description`, `license`, `homepage`, `maintainers`, `platforms`.
- **Fix:** Add standard `meta` fields.

---

### P2.19 — No `package` option in NixOS module **[FIXED]**
- **File:** `nix/module.nix`
- **Problem:** Users cannot override the shade-shell package.
- **Fix:** Add `programs.shade.package` option.

---

### P2.20 — NixOS module forces Hyprland import unconditionally
- **File:** `nix/module.nix`
- **Problem:** `imports = [ inputs.hyprland.nixosModules.default ]` means enabling Shade always pulls in Hyprland module, even if user manages Hyprland separately.
- **Fix:** Make Hyprland module import optional or document that users should use Shade's module only if they don't already use Hyprland's.

---

### P2.21 — Deeply personal config in distributed module **[FIXED]**
- **File:** `nix/hyprland/default.nix`
- **Problem:** `kb_layout = "br,us"`, `natural_scroll = true`, Catppuccin colors, hardcoded terminal in scratchpad. A NixOS module for other users shouldn't impose keyboard layouts and color themes.
- **Fix:** Make these options with sensible defaults (e.g., `us` layout, no theme enforcement).

---

### P2.22 — `hyprshot`, `playerctl`, `pwvucontrol`, `wvkbd` not in dependencies **[FIXED]**
- **Files:** `nix/hyprland/binds.nix`
- **Problem:** These are referenced in keybinds but not declared in `wrapperPackages` or `environment.systemPackages`.
- **Fix:** Add to wrapper packages or module config.

---

### P2.23 — `layerrule` syntax may be incorrect **[FIXED]**
- **File:** `nix/module.nix`
- **Problem:** `layerrule= blur on, match:namespace gtk4-layer-shell` — `match:` prefix and spacing may not be valid Hyprland syntax.
- **Fix:** Verify against current Hyprland docs. Likely should be `layerrule = blur, gtk4-layer-shell`.

---

### P2.24 — CSS `oklab()` requires GTK 4.16+
- **File:** `src/shade.css`
- **Problem:** `oklab(from ...)` may fail on older GTK 4 versions.
- **Fix:** Add a fallback solid color, or verify minimum GTK version in flake.

---

## P3 — Improvements / Optimizations

### P3.1 — Settings window instantiated eagerly
- **File:** `src/widget/index.tsx`
- **Problem:** `settings()` (full Adw preferences window) is created on shell startup even though most users rarely open it.
- **Fix:** Lazy-load — create only when first requested.

---

### P3.2 — `auto-cpufreq` polling every 5s
- **File:** `src/lib/autoCpufreq.ts`
- **Problem:** Subprocess polling is wasteful. No D-Bus API available.
- **Fix:** Increase interval to 30s, or watch config files for changes.

---

### P3.3 — `Gdk2HyprMonitor` mapping by model name is fragile
- **File:** `src/lib/monitors.ts`
- **Problem:** Identical monitors will always map to the first match.
- **Fix:** Use monitor serial, connector name, or Hyprland's own monitor ID mapping.

---

### P3.4 — No `SIGINT`/`SIGTERM` handlers
- **File:** `src/main.ts`
- **Problem:** Graceful shutdown on signals is not handled. Recordings, lock files, etc. may be orphaned.
- **Fix:** Register `GLib.unix_signal_add` for cleanup.

---

### P3.5 — App launcher no visual feedback on click
- **File:** `src/widget/applauncher/appButton.tsx`
- **Problem:** `GLib.spawn_command_line_async` return value is ignored. Launch failures are silent.
- **Fix:** Check return value and show a brief error toast.

---

### P3.6 — No formatter output in flake
- **File:** `flake.nix`
- **Problem:** No `formatter.${system}` exposed.
- **Fix:** Add `formatter.x86_64-linux = pkgs.nixfmt-rfc-style;`.

---

## Quick Reference — Top 10 Fixes by Impact/Effort

| Rank | Issue | File(s) | Effort | Impact |
|------|-------|---------|--------|--------|
| 1 | **Uncomment media player** | `expander/index.tsx` | Trivial | High |
| 2 | **Fix OSD monitor bug** | `osd/index.tsx` | Trivial | High |
| 3 | **Fix `m.id && 1` typo** | `osd/index.tsx` | Trivial | High |
| 4 | **Fix disk usage formula** | `bar/systemUsage.tsx` | Trivial | High |
| 5 | **Fix app launcher empty search crash** | `applauncher/index.tsx` | Trivial | High |
| 6 | **Fix media icon typo** | `expander/media.tsx` | Trivial | Medium |
| 7 | **Fix `colorSchemeName` bug** | `lib/colorScheme.ts` | Trivial | Medium |
| 8 | **Fix keyboard brightness `%`** | `lib/brightness.ts` | Trivial | Medium |
| 9 | **Fix wallpaper install path** | `meson.build` | Low | High |
| 10 | **Fix `dev` script schema compilation** | `package.json` | Low | High |

---

## Summary Counts

| Severity | Count |
|----------|-------|
| P0 — Crash/Data Loss | 15 |
| P1 — Bug/Leak | 22 |
| P2 — Polish/Debt | 24 |
| P3 — Improvement | 6 |
| **Total** | **67** |
