# Shade Shell — Postmortem & Lessons Learned

> This document captures the bugs, root causes, and systemic patterns found during the codebase audit. Read this before writing new features. Reference this during code review.

---

## 1. The WiFi Bug — Case Study

### Symptom
WiFi network list showed `[object Uint8Array]` instead of network names. Active network checkmark never appeared. Saved networks always prompted for a password.

### Root Causes

#### 1.1 NetworkManager Exposes SSIDs/BSSIDs as Byte Arrays
NetworkManager stores SSIDs as raw bytes (`guchar[]` / `GBytes`), not UTF-8 strings. When AstalNetwork exposes these through GObject introspection to GJS, they arrive as `Uint8Array` objects. GTK's `label` property expects a string. Passing a `Uint8Array` causes `.toString()` to emit `[object Uint8Array]`.

**The faulty code:**
```tsx
// ap.ssid is Uint8Array — truthy, so ?? doesn't help
label={ap.ssid ?? "Hidden Network"}

// ap.bssid is also Uint8Array — reference equality always fails
active?.bssid === ap.bssid   // false, even when it's the same network
```

**Why this happened:** Developer assumed AstalNetwork's GIR bindings would convert byte arrays to JS strings automatically. They don't.

**The fix:**
```ts
function bytesToString(value: any): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (value instanceof Uint8Array) {
    // find null terminator
    let len = value.length
    for (let i = 0; i < value.length; i++) {
      if (value[i] === 0) { len = i; break }
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(value.subarray(0, len))
  }
  return null
}
```

#### 1.2 `GLib.List` Length Check Used `.length`
`ap.get_connections()` returns `GLib.List`, not a JS array. `conns.length` is `undefined`. The check `conns && conns.length > 0` was always false.

**Why this happened:** Developer assumed GLib collections have the same API as JS arrays. They don't.

**The fix:**
```ts
function listLength(list: any): number {
  if (!list) return 0
  if (Array.isArray(list)) return list.length
  let count = 0
  let l = list
  while (l) { count++; l = l.next }
  return count
}
```

---

## 2. Systemic Bug Patterns

These patterns appeared across multiple files. They represent the most common categories of bugs in this codebase.

---

### Pattern A: Assuming GIR Bindings Convert Types

**What it is:** Assuming GObject properties return JS-native types (strings, arrays) when they actually return GType wrappers (byte arrays, GLib.List, GBytes).

**Where it bit us:**
- `network.tsx`: `ap.ssid`, `ap.bssid` → `Uint8Array`
- `network.tsx`: `ap.get_connections()` → `GLib.List`
- `bar/workspaces.tsx`: `ws.clients` → `GLib.List` (crash — not iterable)
- `brightness.ts`: sysfs reads → may be strings that need `parseInt`

**Rule:**
> **Never assume a GObject property returns a JS-native type.** If the underlying C API uses `guchar[]`, `GBytes`, `GSList`, `GList`, or `GPtrArray`, verify what GJS actually gives you. Log the `typeof` and `constructor.name` during development.

**Prevention checklist:**
- [ ] When consuming a new GObject property for the first time, `print(typeof obj.prop, obj.prop?.constructor?.name)`
- [ ] When a property is documented as "list" or "array" in C/Vala, check if it's `GLib.List`, `Gio.ListModel`, or JS `Array`
- [ ] When a property is "string" in C but comes from binary data (SSID, BSSID, hardware IDs), assume byte array

---

### Pattern B: Direct Property Reads Instead of Bindings

**What it is:** Reading GObject properties synchronously (`obj.prop`) inside render functions or event handlers, assuming they won't change. This breaks reactive updates and misses external changes.

**Where it bit us:**
- `network.tsx`: `wifi.enabled` read directly in popover → button doesn't update when WiFi toggles externally
- `settings/network.tsx`: `const wifi = network.wifi` → never updates if WiFi device appears later
- `quicksettings/button-grid/colorScheme.tsx`: `colorScheme.colorScheme` read in click handler
- `bar/systemUsage.tsx`: `settings.bar.tempPath.get()` read directly inside interval

**Rule:**
> **Always use `createBinding(obj, "prop")` for values displayed in UI.** Only use direct property reads inside event handlers where you need a one-time synchronous snapshot.

**When direct reads are OK:**
- Inside `onClicked` handlers (one-time action)
- Inside `setTimeout`/`setInterval` callbacks where you've explicitly decided to poll

**When direct reads are NOT OK:**
- Inside JSX render functions
- Inside `.as()` transforms that depend on mutable state
- For conditional visibility (`visible={obj.prop}`)
- For derived state that should update reactively

---

### Pattern C: `setInterval` Without Cleanup

**What it is:** Creating recurring timers and never stopping them. Every monitor disconnect, bar recreation, or lock/unlock leaks a timer.

