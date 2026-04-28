# Shade - Agent's Guide

> **Shade** is a personal desktop shell for Hyprland on Linux, written in TypeScript and rendered with GTK 4 / Libadwaita via GJS. It provides a complete custom desktop environment including a status bar, application launcher, quick settings panel, on-screen display, lock screen, notification popups, and wallpaper support.

---

## Project Overview

- **Name**: `shade-shell`
- **Domain**: `com.caioasmuniz.shade_shell`
- **Version**: `0.1.0`
- **Description**: "Skill's Hyprland Adwaita Desktop Environment"
- **Runtime**: GJS (GNOME JavaScript / SpiderMonkey)
- **Compositor**: Hyprland
- **UI Toolkit**: GTK 4 + Libadwaita
- **Windowing**: `gtk4-layer-shell` + Astal (AyLur's toolkit)
- **Reactive UI Framework**: Gnim — a React-like framework for GTK/GJS with JSX, signals, and state management
- **Build System**: Meson (orchestration) + esbuild (TypeScript bundling)
- **Package Manager**: pnpm
- **Environment**: Nix Flake

The shell is designed to be launched once per session via `uwsm-app -t service -- shade-shell`. Remote invocations (e.g., `shade-shell toggle bar`) communicate with the running instance through `Gio.Application` command-line handling.

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

# Full build: wipes Meson build dir, bundles, compiles schemas, installs to ./dist
pnpm run build

# Development build + run with local schema directory
pnpm run dev
```

### Manual Build Steps

```bash
# Setup and build
meson setup --prefix "$(pwd)/dist" build --wipe
meson install -C build

# Run with local schemas
GSETTINGS_SCHEMA_DIR="$(pwd)/dist/share/glib-2.0/schemas" ./dist/bin/shade-shell
```

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
- Starts the shell via `uwsm-app -t service -- shade-shell` on Hyprland launch.
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
