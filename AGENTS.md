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

# Shade — Agent's Guide

> **Shade** is a personal desktop shell for Hyprland, written in TypeScript/GJS with GTK 4 / Libadwaita via Gnim (JSX for GTK4). It runs as a systemd user service and exposes remote commands over D-Bus.

---

## Where to Find Things

| Topic | File |
|-------|------|
| GJS entry point | `src/main.ts` |
| Root `Adw.Application` + CSS init + widget mounting | `src/App.tsx` |
| Shared reactive state (`launcherOpen`, `qsOpen`, `screenlocked`) | `src/widget/index.tsx` |
| Widget mount order (critical) | `src/widget/index.tsx` → `widgets()` |
| CLI command dispatcher | `src/lib/requestHandler.ts` |
| GSettings schema definitions | `src/lib/gschema.ts` |
| Reactive settings context | `src/lib/settings.ts` |
| Bluetooth device battery indicator | `src/widget/bar/indicators/bluetoothAudio.tsx` |
| Keybinding manager (hyprctl) | `src/lib/keybinds.ts` |
| Logger utility | `src/lib/logger.ts` |
| Monitor tracking + Hyprland mapping | `src/lib/monitors.ts` |
| NixOS module & systemd service | `nix/module.nix` |
| Package derivation | `nix/desktop-shell.nix` |
| Build rules (esbuild + schemas + desktop entry) | `meson.build` |

---

## Architecture Invariants

Rules that are **never violated** without silent or catastrophic failure.

### 1. `GObject.notify()` is always kebab-case
`@setter(Boolean)` registers properties as kebab-case (e.g., `launcher-open`). `this.notify("launcherOpen")` emits the wrong signal and breaks `createBinding` subscribers silently.

```ts
// ✅ CORRECT
this.notify("launcher-open")
```

### 2. `Notifd.get_default()` must never be called synchronously
AstalNotifd D-Bus handshake blocks the main loop for **25 seconds** if another notification daemon owns the bus. Always defer via `GLib.idle_add`.

```ts
onMount(() => {
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    setNotifd(Notifd.get_default())
    return GLib.SOURCE_REMOVE
  })
})
```

### 3. `GLib.List` is not iterable in GJS
Passing a `GLib.List` to Gnim's `<For>` crashes the parent component. Convert first:

```ts
function toArray<T>(list: any): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list
  const arr: T[] = []
  let l = list
  while (l) { arr.push(l.data); l = l.next }
  return arr
}
```

### 4. `AstalNetwork.Network.wifi` is set once at construction
If the WiFi device wasn't ready when AstalNetwork initialized, `.wifi` is `null` forever. **Always** use `createBinding(network, "wifi")`, never `const wifi = network.wifi`.

### 5. `createComputed` with a single dependency can miss property updates
`AstalBluetooth.Device.battery_percentage` often arrives **after** the device connects (bluez reports battery via a separate D-Bus property). If a `createComputed` only tracks `is-connected`, it caches `null` on first evaluation and never re-evaluates — the indicator stays hidden.

Always add `createBinding(bluetooth, "devices")` as an additional dependency so the computed re-evaluates when device properties update:

```ts
// ✅ CORRECT — tracks both connection state AND device list changes
const isConnected = createBinding(bluetooth, "is-connected")
const devices = createBinding(bluetooth, "devices")

const deviceInfo = createComputed(() => {
  const _connected = isConnected()
  const list = devices()
  if (!_connected || !list) return null
  for (const d of toArray(list)) {
    if (!d.connected) continue
    if (d.battery_percentage >= 0) { /* use it */ }
  }
  return null
})
```

This applies to any GObject property where a sub-property (like battery) can update independently of the parent property (like connection state).

### 6. `<For>` cannot be nested inside `<With>`
Gnim throws `Error: nesting Fragments are not yet supported`. Use reactive `visible` bindings instead of conditional rendering, or keep `<For>` as a sibling.

### 7. Widget mount order is sequential with error isolation
Each widget is wrapped in `safe()` which catches and logs exceptions without blocking subsequent widgets. Mount order: `Wallpaper → bar → dock → osd → applauncher → quicksettings → lockscreen → windowswitcher → notifications → settings`. If a widget fails, the error is logged via `logger.error("mount", ...)` and the next widget continues. Check journald for the **first** error in the sequence.

### 8. `@signal()` prefers GObject types over JS constructors
GJS maps `Number` → `GObject.TYPE_DOUBLE`, `Boolean` → `GObject.TYPE_BOOLEAN`, `String` → `GObject.TYPE_STRING`, plus `Function`, `Array`, `Date`, `Map`, `Set` have `$gtype`. JS constructors work in practice, but for cross-version compatibility prefer explicit GObject type constants:

```ts
// ✅ CORRECT
@signal([GObject.TYPE_STRING], GObject.TYPE_NONE)
failed(_reason: string) {}
```

### 9. `AstalIO.Process.exec_async` cannot control long-running processes
It returns stdout as a string on exit — no handle, no `.kill()`. For controllable subprocesses (e.g., `wf-recorder`), use `AstalIO.Process.subprocessv()`.

### 10. Remote commands must use `gdbus`, not `shade-shell toggle`
Spawning the full GJS app takes ~1s. The lightweight `gdbus` helper (`shade-toggle.sh`) takes ~7ms.

