# Shell Upgrade Design — July 2026

## Overview

Nine improvements across three independent batches, drawn from Astal ecosystem libraries, GJS Wayland Shell (GWS), Matshell, Marble Shell, and ags2-shell.

---

## Batch 1: CSS/Theme Infrastructure

### 1.1 `useStyle` Scoped CSS Hook

**File:** `src/style/useStyle.ts`

A hook that generates scoped CSS classes per component, replacing the monolithic `shade.css` approach.

**API:**
```ts
function useStyle(styles: StyleObject): string
```

- Accepts a flat object with CSS property keys and values
- Supports nesting via `&` prefix keys: `{ "& > child": { "border-radius": "12px" } }`
- Generates a unique class name (e.g. `shade-s-7a3f1`), injects CSS into a dedicated `Gtk.CssProvider`
- Returns the class name to use as `<Box cssClasses={[style()]} />`
- Garbage-collects styles when the component's Gtk.Widget is destroyed (via `connect('destroy', ...)`)

**Behavior:**
- A single global `Gtk.CssProvider` at `STYLE_PROVIDER_PRIORITY_USER + 10` holds all scoped styles
- Deduplication: identical style objects get the same class name (weak map keyed on serialized JSON)
- Maximum 1000 style objects cached; LRU eviction beyond that

**Example migration:**
```tsx
// Before (in shade.css):
// .bar-centerbox { padding: 8px; background: @card_bg_color; }
// .bar-centerbox > separator { margin: 0 4px; }

// After (in bar/index.tsx):
const style = useStyle({
  padding: "8px",
  "background-color": "var(--shade-card-bg)",
  "& > separator": { margin: "0 4px" },
})
return <Gtk.CenterBox cssClasses={["bar-centerbox", style()]} />
```

### 1.2 Theme Manager

**File:** `src/style/theme.ts`

**API:**
```ts
class Theme extends GObject.Object {
  static get_default(): Theme
  variables: Record<string, string>           // read-only CSS variable map
  addTheme(stylesheet: Stylesheet): void
  removeTheme(name: string): void
}

class Stylesheet {
  constructor(name: string, config: {
    stylesheet: {
      dark: Record<string, string>
      light: Record<string, string>
    }
  })
  name: string
  activate(): void
  delete(): void
}
```

**Behavior:**
- `Theme.get_default()` is a singleton registering a `Gtk.CssProvider` at priority `STYLE_PROVIDER_PRIORITY_USER` that sets CSS custom properties on `*` selector
- Default theme is "Adwaita" — derived from current system colors
- Named themes are user-definable (e.g. "Catppuccin", "Nord")
- `Stylesheet.activate()` writes its dark/light variables to the provider based on current color scheme preference
- Listens to `Adw.StyleManager` for dark/light preference changes to auto-switch theme variants
- Built-in CSS custom properties:

| Variable | Purpose |
|---|---|
| `--shade-bg` | Main background |
| `--shade-surface` | Card/popup surface |
| `--shade-surface-dim` | Dimmed surfaces |
| `--shade-fg` | Primary text |
| `--shade-fg-dim` | Secondary/muted text |
| `--shade-primary` | Accent color |
| `--shade-primary-container` | Accent background |
| `--shade-on-primary` | Text on accent |
| `--shade-error` | Destructive color |
| `--shade-outline` | Borders |
| `--shade-shadow` | Box shadow color |
| `--shade-radius` | Default border radius |
| `--shade-spacing` | Base spacing unit |

### 1.3 Matugen Palette Pipeline

**File:** `src/style/palette.ts`

Upgrades the current 3-color matugen extraction to a full palette.

**API:**
```ts
class PaletteGenerator {
  static fromMatugen(wallpaperPath: string): Promise<Palette>
  apply(palette: Palette): void
}

interface Palette {
  surface: string
  surfaceContainer: string
  surfaceDim: string
  primary: string
  onPrimary: string
  primaryContainer: string
  secondary: string
  tertiary: string
  error: string
  onError: string
  outline: string
  outlineVariant: string
  shadow: string
}
```

**Behavior:**
- Shells out to `matugen image <wallpaper> --json hex` (same as current)
- Parses the full JSON output, mapping Material 3 tone values to CSS custom properties
- Writes properties via the Theme manager's provider
- Replaces the current `Theming.ts` service entirely — palette generation is triggered by the same wallpaper change events

### 1.4 CSS File Restructuring

**Before:**
```
src/shade.css          ← 12.5KB monolith
```

