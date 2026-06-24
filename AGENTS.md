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

## Quick Reference

### Where to Find Things

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
| Keyboard layout indicator | `src/lib/keyboard.ts` |
| Logger utility | `src/lib/logger.ts` |
| Monitor tracking + Hyprland mapping | `src/lib/monitors.ts` |
| NixOS module & systemd service | `nix/module.nix` |
| Package derivation | `nix/desktop-shell.nix` |
| Development shell | `nix/devshell.nix` |
| VM configuration for testing | `nix/vm.nix` |
| Default Hyprland config | `nix/hyprland/default.nix` |
| Default keybindings | `nix/hyprland/binds.nix` |
| Build rules (esbuild + schemas + desktop entry) | `meson.build` |
| Flake inputs, package, NixOS module, dev shell, VM config | `flake.nix` |
| pnpm scripts and dependencies | `package.json` |
| TypeScript compiler options | `tsconfig.json` |
| Linting rules | `eslint.config.js` |
| Doc health check script | `scripts/doc-check.sh` |
| Full e2e test (7 phases) | `scripts/agent-full-test.py` |
| Quick smoke test | `scripts/agent-smoke-test.py` |
| Recording mode test | `scripts/agent-record-test.py` |
| VNC MCP server | `scripts/vnc-mcp-server.py` |
| Test harness library | `scripts/shadetest/` |
| VM test runner | `scripts/run-vm-test.sh` |
| Golden image capture | `scripts/capture-golden.sh` |
| UI Previewer entry point | `src/previewer.tsx` |
| Component registry (add your widgets here!) | `src/previewer/registry.tsx` |
| Preview window UI | `src/previewer/PreviewWindow.tsx` |
| Props editor controls (string, boolean, number, select, icon) | `src/previewer/PreviewWindow.tsx` → `buildPropsPanel()` |
| Icon picker popover (115 Adwaita icons) | `src/previewer/PreviewWindow.tsx` → `buildIconPopup()` |
| Error boundary | `src/previewer/PreviewWindow.tsx` → `createEffect()` |
| Component presets | `src/previewer/registry.tsx` → `ComponentEntry.presets` |
| Build + watch + run tool | `tools/preview.mjs` |
| Centralized icon name constants + `IconName` type | `src/lib/iconNames.ts` |
| Icon name audit script | `scripts/audit-icons.sh` |

### Critical Rules

See **Architecture Invariants** below for full details and code examples.

1. **kebab-case `notify()`** — `@setter` registers kebab-case; `this.notify("camelCase")` silently breaks reactive bindings. Always `this.notify("kebab-case")`. [§1]
2. **Defer `Notifd.get_default()`** — D-Bus handshake blocks the main loop for 25s if another daemon owns the bus. Always use `GLib.idle_add`. [§2]
3. **Convert `GLib.List` before iterating** — `GLib.List` is not iterable in GJS; passing it to `<For>` crashes the component. Use `toArray()`. [§3]
4. **Bind `network.wifi` — never capture as const** — `.wifi` is set once at construction and is `null` forever if device wasn't ready. Always `createBinding(network, "wifi")`. [§4]
5. **Multi-dep `createComputed`** — late-arriving sub-properties (e.g., `battery_percentage`) are missed by single-dep computeds. Add `createBinding(obj, "devices")` as a secondary dependency. [§5]

### Common Mistakes

See **Anti-Patterns** below for the full list.

| Mistake | Fix |
|---------|-----|
| `this.notify("camelCase")` | `this.notify("kebab-case")` |
| `Notifd.get_default()` in constructor/mount | `GLib.idle_add` |
| `const wifi = network.wifi` | `createBinding(network, "wifi")` |
| `[...glList]` or `<For each={glList}>` | `toArray(glList)` |
| `shade-shell toggle` in scripts/keybindings | `gdbus` call |

### Delegation Triggers

| Trigger | Action |
|---------|--------|
| Read/edit 1–2 files, mechanical change | **Inline** — do it directly |
| Read 4+ files to understand | **Delegate** — scout/explorer subagent |
| Edit 2+ non-trivial files | **Delegate** — worker subagent; fresh reviewer audits before completion |
| Commit, push, or open PR | **Delegate** — fresh-context reviewer audits the diff first |
| Destructive / prod DB / infra / CI | **STOP** — ask for explicit confirmation |