**Where it bit us:**
- `bar/clock.tsx`: 1000ms interval for clock
- `bar/systemUsage.tsx`: 1000ms interval for CPU/RAM
- `quicksettings/expander/worldClock.tsx`: 1000ms interval
- `lockscreen/index.tsx`: 1000ms interval for lock screen clock
- `lib/weather.ts`: `setInterval` instead of `GLib.timeout_add`
- `lib/autoCpufreq.ts`: recursive `setTimeout` with no cancellation

**Rule:**
> **Every timer must have a cleanup path.** Store the handle and clear it in `onCleanup`.

**Correct pattern:**
```tsx
onMount(() => {
  const id = setInterval(() => { /* ... */ }, 1000)
  onCleanup(() => clearInterval(id))
})
```

**Even better for GJS:**
```tsx
onMount(() => {
  const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
    // update
    return GLib.SOURCE_CONTINUE
  })
  onCleanup(() => GLib.source_remove(id))
})
```

---

### Pattern D: Synchronous Blocking Calls in UI Code

**What it is:** Using synchronous `exec()`, file reads, or heavy computation on the main thread, freezing the UI.

**Where it bit us:**
- `bar/systemUsage.tsx`: `AstalIO.Process.exec(`cat ${path}`)` inside a 1-second interval
- `wallpaper/index.tsx`: `Gly.Loader.load()` runs synchronously on main thread for large images
- `lib/brightness.ts`: `AstalIO.Process.exec` at module import time

**Rule:**
> **Never block the main thread.** Use `_async` variants, `Gio.File.load_contents_async()`, or offload to workers.

---

### Pattern E: `GLib.List` Treated as Iterable/Array

**What it is:** Spreading `[...list]`, accessing `.length`, using `.forEach()`, or passing to `For` component without conversion.

**Where it bit us:**
- `bar/workspaces.tsx`: `For` component tries to spread `ws.clients` (GLib.List) → crash
- `network.tsx`: `.length` on `get_connections()` result → undefined
- `lib/monitors.ts`: `Array.from()` on `Gio.ListModel` via cast (fragile)

**Rule:**
> **GLib.List is not a JS array.** It has no `.length`, no iterator protocol, no `.map`/`.filter`. Convert it first.

**Correct pattern:**
```ts
function toArray<T>(list: any): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list
  const arr: T[] = []
  let l = list
  while (l) {
    arr.push(l.data !== undefined ? l.data : l)
    l = l.next
  }
  return arr
}
```

---

### Pattern F: Null-Safety Assumptions

**What it is:** Assuming GObject properties are always non-null when the documentation or runtime reality says otherwise.

**Where it bit us:**
- `bar/weather.tsx`: `weather.as(w => w.get_icon_name())` → crashes when `info` is null
- `quicksettings/expander/weather.tsx`: same null weather info
- `osd/index.tsx`: assumes `audio.defaultSpeaker` always exists
- `App.tsx`: `Gdk.Display.get_default()!` → crash on headless systems

**Rule:**
> **Every `!` non-null assertion is a TODO.** Replace with proper null checks and fallback UI.

**Correct pattern:**
```tsx
<With value={weatherBinding}>
  {(w) => w && w.info
    ? <Gtk.Image iconName={w.info.get_icon_name() ?? "weather-clear-symbolic"} />
    : <Gtk.Image iconName="weather-clear-symbolic" />
  }
</With>
```

---

### Pattern G: Signal/Listener Accumulation

**What it is:** Connecting GObject signals inside components that re-render or remount, without disconnecting. Listeners pile up and fire multiple times.

**Where it bit us:**
- `lockscreen/index.tsx`: `fingerprint.connect("verified", ...)` called every lock → 10 locks = 10 unlock attempts
- `lib/weather.ts`: `geo.locationChanged` reconnected every time auto-location toggles on
- `common/slider.tsx`: `props.value.subscribe(...)` never unsubscribed

**Rule:**
> **Every `.connect()` needs a matching `.disconnect()` or cleanup.** Prefer reactive bindings (`createBinding`) over manual signal connection.

**Correct pattern:**
```tsx
onMount(() => {
  const id = obj.connect("signal", handler)
  onCleanup(() => obj.disconnect(id))
})
```

---

### Pattern H: GTK Constructor Property Syntax Fragility

**What it is:** Passing properties to GTK widget constructors that don't support them in GJS, or using JS-style property names instead of GObject property names.

**Where it bit us:**
- `network.tsx`: `new Gtk.Entry({ visibility: false })` → may not work
- `quicksettings/expander/media.tsx`: `iconName={"media-skip-backwiconNameard-symbolic"}` → mangled string
- `settings/general.tsx`: `fileDialog.open_finish(res).get_path()` → no null check