**After:**
```
src/style/
  useStyle.ts          ← scoped CSS hook
  theme.ts             ← Theme manager
  palette.ts           ← Matugen palette extraction
  reset.css            ← base resets (fonts, *, box-sizing)
src/shade.css          ← ~2KB: custom property defaults + @import reset.css
```

Migration: widget-specific CSS classes move into their component's `useStyle()` call. Global resets stay in `reset.css`.

---

## Batch 2: Core Infrastructure

### 2.1 AstalWl Monitor Tracking

**File:** `src/lib/services/monitoring/monitors.ts` (rewrite)

Replaces Gdk.Monitor-based tracking with AstalWl.WlOutput.

**Before:**
- `Gdk.Display.get_default().get_monitors()` + `items-changed`
- `Gdk2HyprMonitor()` with connector→description→geometry fallback chain
- `pendingSync` race condition workaround

**After:**
- `AstalWl.WlDisplay.get_default().get_outputs()` — direct Wayland protocol
- Output name, description, geometry available natively — no mapping needed
- `output-added`/`output-removed` signals from Wayland protocol (fires before Gdk)
- `MonitorService` GObject singleton keeps the same API surface:
  - `monitors` property (now returns WlOutput[] but with adapter for existing Gdk.Monitor consumers)
  - `get_default()` still works
  - `Gdk2HyprMonitor` updated to accept WlOutput instead of Gdk.Monitor

**Compatibility adapter:**
- `MonitorService.monitors` returns `WlOutputAdapter[]` — a thin wrapper exposing the same shape as Gdk.Monitor (`connector`, `description`, `geometry`, `manufacturer`, `model`)
- Widgets using `monitor.get_description()` or `monitor.connector` continue working unchanged
- The `<For each={monitors}>` pattern in bar, wallpaper, and lockscreen continues working
- `gdkmonitor` prop on `Astal.Window` still receives a Gdk.Monitor — we look up the Gdk counterpart by connector name for this single bridge point
- **Feature flag**: GSettings key `general.experimental-wayland-monitors` (default: `false`). When `true`, use AstalWl. When `false`, use current Gdk-based code. Allows rollback without code changes.

### 2.2 AstalBrightness

**File:** `src/lib/services/display/brightness.ts` (rewrite)

**Before:** 163 lines — shells out to `brightnessctl`, parses `/sys/class/backlight`, manual Gio.FileMonitor

**After:** ~50 lines
```ts
import Brightness from "gi://AstalBrightness"

@register({GTypeName: 'Brightness'})
export default class Brightness extends GObject.Object {
  #service = Brightness.get_default()

  @getter(Number) get screen() { return this.#service.screen }
  @setter(Number) set screen(v: number) { this.#service.screen = v }

  @getter(Number) get kbd() { return this.#service.kbd }
  @setter(Number) set kbd(v: number) { this.#service.kbd = v }

  constructor() {
    super()
    this.#service.connect("notify::screen", () => this.notify("screen"))
    this.#service.connect("notify::kbd", () => this.notify("kbd"))
  }
}
```

**Nix changes:**
- Remove `brightnessctl` from `wrapperPackages`
- Add `astal.packages.${system}.brightness` to `astalPackages`

### 2.3 AstalQuarrel CLI

**File:** `src/lib/services/state/requestHandler.ts` (rewrite)

**Before:** Manual string matching on `programArgs`

**After:** Quarrel command tree:
```ts
import Quarrel from "gi://Quarrel"

const cli = new Quarrel.Command("shade-shell")
  .about("Shade Shell — Hyprland Adwaita Desktop Environment")
  .subcommand(new Quarrel.Command("toggle")
    .about("Toggle a widget visibility")
    .arg("WIDGET", "Widget to toggle: settings, launcher, quicksettings, clipboard")
  )
  .subcommand(new Quarrel.Command("settings")
    .about("Open settings window")
  )
  .subcommand(new Quarrel.Command("clipboard")
    .about("Open launcher in clipboard mode")
  )
  // ... other commands

const command = cli.parse([programInvocationName, ...programArgs])
```

**Nix changes:**
- Add `astal.packages.${system}.quarrel` to `astalPackages`

### 2.4 PopupWindow Abstraction

**File:** `src/widget/common/PopupWindow.tsx` (new)

Shared wrapper for all popup-style windows to eliminate duplicated Astal.Window boilerplate.

**API:**
```tsx
interface PopupWindowProps {
  name: string                      // unique window name, used as namespace
  visible: Accessor<boolean>        // reactive visibility
  anchor: Accessor<AnchorPosition>  // auto-derived from bar position setting
  layer?: Astal.Layer               // default: Astal.Layer.OVERLAY
  margin?: number                   // default: 12
  onClose?: () => void
  children: GNIM.Children
}
```