**Subagent types:** `scout`/`explorer` for exploration, `worker` for implementation, `reviewer` for adversarial review. Keep writes single-threaded unless isolated worktrees are explicitly approved.

### Build Commands

```bash
pnpm run build       # Validate bundle + schema XML; NOT a runnable binary
pnpm run dev         # Nix build + run with proper wrappers
nix build            # Produces runnable binary with wrappers
nix run .#...        # Run via flake
```

> **Critical:** `meson compile` only validates the bundle — it does **not** produce a runnable binary. Always use `nix build` or `nix run` for a working binary.

---

## Agent Workflow

### Available Tools

| Tool | Purpose | Fallback |
|------|---------|----------|
| `bash` | Shell commands: git, nix, pnpm, journalctl, test | — |
| `batch` | Multi-op: file reads, writes, edits, deletes + bash + web | — |
| `grep` / `find` / `ls` | File search and directory listing | Use only when graph tools are unavailable or for literal string/glob searches |
| Code-review graph tools | Semantic search, dependency tracing, impact radius, architecture overview | **Not yet wired for this project.** Use `grep` with `glob` filters for symbol search; use `find` for file discovery; read files directly for dependency analysis |

**Graph-first rule:** When graph tools are available (future), always prefer `semantic_search_nodes` or `query_graph` over `grep` for finding symbols. Until then, use `grep` with `glob` and `find` as the primary discovery tools.

**Web tools** (`search`, `fetch`) are available for external research (GTK/GJS docs, Astal docs, NixOS references).

### Skill Loading

Before delegating, read `.atl/skill-registry.md` if present and pass matching skill paths to the subagent. If the registry is absent, proceed without project-specific skills.

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
Spawning the full GJS app takes ~1s. The lightweight `gdbus` call (as configured in `nix/hyprland/binds.nix`) takes ~7ms.

---

## Decision Log

Why non-obvious choices were made. **Do not reverse these without discussion.**

| Decision | Rationale |
|----------|-----------|
| **Defer `Notifd.get_default()` via `GLib.idle_add`** | D-Bus proxy handshake blocks the main loop for 25s if another notification daemon is registered. |
| **Track both `is-connected` and `devices` for bluetooth battery** | `battery_percentage` arrives after connection state — a `createComputed` depending only on `is-connected` caches `null` permanently. Adding `createBinding(bluetooth, "devices")` catches late property updates. |
| **Use `gdbus` via `nix/hyprland/binds.nix` for keybindings** | Spawning `shade-shell toggle` loads the entire 1MB bundle + GI modules (~1s) just to send a D-Bus message. |
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
| `shade-shell toggle ...` in scripts / keybindings | ~1s spawn overhead | `gdbus` call via `nix/hyprland/binds.nix` |
| `<For>` inside `<With>` callback | Gnim fragment nesting crash | Use `visible={...}` bindings |
| `media-record-stop-symbolic` | Missing icon in Adwaita | `media-playback-stop-symbolic` |
| Adding network list to Settings | Duplicates Quick Settings UX | Keep network UX in QS only |
| Single-dep `createComputed` for late-arriving GObject properties | Caches stale `null` if the property arrives after the tracked signal | Add `createBinding(obj, "devices")` or equivalent as a secondary dep |

---

## Build & Conventions

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

### Doc Health Check

```bash
./scripts/doc-check.sh          # Verify CHANGELOG + .md file references
./scripts/doc-check.sh --strict # Treat all stale references as errors
```

Implements Doc Maintenance Rules #1 and #4:
- **Rule #1**: Every backtick-quoted file path in `CHANGELOG.md` (with directory prefix or `/`) must exist on disk. Fails the check if not.
- **Rule #4**: All backtick-quoted file paths in every `.md` document must exist on disk. Reports warnings; use `--strict` to fail.

Add as a pre-commit hook:
```bash
ln -sf ../../scripts/doc-check.sh .git/hooks/pre-commit
```

### Version Bump Rule
If bumping version, sync **three** files:
1. `meson.build`
2. `package.json`
3. `nix/desktop-shell.nix`

And update `CHANGELOG.md`.

### Development Conventions

