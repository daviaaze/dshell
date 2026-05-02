---
name: shade-shell
license: GPL-3.0-only
description: >
  Agent guide for shade-shell — a personal desktop shell for Hyprland on Linux,
  written in TypeScript and rendered with GTK 4 / Libadwaita via GJS,
  using Astal (AyLur's toolkit) and Gnim.
metadata:
  author: caioasmuniz
  version: "0.2.1"
  repository: https://github.com/caioasmuniz/shade
  runtime: GJS (GNOME JavaScript / SpiderMonkey)
  compositor: Hyprland
  ui_toolkit: GTK 4 + Libadwaita
  reactive_framework: Gnim
  build_system: Meson + esbuild
  package_manager: pnpm
  environment: Nix Flake
---

# Shade - Agent's Guide

> **Shade** is a personal desktop shell for Hyprland on Linux, written in TypeScript and rendered with GTK 4 / Libadwaita via GJS. It provides a complete custom desktop environment including a status bar, application launcher, quick settings panel, on-screen display, lock screen, notification popups, and wallpaper support.

---

## Project Overview

### Systemd User Service

Shade runs as a **systemd user service** with automatic restart on crash:

```nix
# NixOS module (nix/module.nix)
systemd.user.services.shade-shell = {
  after = [ "graphical-session.target" ];
  partOf = [ "graphical-session.target" ];
  wantedBy = [ "graphical-session.target" ];
  serviceConfig = {
    ExecStart = "${cfg.package}/bin/shade-shell";
    Restart = "on-failure";
    RestartSec = "3";
    Type = "exec";
  };
};
```

This replaces the old `uwsm-app -t service -- shade-shell` approach. Benefits:
- **Auto-restart**: Shell comes back within 3s if it crashes
- **No overhead**: No `uwsm-app` wrapper (~50ms saved per boot)
- **Proper lifecycle**: Starts with the graphical session, stops when it ends
- **Logging**: All stdout/stderr go to journald automatically
- **Resource accounting**: Use `systemctl --user status shade-shell` to see memory/CPU

For non-NixOS users, the service file is installed to `${datadir}/systemd/user/shade-shell.service` and can be enabled with:
```bash
systemctl --user enable --now shade-shell
```

---

- **Name**: `shade-shell`
- **Domain**: `com.caioasmuniz.shade_shell`
- **Version**: `0.2.1`
- **Description**: "Skill's Hyprland Adwaita Desktop Environment"
- **Runtime**: GJS (GNOME JavaScript / SpiderMonkey)
- **Compositor**: Hyprland
- **UI Toolkit**: GTK 4 + Libadwaita
- **Windowing**: `gtk4-layer-shell` + Astal (AyLur's toolkit)
- **Reactive UI Framework**: Gnim — a React-like framework for GTK/GJS with JSX, signals, and state management
- **Build System**: Meson (orchestration) + esbuild (TypeScript bundling)
- **Package Manager**: pnpm
- **Environment**: Nix Flake

The shell runs as a **systemd user service**, started when the graphical session begins and automatically restarted on crash. Remote invocations (e.g., `shade-shell toggle bar`) communicate with the running instance through `Gio.Application` command-line handling.

### Major Components

| Component | Description |
|-----------|-------------|
| **Bar** | Status bar per monitor with workspaces, system usage, clock, weather, and system indicators. Supports top/left/right/bottom positioning. |
| **App Launcher** | Fuzzy-searchable application grid anchored to the bar. |
| **Quick Settings** | Control center with toggles (Bluetooth, Caffeinated, Color Scheme, Power Profiles), audio/mic/brightness sliders, system tray, expanders (battery, calendar, media, weather), and grouped notifications. |
| **Notification Popups** | Transient floating toasts (top-right) with auto-dismiss. |
| **OSD** | On-screen display popups for volume and brightness changes. |
| **Lock Screen** | `Gtk4SessionLock` + PAM (`astal-auth`) based lock screen across all monitors. |
| **Wallpaper** | Per-monitor background window with automatic day/night switching based on the color scheme. |
| **Settings** | Built-in Libadwaita preferences window (General, Bar, Weather). |

---

## Versioning and Releases

Shade follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`). The version is declared in three places that **must always be kept in sync**:

1. `meson.build` — `project('shade-shell', version: 'X.Y.Z')`
2. `package.json` — `"version": "X.Y.Z"`
3. `nix/desktop-shell.nix` — `version = "X.Y.Z";`

Additionally, `AGENTS.md` lists the current version in the Project Overview section.

### Changelog

All notable changes are recorded in `CHANGELOG.md` using the [Keep a Changelog](https://keepachangelog.com/) format.

**Workflow rule:** Every change that affects user-visible behavior, fixes a bug, or adds a feature must:
1. Update `CHANGELOG.md` under `[Unreleased]` (or the new version section if bumping)
2. If the change is a feature addition or breaking change, bump the version in all three files above
3. Commit the version + changelog changes together

**When to bump:**
- `PATCH` — bug fixes, minor corrections
- `MINOR` — new features, enhancements (e.g. new recording modes, new widgets)
- `MAJOR` — breaking changes to config, CLI, or behavior

### Example commit message

```
bump: 0.2.0

feat(recording): add area, window, and output recording modes

CHANGELOG.md updated.
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript |
| Runtime | GJS |
| UI Framework | Gnim (JSX for GTK4) |
| GObject Registration | `gnim/gobject` (`@register`, `@getter`, `@setter`) |
| GTK Bindings | `gi://Gtk?version=4.0`, `gi://Gdk?version=4.0`, `gi://Adw`, `gi://Gio`, `gi://GLib`, etc. |
| Astal Bindings | `gi://Astal?version=4.0`, AstalHyprland, AstalWp, AstalBattery, AstalNotifd, AstalBluetooth, AstalMpris, AstalTray, AstalAuth, AstalIO |
| Weather | `gi://GWeather` |
| System Monitoring | `libgtop` (`gi://GTop`) |
| Image Loading | `Gly` / `GlyGtk4` (via `libglycin-gtk4`) |
| Session Lock | `Gtk4SessionLock` |
| Schema Generation | `gnim-schemas` |
| Bundler | esbuild |
| Build Orchestration | Meson + Ninja |
| Packaging | Nix Flake |

---

## Build and Development Commands

All commands are run from the project root.

### Prerequisites

You need a Nix environment with the dev shell, or manually install:
- `gjs`, `esbuild`, `meson`, `ninja`, `pkg-config`, `desktop-file-utils`, `libxml2`
- GTK 4, Libadwaita, `gtk4-layer-shell`, GObject Introspection
- All Astal libraries (apps, auth, battery, bluetooth, hyprland, mpris, network, notifd, powerprofiles, tray, wireplumber, astal4)
- `libgtop`, `libgweather`, `libglycin-gtk4`, `glycin-loaders`
- `pnpm`, `node`
- Runtime tools: `brightnessctl`, `bash`

### Available Scripts (`package.json`)

```bash
# Lint and auto-fix TypeScript
pnpm run lint

# Regenerate GIR TypeScript types into @girs/
pnpm run types

# Validate build: compiles TypeScript bundle and generates gschema XML
# Does NOT produce a runnable binary — use nix build for that
pnpm run build

# Development: build via Nix and run with proper wrappers
pnpm run dev
```

### Manual Build Steps

```bash
# Setup and compile (validates bundle + schema generation)
meson setup build --wipe
meson compile -C build
```

> **Note:** `meson compile` only validates that the bundle compiles. It does **not**
> produce a runnable binary. The bundle requires `GI_TYPELIB_PATH`, `LD_PRELOAD`,
> and `PATH` wrappers that only `nix build` provides. Use `nix build` or `nix run`
> for a working binary.

### Nix Dev Shell

```bash
nix develop
```

This provides all build inputs, native inputs, wrapper packages, plus `libnotify`, `pnpm`, `nixd`, `nixfmt-rfc-style`, `nix-output-monitor`, `d-spy`. It also sets `LD_PRELOAD` to `libgtk4-layer-shell.so`.

### Nix Build

```bash
nix build
```

### NixOS VM for Testing

```bash
nix run .#nixosConfigurations.vm.config.system.build.vm
```

The VM uses `greetd` + `regreet` to launch Hyprland with Shade automatically enabled.

---

## Code Organization

```
src/
├── main.ts                 # GJS entry point: gettext setup, app.runAsync()
├── App.tsx                 # ShadeShell Adw.Application subclass, CSS init, widget mounting
├── env.d.ts                # Global types: ImportMeta extensions, *.css module declarations
├── shade.css               # Minimal global CSS (background transparency, card padding)
├── lib/                    # Core utilities and reactive GObject singletons
│   ├── brightness.ts       # Screen + keyboard brightness via brightnessctl
│   ├── colorScheme.ts      # Light/dark/auto theme with sunrise/sunset logic
│   ├── gschema.ts          # GSettings schema definitions for gnim-schemas
│   ├── inhibit.ts          # Idle inhibit (caffeinated) singleton
│   ├── keybinds.ts         # Keybinding manager (registers with Hyprland via hyprctl)
│   ├── logger.ts           # Shared logging utility with timestamps
│   ├── monitors.ts         # Reactive Gdk monitor tracking + Hyprland mapping
│   ├── requestHandler.ts   # CLI remote command handler (toggle, lockscreen)
│   ├── settings.ts         # GSettings provider + gnim context for reactive settings
│   └── weather.ts          # GWeather.Info singleton
└── widget/                 # All UI widgets
    ├── index.tsx           # Shared reactive states + widgets() mount function
    ├── applauncher/        # App launcher window + app button
    ├── bar/                # Status bar and its sub-widgets
    ├── common/             # Reusable components (Slider, AudioEndpointControl, Notification)
    ├── lockscreen/         # PAM-based multi-monitor lock screen
    ├── notifications/      # Notification popup window
    ├── osd/                # Volume/brightness OSD (popup + slider)
    ├── quicksettings/      # Quick settings panel with many sub-widgets
    ├── settings/           # Libadwaita preferences window
    └── wallpaper/          # Per-monitor wallpaper window
```

### Entry Points

- **`src/main.ts`**: GJS script with shebang. Binds gettext, calls `app.runAsync()`, exits with return code.
- **`src/App.tsx`**: Defines `ShadeShell` (extends `Adw.Application`).
  - `vfunc_command_line`: if remote, delegates to `requestHandler()`; if first instance, calls `createRoot()`, initializes CSS, and mounts widgets inside `SettingsProvider`.

### Module Conventions

- **`#/*` path alias** maps to `./src/*` (configured in `tsconfig.json`).
- **External GIR modules** are imported as `gi://Module?version=X.Y` and marked external in esbuild.
- **Gnim imports**: `gnim` (core), `gnim/gobject` (decorators), `gnim-schemas` (settings).
- **GJS runtime**: `gettext`, `system`.
- Most widgets use **default exports** (`export default () => ...`).
- Shared reactive states (`launcherOpen`, `qsOpen`, `screenlocked`) live in `src/widget/index.tsx`.
- GObject singletons always expose `static get_default()`.

---

## Development Conventions

### TypeScript Configuration

- `target`: `ES2020`
- `module`: `ES2022`
- `moduleResolution`: `Bundler`
- `jsx`: `react-jsx`
- `jsxImportSource`: `gnim/gtk4`
- `strict`: `true`
- `skipLibCheck`: `true`

### ESLint (`eslint.config.js`)

- Extends `@eslint/js` recommended + `typescript-eslint` recommended.
- **`@typescript-eslint/no-explicit-any` is turned off.** The codebase does not enforce avoiding `any`.

### Code Style

- **No semicolons** (`"prettier": { "semi": false }` in `package.json`).
- Uses single quotes for strings in some places, double quotes in others — follow the surrounding code.
- Indentation appears to be 2 spaces.

### GObject Patterns

Classes in `src/lib/` use the `@register()` decorator from `gnim/gobject` and follow the singleton pattern:

```ts
import { register, Object } from "gnim/gobject"

@register()
class MyService extends Object {
  static get_default() { ... }
}
```

Properties use `@getter(Type)` and `@setter(Type)` decorators for GObject integration.

### CSS / Styling

- **Global CSS**: `src/shade.css` is loaded once in `App.tsx` via `Gtk.CssProvider`. Defines `.background` (semi-transparent) and `.card` (padding).
- **Widget-level CSS**: Many components use inline `css="..."` props on GTK widgets.
- **Libadwaita classes**: Heavy use of built-in Adwaita classes like `card`, `frame`, `background`, `linked`, `title-1` through `title-4`, `heading`, `body`, `caption`, `circular`, `flat`, `raised`, `success`, `suggested-action`, `warning`, `destructive-action`, `toolbar`, `compact`, etc.
- The visual style is **transparent / glassmorphic** (Adwaita-derived with alpha transparency).

---

## Known Pitfalls and Lessons Learned

### `GObject.notify()` Property Name Must Be Kebab-Case
When using `@setter(Boolean)` from `gnim/gobject`, the property is registered with a **kebab-cased** name (e.g., `launcher-open` for the JS name `launcherOpen`). Calling `this.notify("launcherOpen")` (camelCase) **does not emit `notify::launcher-open`** — GObject requires the kebab-cased property name. The signal never fires, so `createBinding` subscribers never update.

**Always use kebab-case in `notify()`:**
```ts
// ❌ WRONG — signal never fires
set launcherOpen(v: boolean) {
  this.#launcherOpen = v
  this.notify("launcherOpen")    // emits notify::launcherOpen
}

// ✅ CORRECT
set launcherOpen(v: boolean) {
  this.#launcherOpen = v
  this.notify("launcher-open")   // emits notify::launcher-open
}
```

Remember: `createBinding(obj, "launcherOpen")` internally calls `kebabify("launcherOpen")` → `"launcher-open"`, and subscribes to `notify::launcher-open`.

### AstalNotifd: `get_default()` Blocks the Main Loop for 25 Seconds
`Notifd.get_default()` performs a D-Bus proxy handshake. If another notification daemon (dunst, mako, etc.) is already registered on the session bus at `/org/freedesktop/Notifications`, the D-Bus call **blocks for 25 seconds** before timing out. During this time, the GJS main loop is entirely blocked — no idle callbacks, timeouts, or widget updates can fire.

**Never call `Notifd.get_default()` directly in a constructor or during widget mounting.** Always defer it via `GLib.idle_add`:

```ts
// ❌ WRONG — blocks for 25s on startup
const notifd = Notifd.get_default()

// ✅ CORRECT — deferred to idle callback
globalThis.__notifdReady = false
const [notifd, setNotifd] = createState<Notifd.Notifd | null>(null)
onMount(() => {
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    setNotifd(Notifd.get_default())
    return GLib.SOURCE_REMOVE
  })
})
```

This applies to **any** code path that calls `Notifd.get_default()` — including indirect callers like `NotificationHistory`'s constructor.

### D-Bus Remote Commands: Don't Spawn the Full Application
Running `shade-shell toggle applauncher` from the command line spawns a new GJS process that loads the entire bundled application (1001KB JS, all GI modules), does GTK initialization, and then sends a D-Bus message to the running instance. This takes **~1 second per invocation**. The actual command handling after the D-Bus message arrives is ~30ms.

**For keybindings, use a lightweight D-Bus tool instead of spawning the application:**

```bash
# Recommended: use gdbus (a ~7ms C binary)
gdbus call --session \
  --dest com.caioasmuniz.shade_shell \
  --object-path /com/caioasmuniz/shade_shell \
  --method org.gtk.Application.CommandLine \
  /com/caioasmuniz/shade_shell \
  "[b'shade-shell', b'toggle', b'applauncher']" \
  "{}"
```

The helper script at `data/scripts/shade-toggle.sh` wraps this. It's installed to `$out/bin/shade-toggle.sh`.

### `gnim/gobject` `@signal()` Decorator: Use GObject Types, Not JS Constructors
The `@signal()` decorator from `gnim/gobject` expects **GObject type constants** (like `GObject.TYPE_STRING`) as param types, not JavaScript constructors like `String` or `Number`:

```ts
// ❌ WRONG — String doesn't have $gtype, signal registration fails
@signal(String)
failed(_reason: string) {}

// ✅ CORRECT — uses proper GObject type
@signal([GObject.TYPE_STRING], GObject.TYPE_NONE)
failed(_reason: string) {}
```

Only `Function`, `Array`, `Date`, `Map`, and `Set` have `$gtype` defined by default in `gnim/gobject`. All other JS constructors will cause silent signal registration failure (resulting in "No signal 'X' on object 'Y'" errors at runtime).

### NotificationHistory Constructor Triggers 25s Notifd Block
The `NotificationHistory` singleton in `src/lib/notificationHistory.ts` used to call `Notifd.get_default()` directly in its constructor. Since `NotificationHistory.get_default()` is called during `NotificationList` rendering (a sub-component of Quick Settings), this blocked the entire widget mounting sequence for 25 seconds.

**Always defer D-Bus-heavy initializations in singletons to `GLib.idle_add`.**

### Shared Logger Utility
All logging should use the shared `logger` utility instead of raw `print()`:

```ts
import logger from "#/lib/logger"

logger.log("message")    // prints: [Shade] HH:MM:SS.ffffff - message
logger.warn("warning")   // same format, via console.warn
logger.error("error")    // same format, via console.error
```

Every log is automatically prefixed with `[Shade]` and a microsecond-precision timestamp, making it easy to correlate events across different components in journalctl output.

### AstalNetwork `wifi` Property Is Set Once at Construction
`AstalNetwork.Network.get_default().wifi` is initialized inside the GObject `construct` block and **never updated** afterward. If the WiFi device wasn't available when AstalNetwork first initialized (e.g., NetworkManager still starting, rfkill soft block, or resume from sleep), `wifi` will be `null` forever.

**Always use `createBinding(network, "wifi")` instead of `const wifi = network.wifi`.** The status bar (`systemIndicators.tsx`) already does this correctly; the Quick Settings network widget historically did not.

### `GLib.List` Is Not Iterable in GJS
AstalNetwork's `wifi.accessPoints` returns `GLib.List<AccessPoint>`, but Gnim's `For` component spreads its input with `[...iterable]`. `GLib.List` does **not** implement the JS iterator protocol in GJS, so `For` will throw a TypeError and crash the entire parent component.

**Convert to a JS array before passing to `For`:**
```ts
function toArray<T>(list: any): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list
  const arr: T[] = []
  let l = list
  while (l) {
    arr.push(l.data)
    l = l.next
  }
  return arr
}

// Usage
const aps = createBinding(wifi, "accessPoints")
  .as(points => toArray<Network.AccessPoint>(points))

<For each={aps}>...</For>
```

The project already follows this pattern in `src/lib/monitors.ts` for `Gio.ListStore` (using `Array.from()`). Apply the same conversion for any GObject property returning `GLib.List`, `Gio.ListModel`, etc.

### Avoid Silent `.catch(() => {})`
The network widget (and other Astal interaction code) historically swallowed all errors with empty catch handlers. This makes debugging impossible when NetworkManager rejects a connection or PAM authentication fails.

**Use `print()` to log errors:**
```ts
ap.activate()
  .then(() => setConnectingAp(null))
  .catch((e: Error) => {
    print("activate failed:", e.message)
    setConnectingAp(null)
  })
```

GJS provides the global `print()` function. It is already used in `bluetooth.tsx` and other files.

### Build Tooling Quirks
- **`pnpm run lint`** may fail with `TypeError: util.styleText is not a function` depending on the Node.js version in the environment. This is an ESLint 10 compatibility issue, not a code issue.
- **`tsc --noEmit`** will report many errors for missing GIR types (e.g., `gi://AstalNetwork`, `gi://Gtk`). These are expected unless `pnpm run types` has been run to regenerate `@girs/`.
- The **actual build** is performed by **esbuild via Meson**, which does not type-check. TypeScript errors in source files generally do not block the build.

### Quick Settings vs. Settings WiFi UX
- **Quick Settings** (`widget/quicksettings/button-grid/network.tsx`) is the only place with a network list, scan button, and password dialog. The main `Adw.SplitButton` click toggles WiFi on/off or disconnects; the **dropdown arrow** reveals the network list.
- **Settings** (`widget/settings/network.tsx`) only shows a WiFi on/off toggle, signal strength, and a scan button. It has **no network list or connection management UI**.

### Password Dialog Logic for Saved Connections
The network widget only shows a password prompt when `ap.requires_password && ap.get_connections().length === 0`. This means:
- **New networks**: password dialog shows correctly.
- **Saved networks with outdated/wrong passwords**: the widget tries to activate the saved connection without prompting for a new password, and fails silently.

Consider prompting for a password on activation failure, or always allowing password override for networks requiring auth.

### AstalIO.Process `exec_async` vs `subprocess`
`AstalIO.Process.exec_async` and `exec_asyncv` execute a command and return its **stdout as a string** when the process exits. They do **not** return a process handle — you cannot kill or signal the spawned process afterward.

For long-running processes that need to be controlled (e.g., `wf-recorder`), use `AstalIO.Process.subprocess()` or `subprocessv()` instead. These return a live `AstalIO.Process` instance with:
- `.kill()` — force quit (SIGKILL)
- `.signal(n)` — send arbitrary signal (e.g., `.signal(2)` for SIGINT)
- `.connect("exit", (code, terminated) => ...)` — fired when the process terminates

**Example pattern for a controllable subprocess:**
```ts
const proc = AstalIO.Process.subprocessv(["wf-recorder", "-f", filename])
proc.connect("exit", () => {
  this.recording = false
})
// Later:
proc.signal(2) // graceful stop with SIGINT
```

The Vala VAPI files in the Nix store (e.g., `/nix/store/...-astal-0.1.0-dev/share/vala/vapi/astal-io-0.1.vapi`) are the authoritative source for Astal API shape when types are missing or unclear.

### Adwaita Icon Name Pitfalls
Not all logically-named icons exist in `adwaita-icon-theme`. Always verify icon names against the actual theme before using them.

**Known missing / incorrect names:**
| Incorrect | Correct |
|-----------|---------|
| `media-record-stop-symbolic` | `media-playback-stop-symbolic` |

When an icon appears broken or missing at runtime, check the theme first with `gtk4-icon-browser` (if available) or search the installed icon directories under `/run/current-system/sw/share/icons` or the Nix store.

### Getting Runtime Logs
Shade-shell runs as a systemd user service. All stdout/stderr go to journald.

**Query logs by executable name:**
```bash
journalctl --user _COMM=shade-shell --boot 0 -n 200 --no-pager
```

**Check service status:**
```bash
systemctl --user status shade-shell
```

**Query logs by PID (find it with `ps aux | grep shade`):**
```bash
journalctl --user _PID=4841 --boot 0 -n 200 --no-pager
```

**Broad search for GJS / GTK / Shade errors:**
```bash
journalctl --user --boot 0 -n 500 --no-pager | grep -iE "shade-shell|JS ERROR|gjs\["
```

Always check logs when a widget silently fails to appear — the error may be in an unrelated widget that mounts earlier.

### Gnim: `<For>` Cannot Be Nested Inside `<With>`
Gnim throws **`Error: nesting Fragments are not yet supported`** when a `<For>` component is placed inside a `<With>` component's callback:

```tsx
// ❌ CRASHES
<With value={list.as(l => l.length === 0)}>
  {empty => empty ? <Gtk.Label ... />
    : <For each={list}>...</For>   // ← nested For inside With
  }
</With>
```

**Workaround:** Use a reactive `visible` binding instead of conditional rendering, or keep `<For>` as a sibling:

```tsx
// ✅ Safe — For is a sibling, not nested inside With
<Gtk.Label visible={list.as(l => l.length === 0)} label="No apps found" />
<For each={list}>{app => <AppButton application={app} />}</For>
```

### Widget Mount Order Matters
`src/widget/index.tsx` mounts components sequentially inside `widgets()`:

```tsx
 Wallpaper()
 bar()
 osd()
 applauncher()     // ← exception here
 notifications()   // never reached
 quicksettings()   // never reached
 LockScreen()      // never reached
 settings()        // never reached
```

An unhandled exception during JSX rendering in an early widget (e.g., `applauncher`) **prevents all subsequent widgets from mounting**, even though they are unrelated. If the bar and OSD work but later widgets are missing, the root cause is almost certainly a crash in the first failing widget. Fix the crash there, not in the missing widgets.

---

## Testing

**There are no automated tests.** No test framework is installed or configured. There are no test files, spec files, or test scripts. Testing is done manually via the NixOS VM or by running the shell directly in a Hyprland session.

---

## Deployment and Packaging

### NixOS Module

The project exposes a NixOS module at `nixosModules.default`:

```nix
programs.shade.enable = true;
```

Enabling this:
- Installs the `shade-shell` package and `adwaita-icon-theme`.
- Configures PAM for `astal-auth`.
- Starts the shell as a systemd user service on graphical session start.
- Optionally enables Hyprland layer blur rules for `gtk4-layer-shell`.

### Nix Derivation

- `nix/desktop-shell.nix`: Builds the project using `pnpm.fetchDeps` for offline dependency fetching.
- The binary is wrapped with:
  - `XDG_DATA_DIRS` pointing to `glycin-loaders`
  - `PATH` including `brightnessctl` and `bash`
  - `LD_PRELOAD` of `libgtk4-layer-shell.so`

### GSettings Schemas

- Schemas are defined in `src/lib/gschema.ts` using `gnim-schemas`.
- At build time, Meson generates a `.gschema.xml`, installs it, and runs `glib_compile_schemas`.
- Three schema domains exist: `bar`, `weather`, `general`.

### Desktop Entry

A `.desktop` file is generated from `data/desktop.in.desktop` for opening Shade Settings (`shade-shell toggle settings`).

---

## Key Architectural Patterns

### Reactive State

- Gnim provides `createState`, `createBinding`, `createComputed`, `For`, `With`, `onMount`, `onCleanup`.
- Cross-widget shared state lives in `src/widget/index.tsx` (e.g., `launcherOpen`, `qsOpen`, `screenlocked`).
- Settings are reactive via `gnim-schemas`'s `createSettings()` and accessed through the `SettingsProvider` context.

### Layer Shell Windows

All UI components are `Astal.Window` instances with various `Astal.Layer` values:
- `BACKGROUND` for wallpaper
- `TOP` / `OVERLAY` for bar, OSD, notifications, quick settings, app launcher, lock screen

### Monitor Awareness

- `src/lib/monitors.ts` tracks `Gdk.Display` monitors and maps them to Hyprland monitors via model name.
- Bar, wallpaper, and lock screen are instantiated per-monitor.

### CLI / Remote Control

Remote invocations use `Gio.ApplicationFlags.HANDLES_COMMAND_LINE`:
- `shade-shell lockscreen` — runs `hyprlock`
- `shade-shell toggle bar` — toggles bar visibility
- `shade-shell toggle applauncher` — toggles app launcher
- `shade-shell toggle quicksettings` — toggles quick settings

---

## Security Considerations

- **PAM Authentication**: The lock screen uses `AstalAuth` (PAM). The NixOS module creates a `security.pam.services.astal-auth` entry. Ensure PAM is configured correctly for your system.
- **LD_PRELOAD**: The binary is wrapped with `LD_PRELOAD` pointing to `libgtk4-layer-shell.so`. This is required for layer-shell functionality but is a form of library injection.
- **No Sandboxing**: The shell runs with full user privileges and can execute arbitrary commands (e.g., `uwsm-app`, `brightnessctl`, `hyprlock`).
- **No Secrets Management**: No API keys or credentials are stored in the codebase. Weather data uses public MET Norway provider with user-configured lat/long.

---

## Useful Files for Reference

| File | Purpose |
|------|---------|
| `flake.nix` | Flake inputs, package, NixOS module, dev shell, VM config |
| `nix/desktop-shell.nix` | Nix derivation for the package |
| `nix/module.nix` | NixOS module definition |
| `nix/devshell.nix` | Development shell |
| `nix/vm.nix` | VM configuration for testing |
| `nix/hyprland/default.nix` | Default Hyprland config for the module |
| `nix/hyprland/binds.nix` | Default keybindings |
| `meson.build` | Build rules: esbuild bundling, schema generation, desktop entry, data install |
| `package.json` | pnpm scripts and dependencies |
| `tsconfig.json` | TypeScript compiler options |
| `eslint.config.js` | Linting rules |
| `src/lib/gschema.ts` | GSettings schema definitions |
| `src/lib/settings.ts` | Reactive settings context |
| `src/lib/requestHandler.ts` | CLI command dispatcher |
| `src/widget/index.tsx` | Shared state and widget mount function |
| `src/App.tsx` | Root application class |
| `src/main.ts` | Entry point |