**Rule:**
> **Use imperative setters for properties you're unsure about.** Constructor property syntax is convenient but not all properties are construct-only or supported in GJS.

**Correct pattern:**
```tsx
const entry = new Gtk.Entry({ placeholderText: "Password" })
entry.set_visibility(false)
```

---

### Pattern I: Math/Logic Errors in Data Transformation

**What it is:** Incorrect formulas, off-by-one errors, or unit mismatches when converting raw data to display values.

**Where it bit us:**
- `bar/systemUsage.tsx`: `diskTop.bavail / diskTop.bfree` → wrong formula (available/free instead of used/total)
- `bar/systemUsage.tsx`: temperature divided by `100000` instead of `1000` (millidegrees → °C)
- `lib/brightness.ts`: keyboard brightness set to `0` or `1` instead of `0%` or `100%`

**Rule:**
> **Verify your math against the source documentation.** `glibtop` fields, sysfs units, and hardware APIs have specific semantics. Add a comment citing the doc when the formula is non-obvious.

---

### Pattern J: Hardcoded Personal Values in Distributed Code

**What it is:** Developer-specific defaults, emails, keyboard layouts, or paths leaking into the codebase.

**Where it bit us:**
- `lib/gschema.ts`: Default timezones `["America/Sao_Paulo", "Australia/Sydney"]`
- `lib/weather.ts`: Hardcoded email `caiomuniz888@gmail.com` in HTTP headers
- `nix/hyprland/default.nix`: `kb_layout = "br,us"`, Catppuccin colors, `ghostty` scratchpad

**Rule:**
> **No personal data in shared code.** Use empty arrays, neutral defaults, or environment variables.

---

## 3. Nix-Specific Patterns

### Pattern K: Path/Name Mismatches Between Build and Runtime

**Where it bit us:**
- `meson.build` installs wallpapers to `datadir`, but schema references `${datadir}/shade-shell/wp-day.jpg`
- `meson.build` installs `toggle-touchpad.py` to `bindir`, but Hyprland config looks for `/tmp/shade-touchpad-toggle.py`
- `package.json` `dev` script copies schemas but never runs `glib_compile_schemas`

**Rule:**
> **Build paths and runtime paths must be verified together.** When you change where something is installed, trace every reference.

### Pattern L: Missing Runtime Dependencies

**Where it bit us:**
- `nix/hyprland/binds.nix` references `hyprshot`, `playerctl`, `pwvucontrol`, `wvkbd` — none in `wrapperPackages`
- `nix/hyprland/binds.nix` references `/tmp/shade-touchpad-toggle.py` — `python3` not in wrapper PATH

**Rule:**
> **Every executable referenced in a keybind must be in `wrapperPackages` or `environment.systemPackages`.**

### Pattern M: Hyprland Config Syntax Drift

**Where it bit us:**
- `bindm = SUPER,SHIFT, movewindow` → invalid (modifier as key)
- `plugin.dynamic-cursors` config without loading the plugin
- `layerrule` syntax may use invalid `match:` prefix

**Rule:**
> **Validate Hyprland config with `hyprctl reload` after changes.** Syntax errors don't always crash Hyprland but they silently fail.

---

## 4. Pre-Flight Checklist for New Features

Before submitting any new component or service:

### GObject / System Integration
- [ ] `print(typeof prop, prop?.constructor?.name)` for every new GObject property consumed
- [ ] Byte array properties have a `bytesToString()` or equivalent conversion
- [ ] `GLib.List` / `Gio.ListModel` properties are converted with `toArray()` before passing to `For`
- [ ] Null checks for every GObject property that can return null
- [ ] No `!` non-null assertions without a comment explaining why it's safe

### Reactivity
- [ ] All UI-visible values use `createBinding()` or derived accessors
- [ ] Direct property reads only inside event handlers
- [ ] No `.get()` inside render functions unless absolutely necessary

### Lifecycle
- [ ] Every `setInterval` / `setTimeout` has a `clearInterval` / `clearTimeout` in `onCleanup`
- [ ] Every `obj.connect("signal")` has a matching `disconnect` in `onCleanup`
- [ ] Every `props.x.subscribe()` has an unsubscribe in `onCleanup`
- [ ] Singletons that poll have a dispose/stop method

### Performance
- [ ] No synchronous `exec()`, file reads, or heavy computation on main thread
- [ ] No polling more frequent than necessary (prefer event-driven via FileMonitor, D-Bus signals)
- [ ] Large images loaded asynchronously, not synchronously on main thread

### Error Handling
- [ ] `try/catch` around `Gio.File` operations, file dialogs, and D-Bus calls
- [ ] `?.catch((e) => print(...))` on async GObject methods
- [ ] Fallback UI for null/empty states
- [ ] No silent swallowing (`catch {}`) — at minimum `print()` the error