---

## Decision Log

Why non-obvious choices were made. **Do not reverse these without discussion.**

| Decision | Rationale |
|----------|-----------|
| **Defer `Notifd.get_default()` via `GLib.idle_add`** | D-Bus proxy handshake blocks the main loop for 25s if another notification daemon is registered. |
| **Track both `is-connected` and `devices` for bluetooth battery** | `battery_percentage` arrives after connection state — a `createComputed` depending only on `is-connected` caches `null` permanently. Adding `createBinding(bluetooth, "devices")` catches late property updates. |
| **Use `gdbus` / `shade-toggle.sh` for keybindings** | Spawning `shade-shell toggle` loads the entire 1MB bundle + GI modules (~1s) just to send a D-Bus message. |
| **No network list in Settings** | Quick Settings owns all network UX (list, scan, password dialog). Settings only toggles WiFi on/off. |
| **No automated tests** | Manual testing only via NixOS VM (`nix run .#nixosConfigurations.vm...`). |
| **No semicolons** | Enforced by Prettier config in `package.json`. |
| **`@typescript-eslint/no-explicit-any` is off** | The codebase does not enforce avoiding `any`. |
| **LD_PRELOAD `libgtk4-layer-shell.so`** | Required for `gtk4-layer-shell` functionality. |

---

## Anti-Patterns

Things the agent must **not** generate or introduce.

| Anti-Pattern | Why | Do Instead |
|--------------|-----|------------|
| `this.notify("camelCase")` | Silently breaks reactive bindings | `this.notify("kebab-case")` |
| `Notifd.get_default()` in constructor / mount | Blocks main loop 25s | Defer with `GLib.idle_add` |
| `const wifi = network.wifi` | Stale `null` if device wasn't ready | `createBinding(network, "wifi")` |
| `[...glList]` or `<For each={glList}>` | `GLib.List` is not iterable | `toArray(glList)` |
| `.catch(() => {})` | Swallows errors, makes debugging impossible | `print("error:", e.message)` |
| `AstalIO.Process.exec_async` for long-running tasks | No process handle to kill | `AstalIO.Process.subprocessv()` |
| `shade-shell toggle ...` in scripts / keybindings | ~1s spawn overhead | `shade-toggle.sh` (gdbus) |
| `<For>` inside `<With>` callback | Gnim fragment nesting crash | Use `visible={...}` bindings |
| `media-record-stop-symbolic` | Missing icon in Adwaita | `media-playback-stop-symbolic` |
| Adding network list to Settings | Duplicates Quick Settings UX | Keep network UX in QS only |
| Single-dep `createComputed` for late-arriving GObject properties | Caches stale `null` if the property arrives after the tracked signal | Add `createBinding(obj, "devices")` or equivalent as a secondary dep |

---

## Build & Tooling Notes

### Commands
```bash
pnpm run lint          # May fail: TypeError: util.styleText (ESLint 10 / Node version issue)
pnpm run types         # Regenerates @girs/ types
pnpm run build         # Validates bundle + schema XML; NOT a runnable binary
pnpm run dev           # Nix build + run with proper wrappers
meson setup build --wipe && meson compile -C build  # Same as pnpm run build
nix build              # Produces runnable binary with wrappers
```

> **Critical:** `meson compile` only validates the bundle. It does **not** produce a runnable binary because `GI_TYPELIB_PATH`, `LD_PRELOAD`, and `PATH` wrappers are missing. Always use `nix build` or `nix run` for a working binary.

> `tsc --noEmit` will report many errors for missing GIR types unless `pnpm run types` has been run. The **actual** build is performed by **esbuild via Meson**, which does not type-check. TypeScript errors generally do not block the build.

### Version Bump Rule
If bumping version, sync **three** files:
1. `meson.build`
2. `package.json`
3. `nix/desktop-shell.nix`

And update `CHANGELOG.md`.

---

## Development Conventions

- **Path alias:** `#/*` maps to `./src/*`.
- **GIR imports:** `gi://Module?version=X.Y`, marked external in esbuild.
- **Gnim imports:** `gnim`, `gnim/gobject`, `gnim-schemas`.
- **GObject singletons:** Always expose `static get_default()`.
- **Default exports:** Most widgets use `export default () => ...`.
- **Logging:** Use `import logger from "#/lib/logger"` for normal logs. Use `print()` only inside `.catch()` handlers to surface errors.
- **CSS:** Global CSS in `src/shade.css`. Widget-level CSS via inline `css="..."`. Heavy use of Libadwaita built-in classes (`card`, `frame`, `background`, `linked`, `title-1`–`title-4`, `circular`, `flat`, `raised`, etc.).
- **Code style:** No semicolons. Follow surrounding quote style. 2-space indentation.

---

## Runtime Debugging

Shade runs as a systemd user service. All output goes to journald.

```bash
# Logs by executable
journalctl --user _COMM=shade-shell --boot 0 -n 200 --no-pager

# Service status
systemctl --user status shade-shell

# Broader GJS/GTK error search
journalctl --user --boot 0 -n 500 --no-pager | grep -iE "shade-shell|JS ERROR|gjs\["
```

If a widget silently fails to appear, check logs — the crash is likely in an **earlier** widget in the mount order.

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