**Handles automatically:**
- `application={app}`
- `namespace={name}`
- `keymode={Astal.Keymode.ON_DEMAND}`
- `exclusivity={Astal.Exclusivity.EXCLUSIVE}`
- Margin based on bar position (adds offset to avoid overlapping the bar)
- ESC key dismisses window
- `visible` sync — closes quicksettings when launcher opens (if bar is vertical)

**Widgets that adopt it:**
- `applauncher/index.tsx`
- `quicksettings/index.tsx`
- `notifications/index.tsx` (notification popups)
- `osd/index.tsx`
- `region-selector/index.tsx`
- `screenshot-ui/index.tsx`

---

## Batch 3: UX Enhancements

### 3.1 Fuzzy Search Engine

**Files:**
```
src/lib/services/search/
  tokenizer.ts       ← n-gram tokenization
  scorer.ts          ← weighted field scoring
  index.ts           ← pre-built search index
  types.ts           ← shared types
```

**Tokenizer:**
- Converts input to lowercase, strips diacritics
- Generates bigrams and trigrams
- "firefox" → `["fi", "ir", "re", "ef", "fo", "ox", "fir", "ire", "ref", "efo", "fox"]`

**Scorer:**
- Field weights: name ×3, keywords ×2, description ×1, executable ×0.5
- Exact prefix match bonus: ×1.5
- Score = Σ(matching n-grams weight × field weight)

**Index:**
- Built once on app list load, rebuilt on app list change (installs/uninstalls)
- `Map<string, IndexEntry>` — token → list of {app, score}
- Query: tokenize input, intersect matching entries, rank by cumulative score
- Target: <5ms for 100+ apps

**Integration:**
- Replaces current `fuzzyQuery` in `src/lib/services/state/apps.ts`
- Same function signature — drop-in replacement
- Clipboard search uses the same tokenizer but simpler scoring (content match only)

### 3.2 Frecency Launcher

**Files:**
```
src/lib/services/search/frecency/
  manager.ts         ← launch tracking + score computation
  storage.ts         ← persistence layer (GSettings)
  types.ts           ← FrecencyEntry type
```

**Data model:**
```ts
interface FrecencyEntry {
  desktopId: string
  launchCount: number      // all-time launches
  lastLaunched: number     // epoch milliseconds
}
```

**Scoring formula:**
```
recencyScore = exp(-(now - lastLaunched) / halfLifeDays)
frecencyScore = log2(launchCount + 1) * recencyScore
finalScore = fuzzyScore * (1 + frecencyBoost * frecencyScore)
```

**Defaults:**
- `halfLifeDays = 7` — an app opened today has recency 1.0; opened 7 days ago has recency ~0.37
- `frecencyBoost = 0.5` — how much frecency boosts search results

**Behavior:**
- **Empty search box**: show top-frecency apps (sorted by frecencyScore descending)
- **Typing**: fuzzy filter results, then rank by `finalScore`
- **Selection**: increment `launchCount`, update `lastLaunched`, persist

**Persistence:**
- GSettings key `launcher-frecency` stored as JSON string in a string-typed key (GSettings has no native map type)
- Schema: `{ "type": "string", "default": "{}" }` — serialized `Record<string, {count: number, lastLaunched: number}>`
- Loaded at startup via `JSON.parse()`, saved on each launch event (debounced to 500ms)
- Max 500 entries; least-recently-used eviction on overflow

### 3.3 Popup Collision Avoidance

**File:** `src/lib/services/layout/collisionManager.ts`

**Behavior:**
- `WindowManager` tracks visible popups with their screen rectangles
- On any popup visibility change, compute overlaps
- Priority: notifications > OSD > quicksettings > launcher > screenshot UI
- If overlap detected: compute a non-overlapping position for the lower-priority popup
  - Try shifting right/down by overlap amount
  - If edge of screen: wrap to opposite side
  - If still overlaps: stack vertically with small gap

**Algorithm:**
```
for each pair (A, B) of visible popups where priority(A) < priority(B):
  if rect(A) ∩ rect(B):
    shift(B) away from A by overlap amount + gap(8px)
    clamp(B) within monitor bounds
```

**Limitations:** Only handles pairs (not N-way overlaps). Three popups simultaneous is rare enough that pair-wise resolution is sufficient.

### 3.4 AstalGreet Lockscreen