- **Path alias:** `#/*` maps to `./src/*`.
- **GIR imports:** `gi://Module?version=X.Y`, marked external in esbuild.
- **Gnim imports:** `gnim`, `gnim/gobject`, `gnim-schemas`.
- **GObject singletons:** Always expose `static get_default()`.
- **Default exports:** Most widgets use `export default () => ...`.
- **Logging:** Use `import logger from "#/lib/logger"` for normal logs. Use `print()` only inside `.catch()` handlers to surface errors.
- **CSS:** Global CSS in `src/shade.css`. Widget-level CSS via inline `css="..."`. Heavy use of Libadwaita built-in classes (`card`, `frame`, `background`, `linked`, `title-1`–`title-4`, `circular`, `flat`, `raised`, etc.).
- **Code style:** No semicolons. Follow surrounding quote style. 2-space indentation.

### UI Component Previewer (Storybook)

A standalone GJS application for previewing individual widgets with mock props,
with auto-restart on file change. Think Storybook for GTK/Gnim.

```bash
# Inside nix develop shell, run:
pnpm run preview              # Opens with component list
pnpm run preview ActionButton # Opens directly to ActionButton
pnpm run preview:dev          # Same as above (watch mode, default)

# Or from outside the shell:
nix develop -c pnpm run preview IconButton
```

The tool:
1. Bundles `src/previewer.tsx` with esbuild
2. Spawns `gjs` to render the preview window
3. Watches `src/` for file changes (`.ts`, `.tsx`, `.css`)
4. On change: rebuilds with esbuild → kills old GJS → spawns new GJS

**Adding a new component to the previewer:**

1. Open `src/previewer/registry.tsx`
2. Import your component
3. Add a `ComponentEntry` to the `entries` array:

```typescript
{
  name: "MyWidget",           // Display name
  category: "Buttons",        // Sidebar group
  description: "What it does",
  render: (p) => MyWidget({   // How to render it
    someProp: p.someProp as string,
    onClicked: () => print("clicked"),
  }),
  defaultProps: { someProp: "hello" },
  editableProps: {             // Optional: props editor
    someProp: { type: "string", label: "Label", default: "hello" },
  },
}
```

**Limitations:** The previewer runs as a plain `Adw.Window`, not an Astal window.
Components that depend on Astal services (e.g. `AstalBattery`, `AstalNetwork`,
`Hyprland`) may not render correctly. It's best for pure GTK/Adw/Gnim widgets.

Run with `GTK_DEBUG=interactive` for widget inspection:
```bash
GTK_DEBUG=interactive pnpm run preview
```

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

## Documentation Maintenance

Rules for keeping docs from rotting. Every violation found in the 2026-06-01 audit
is traceable to breaking one of these.

### 1. CHANGELOG entries must be verifiable

Before writing a CHANGELOG entry under `### Added`, confirm the files exist.
If an entry says *"Added `src/lib/foo.ts`"*, then `test -f src/lib/foo.ts` must
pass in the current branch. Describe what was **actually merged**, not what is
planned or desired.

```bash
# Before claiming a feature in CHANGELOG, verify its files exist:
test -f src/lib/updates.ts || echo "LIE — do not add to CHANGELOG"
```

### 2. Status changes require evidence

A `[DONE]` marker in ROADMAP.md or ARCHITECTURE_ACTION_PLAN.md means: code
exists in the current branch **and** builds. Never batch-mark items done.
Each status change must cite a file, a commit hash, or both.

```markdown
<!-- ❌ LIE — no evidence -->
- **Status:** `[DONE]`

<!-- ✅ CORRECT -->
- **Status:** `[DONE]` (see `src/lib/foo.ts`, commit a1b2c3d)
```

### 3. PI_CONTEXT.md is ephemeral

It is a session scratchpad, not a permanent document. After the task completes,
clear it to a single line:

```markdown
> Task completed YYYY-MM-DD. See git log for details.
```

Never leave stale claims about deleted files, active changes, or build status
in PI_CONTEXT.md. If the information is permanent, it belongs in CHANGELOG.md
or AGENTS.md.

### 4. File deletions must trigger a doc grep

When deleting or renaming **any** source file, run:

```bash
grep -rn "filename" *.md docs/*.md PI_CONTEXT.md 2>/dev/null
```

Update every reference before committing. A deleted `shade-toggle.sh` left 3
documents pointing to a ghost.

### 5. The "Where to Find Things" table is canonical

The table at the top of AGENTS.md is the single source of truth for file
locations. When a file is created or moved:

1. Update the table **first**
2. Then update any other docs that reference the old path
3. Trust the table over other documents when they conflict