### GTK/GJS
- [ ] Constructor properties verified against GIR docs
- [ ] Imperative setters used for properties unsupported in constructors
- [ ] Icon names verified with `gtk4-icon-browser` or system theme
- [ ] `Gtk.Label` `label` props are always strings (never objects/arrays)

### Math / Logic
- [ ] Unit conversions documented with source reference
- [ ] Division by zero guarded
- [ ] Formula tested against known values

### Nix / Build
- [ ] Every new executable referenced is added to `wrapperPackages`
- [ ] Install paths in `meson.build` match runtime references
- [ ] Schema changes include `glib_compile_schemas` step
- [ ] Version bumped in all relevant files (or single source of truth)

---

## 5. Quick Reference — Common GJS/GObject Pitfalls

| Situation | What You Expect | What GJS Gives You | How to Handle |
|-----------|---------------|-------------------|---------------|
| `NM.DeviceWifi.ssid` | `string` | `Uint8Array` | `bytesToString()` |
| `NM.AccessPoint.bssid` | `string` | `Uint8Array` | `bytesToString()` |
| `GLib.List<T>` | JS `Array` | Linked list with `.data`/`.next` | `toArray()` |
| `Gio.ListModel` | JS `Array` | GObject with `get_item()` / `get_n_items()` | `Array.from()` or manual loop |
| `GBytes` | `string` / `Buffer` | `GLib.Bytes` or `Uint8Array` | `.get_data()` or `bytesToString()` |
| `gchar*` property | `string` | `string` (usually correct) | Verify with `typeof` |
| `gboolean` property | `boolean` | `boolean` | Safe |
| `gint/guint` property | `number` | `number` | Safe |
| `gdouble` property | `number` | `number` | Safe |

---

## 6. When You See These Symptoms, Check These Causes

| Symptom | Likely Cause | File to Check |
|---------|-------------|---------------|
| `[object Object]` or `[object Uint8Array]` in UI | Byte array / object passed where string expected | Any label, any GObject property from NM or hardware |
| List shows nothing / crashes | `GLib.List` not converted | Any `For` component consuming GObject lists |
| Saved connections still ask for password | `.length` on `GLib.List` | Network, Bluetooth device lists |
| UI doesn't update when state changes externally | Direct property read instead of binding | Render functions, conditional visibility |
| Interval/memory leak | `setInterval` without cleanup | Clocks, system monitors, pollers |
| Event fires multiple times | Signal listener accumulation | Lock screen, modals, dialogs |
| `NaN` in display | Division by zero or wrong formula | System usage, temperature, battery |
| Shell crashes on startup | Module-level side effects | Singleton constructors, hardware probing |
| Headless/SSH crash | `Gdk.Display.get_default()!` | `App.tsx`, `monitors.ts` |
| Config syntax error | Invalid Hyprland bind/dispatcher | `nix/hyprland/binds.nix` |

---

## 7. Prevention Architecture

### Extract Shared Helpers (Do This Soon)

Create `src/lib/gjs-utils.ts` with battle-tested helpers:

```ts
// src/lib/gjs-utils.ts

export function toArray<T>(list: any): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list
  const arr: T[] = []
  let l = list
  while (l) {
    arr.push(l.data !== undefined ? l.data : l)
    l = l.next
  }
  return arr
}

export function listLength(list: any): number {
  if (!list) return 0
  if (Array.isArray(list)) return list.length
  let count = 0
  let l = list
  while (l) { count++; l = l.next }
  return count
}

export function bytesToString(value: any): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (value instanceof Uint8Array) {
    let len = value.length
    for (let i = 0; i < value.length; i++) {
      if (value[i] === 0) { len = i; break }
    }
    if (len === 0) return ""
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(value.subarray(0, len))
    } catch { return null }
  }
  if (typeof value.toString === "function") {
    const str = value.toString()
    if (str && !str.startsWith("[object ")) return str
  }
  return null
}

export function safeInterval(callback: () => void, ms: number): () => void {
  const id = setInterval(callback, ms)
  return () => clearInterval(id)
}

export function safeTimeout(callback: () => void, ms: number): () => void {
  const id = setTimeout(callback, ms)
  return () => clearTimeout(id)
}
```

Then import and use everywhere. No more ad-hoc implementations.

### Add a Debug Logger for New Properties

When integrating a new GObject service, add a temporary debug block:

```ts
// Temporary — remove after verifying types
print("DEBUG: typeof ssid =", typeof ap.ssid, 
      "constructor =", ap.ssid?.constructor?.name,
      "value =", ap.ssid)
```

This catches type mismatches immediately instead of at user runtime.

---

> **Last updated:** After WiFi bug fix + full codebase audit  
> **Next review:** After Phase 0 quick wins are implemented