**Files:**
```
src/widget/lockscreen/
  index.tsx           ← rewritten: AstalGreet integration
  GreetSession.ts     ← new: PAM conversation wrapper
  ui.tsx              ← extracted: existing clock/notifications/widgets UI
```

**GreetSession (`src/widget/lockscreen/GreetSession.ts`):**
```ts
class GreetSession extends GObject.Object {
  greeter: AstalGreet.Greeter
  state: "idle" | "awaiting-input" | "authenticating" | "authenticated" | "error"

  start(username: string): void
  postAuth(response: string): void
  startSession(cmd: string[], env: string[]): void
  cancel(): void

  signal "authenticated" → ()
  signal "error" → (message: string)
  signal "info" → (message: string)
  signal "prompt-visible" → (message: string)
  signal "prompt-secret" → (message: string)
}
```

**Lockscreen flow:**
1. Lockscreen window opens (triggered by `shellState.screenlocked = true`)
2. `GreetSession.start(GLib.get_user_name())` — begins PAM conversation
3. PAM may send `visible-request` or `secret-request` — session emits signals
4. UI shows password entry field on `prompt-secret`
5. User types password → `greetSession.postAuth(password)`
6. PAM verifies → `authenticated` signal → `greetSession.startSession(["Hyprland"], [])`
7. Lockscreen window closes, session starts

**Nix changes:**
- Add `astal.packages.${system}.greet` to `astalPackages`
- Add `greetd` to `wrapperPackages`
- Add `astal.packages.${system}.auth` already exists (PAM is included)

---

## Nix Flake Changes

**`flake.nix` — `astalPackages` additions:**
```nix
astalPackages = with astal.packages.${system}; [
  apps auth battery bluetooth brightness   # +brightness
  astal.packages.${system}.hyprland
  cava                                     # +cava (already used, now explicit)
  greet                                    # +greet
  mpris network
  (notifd.overrideAttrs (old: { ... }))
  powerprofiles quarrel                    # +quarrel
  tray wireplumber
  astal4
  wl                                       # +wl
];
```

**`wrapperPackages` changes:**
```nix
wrapperPackages = with pkgs; [
  hyprland
  # brightnessctl  ← REMOVED (replaced by AstalBrightness)
  greetd           ← ADDED (for AstalGreet lockscreen)
  bash curl grim imagemagick wl-screenrec wf-recorder wayfreeze
  hyprsunset hypridle matugen glib.bin uwsm pipewire
];
```

---

## Migration Order Within Batches

### Batch 1 (theme infra):
1. `useStyle.ts` — hook implementation
2. `theme.ts` — Theme manager with default Adwaita palette
3. `reset.css` — extract global resets from `shade.css`
4. `palette.ts` — full matugen palette extraction, replaces `Theming.ts`
5. Migrate widgets to `useStyle()` one by one

### Batch 2 (core infra):
1. `PopupWindow.tsx` — build abstraction
2. Adopt PopupWindow in all 6 popup widgets
3. `brightness.ts` rewrite
4. `quarrel` — requestHandler.ts rewrite
5. `monitors.ts` — AstalWl rewrite

### Batch 3 (UX):
1. `search/tokenizer.ts` + `search/scorer.ts`
2. `search/index.ts` — search engine
3. Integrate search into `apps.ts` and launcher widget
4. `frecency/` — frecency tracking + storage
5. Integrate frecency into launcher default view
6. `collisionManager.ts`
7. Integrate collision avoidance into PopupWindow/WindowManager
8. `GreetSession.ts`
9. Rewrite `lockscreen/index.tsx` with AstalGreet

---

## Risk Assessment

| Item | Risk | Mitigation |
|---|---|---|
| AstalWl | Library is new (2026), may have bugs | Keep old monitor code as fallback path; feature flag |
| useStyle performance | Runtime CSS generation per component | Weak-map dedup; LRU cache of 1000; benchmark startup |
| Frecency persistence | GSettings corruption on crash | Atomic write via temp file; validate on load |
| Greetd integration | PAM conversation edge cases | Error state UI; fallback to old lockscreen on failure |
| PopupWindow migration | Breaking existing popup behavior | One widget at a time; test each after migration |

---

## Testing Strategy

- **useStyle**: Unit test that generated CSS class renders correctly; test dedup; test cleanup on destroy
- **Fuzzy search**: Test known queries against app list; benchmark <5ms on 200 apps
- **Frecency**: Test score decay over simulated time; test persistence round-trip
- **PopupWindow**: Visual test on all 6 popup types; test ESC dismiss; test bar-position margin
- **AstalGreet**: Manual test with greetd running; test wrong password flow; test PAM info messages
