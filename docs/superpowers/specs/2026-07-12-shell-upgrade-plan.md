# Implementation Plan — Shell Upgrade (July 2026)

> Generated from spec: `docs/superpowers/specs/2026-07-12-shell-upgrade-design.md`

## Corrections from Code Inspection

Before writing the plan, two corrections to the spec based on actual code review:

1. **Lockscreen already uses `AstalAuth.Pam`** (`src/widget/lockscreen/index.tsx`). It has working PAM auth, fingerprint support, and session lock protocol. The AstalGreet task is **adding a greetd greeter mode** — a separate entry point for the login screen at boot, not replacing the existing lockscreen PAM code.

2. **Fuzzy search is already handled by `AstalApps.fuzzy_query()`** (`src/lib/services/state/apps.ts`) with weighted multipliers. Our task is adding a **frecency scoring layer** on top of AstalApps results, not building a tokenizer/scorer from scratch. The search engine task reduces to just the frecency manager.

---

## Batch 1: Theme Infrastructure (est. 3-4 hours)

### 1.1 — `src/style/useStyle.ts` (new)

**What:** Scoped CSS hook for components.

**Implementation:**
```ts
// Singleton Gtk.CssProvider at STYLE_PROVIDER_PRIORITY_USER + 10
// WeakMap<StyleObject, string> for class-name dedup
// Counter for unique class names: shade-s-0, shade-s-1, ...
// LRU eviction at 1000 entries
// Auto-cleanup: connect Gtk.Widget 'destroy' → remove from provider
```

**Steps:**
1. Create `src/style/useStyle.ts`
2. Export `useStyle(styles: StyleObject): Accessor<string>` — returns a reactive accessor with the generated CSS class name
3. Flatten nested `&` selectors to CSS descendant selectors at call time
4. Serialize style object to JSON for dedup key (sorted keys for stable hashing)
5. Inject CSS into the global scoped-styles provider
6. Register destroy handler on the widget returned by the component

**Test:** Unit test with a Gtk.Box, verify the CSS class appears in the provider.

### 1.2 — `src/style/theme.ts` (new)

**What:** CSS custom properties manager.

**Implementation:**
```ts
class Theme extends GObject.Object {
  static get_default(): Theme
  // Registers Gtk.CssProvider at STYLE_PROVIDER_PRIORITY_USER
  // Sets :root { --shade-bg: ...; --shade-fg: ...; ... }
  addTheme(stylesheet: Stylesheet): void
  // Listens to Adw.StyleManager::dark for auto-switching
}

class Stylesheet {
  constructor(name: string, config: { stylesheet: { dark, light } })
  activate(): void  // sets current CSS vars
  delete(): void
}
```

**Steps:**
1. Create `src/style/theme.ts`
2. Define the 14 CSS custom properties (--shade-bg, --shade-surface, etc.)
3. Default "Adwaita" theme derived from current system colors
4. `activate()` swaps provider content based on dark/light preference
5. Connect to `Adw.StyleManager.get_default().connect('notify::dark', ...)`

### 1.3 — `src/style/palette.ts` (new)

**What:** Full matugen palette extraction, replaces `src/lib/services/display/theming.ts`.

**Implementation:**
- Same matugen shell-out: `matugen image <wallpaper> --json hex`
- Parse the full Material 3 palette from JSON output
- Map Material 3 tone values to our CSS custom properties
- Write through `Theme.get_default()` provider

**Steps:**
1. Create `src/style/palette.ts`
2. Copy matugen shelling-out logic from `Theming.ts`
3. Parse all color roles from the JSON (not just primary/secondary/error)
4. Map to `--shade-*` variables
5. Integrate with wallpaper change events (same subscription pattern as current Theming)
6. Delete `src/lib/services/display/theming.ts`
7. Update `src/widget/index.tsx` service descriptors to replace Theming

### 1.4 — `src/style/reset.css` (new) + `src/shade.css` (shrink)

**Steps:**
1. Extract font-face, `*` reset, tooltip resets from `shade.css` into `src/style/reset.css`
2. Remove widget-specific classes that move to `useStyle()` (see migration below)
3. Keep global utility classes in `shade.css` (`.card`, `.frame`, etc.)
4. Remove the `@define-color` blocks — they move to Theme manager's CSS provider

### 1.5 — Widget CSS Migration

For each widget file, move its CSS from `shade.css` into `useStyle()` at the top of the component:

| Widget | shade.css classes to migrate |
|---|---|
| `bar/index.tsx` | `.bar-centerbox`, separator margins |
| `applauncher/index.tsx` | `.applauncher-body`, `.caption` |
| `quicksettings/index.tsx` | popover margins |
| `notifications/index.tsx` | notification cards |
| `osd/index.tsx` | OSD level bars |
| `lockscreen/index.tsx` | lockscreen card styles |

---

## Batch 2: Core Infrastructure (est. 5-6 hours)

### 2.1 — `src/widget/common/PopupWindow.tsx` (new)

**What:** Shared Astal.Window wrapper for all 6 popup widgets.

**Steps:**
1. Create `src/widget/common/PopupWindow.tsx`
2. Implement props: `name`, `visible`, `anchor`, `layer?`, `margin?`, `onClose?`, `children`
3. Inside: `<Astal.Window>` with `namespace={name}`, `keymode=ON_DEMAND`, `exclusivity=EXCLUSIVE`, `application={app}`
4. Auto-compute margin to avoid overlapping bar based on `anchor()`
5. ESC key controller auto-added
6. Register/deregister with WindowManager

**Adoption order** (easiest first):
1. `applauncher/index.tsx`
2. `osd/index.tsx`
3. `quicksettings/index.tsx`
4. `notifications/index.tsx`
5. `region-selector/index.tsx`
6. `screenshot-ui/index.tsx`

### 2.2 — `src/lib/services/display/brightness.ts` (rewrite)

**What:** Replace brightnessctl binary with AstalBrightness.

**Steps:**
1. Add `astal.packages.${system}.brightness` to flake.nix `astalPackages`
2. Rewrite `brightness.ts` using `import Brightness from "gi://AstalBrightness"`
3. Replace sysfs file monitors with `notify::screen` / `notify::kbd` signals
4. Remove `brightnessctl` from flake.nix `wrapperPackages`
5. Run `node --check` on the file
6. Test: change brightness via OSD, verify it works

### 2.3 — `src/lib/services/state/requestHandler.ts` (rewrite)

**What:** Replace manual arg parsing with Quarrel.

**Steps:**
1. Add `astal.packages.${system}.quarrel` to flake.nix `astalPackages`
2. Add `import Quarrel from "gi://Quarrel"` 
3. Build command tree:
   ```
   shade-shell
   ├── toggle <WIDGET>    (launcher, quicksettings, settings, clipboard, bar, windowswitcher, touchpad)
   ├── lockscreen
   ├── clipboard
   ├── screenshot [--area]
   ├── record [--area|--window|--output]
   └── settings
   ```
4. Parse: `cli.parse([programInvocationName, ...programArgs])`
5. Route to existing action handlers
6. Auto-generate `--help` output
7. Run `node --check`

### 2.4 — `src/lib/services/monitoring/monitors.ts` (rewrite)

**What:** Replace Gdk.Monitor tracking with AstalWl.

**Steps:**
1. Add `astal.packages.${system}.wl` to flake.nix `astalPackages`
2. Create `WlOutputAdapter` class wrapping `AstalWl.Output` with same interface as Gdk.Monitor:
   - `.connector` → `output.name`
   - `.description` → `output.description`
   - `.geometry` → `output.geometry`
3. Add GSettings key `general.experimental-wayland-monitors` (default `false`)
4. In `MonitorService`:
   - When flag is `true`: use `AstalWl.WlDisplay.get_default()` + `output-added`/`output-removed`
   - When flag is `false`: keep existing Gdk code (fallback)
5. `Gdk2HyprMonitor` accepts WlOutputAdapter (maps connector name to Hyprland monitor)
6. For `Astal.Window.gdkmonitor`: look up Gdk.Monitor counterpart by connector name for this single bridge
7. Remove `pendingSync` mechanism
8. Test: plug/unplug monitor, verify bars appear/disappear

---

## Batch 3: UX Enhancements (est. 6-8 hours)

### 3.1 — Frecency Manager (new files)

**Files:**
- `src/lib/services/search/frecency.ts` — scoring + tracking
- `src/lib/services/search/storage.ts` — GSettings persistence

**Implementation:**
```ts
class FrecencyManager extends GObject.Object {
  static get_default(): FrecencyManager
  
  recordLaunch(desktopId: string): void     // increment count, update timestamp
  getScore(desktopId: string): number        // compute frecencyScore
  getTopApps(limit: number): string[]        // highest-scoring desktop IDs
  getAllScores(): Map<string, number>        // for ranking search results
  
  signal "changed"  // emitted when any score changes
}
```

**Scoring formula:**
```
recencyScore = exp(-(now - lastLaunched) / (7 * 86400 * 1000))  // 7-day half-life
frecencyScore = log2(launchCount + 1) * recencyScore
```

**Steps:**
1. Create `src/lib/services/search/frecency.ts`
2. Create `src/lib/services/search/storage.ts` — GSettings key `launcher-frecency` as JSON string
3. Load on startup, persist on each launch (debounced 500ms)
4. Max 500 entries, LRU eviction
5. Add to GSettings schema in `schema.ts`
6. Add to service initialization in `src/widget/index.tsx`

### 3.2 — Launcher Frecency Integration

**What:** Modify `src/widget/applauncher/index.tsx` to use frecency.

**Steps:**
1. When search query is empty: show top-frecency apps (sorted by `frecencyScore` descending)
2. When typing: use `AstalApps.fuzzy_query()` results, then re-rank with `frecencyScore * 0.5` boost
3. On app launch: call `FrecencyManager.get_default().recordLaunch(app.entry)`
4. On clipboard item select: call `FrecencyManager.get_default().recordLaunch("clipboard:" + hash)`
5. The `AppButton` click handler records frecency before launching

### 3.3 — Collision Manager

**File:** `src/lib/services/layout/collisionManager.ts` (new)

**Steps:**
1. Create file with `CollisionManager` singleton
2. On any popup visibility change (via WindowManager signals), compute screen rectangles
3. Rectangle extraction: `window.get_current_monitor()` geometry + `window.get_position()`
4. Priority: notifications > OSD > quicksettings > launcher > screenshot UI
5. Resolve pairwise overlaps by shifting lower-priority popup
6. Integrate into `PopupWindow` — each PopupWindow registers with the collision manager on map/unmap

### 3.4 — Lockscreen Greetd Greeter Mode

**What:** New entry point for login screen at boot, using AstalGreet.

**Important:** The existing lockscreen (`src/widget/lockscreen/index.tsx`) already uses `AstalAuth.Pam` with working PAM auth and session lock protocol. This task adds a **separate mode** for greetd — a login screen at system boot, not a session lockscreen.

**Files:**
- `src/greet-main.ts` — new entry point (like `main.ts` but for greeter mode)
- `src/widget/greeter/index.tsx` — login screen widget
- `src/widget/greeter/GreetSession.ts` — AstalGreet.Greeter PAM conversation wrapper

**Steps:**
1. Add `astal.packages.${system}.greet` to flake.nix
2. Add `greetd` to `wrapperPackages`
3. Create `src/greet-main.ts` — minimal app startup without services/wallpaper/bar
4. Create `src/widget/greeter/GreetSession.ts`:
   - Wraps `AstalGreet.Greeter` with signal connections
   - Handles `visible-request`, `secret-request`, `info-message`, `error-message`, `cancelled`, `authenticated`
   - On `authenticated`: calls `greeter.start_session(["Hyprland"], env)`
5. Create `src/widget/greeter/index.tsx`:
   - Reuses clock + avatar from lockscreen UI (extract to shared component)
   - Username selector (or auto-detect from AccountsService)
   - Password entry
   - Auth status display
6. Add meson build target for greeter mode (like `share-picker-main.ts`)
7. Configure greetd: `[default_session] command = "shade-shell-greet"`
8. Install desktop file for greetd session

### 3.5 — Nix Flake Changes

**`astalPackages` additions:**
```nix
brightness  # batch 2.2
quarrel     # batch 2.3
wl          # batch 2.4
cava        # already used, now explicit
greet       # batch 3.4
```

**`wrapperPackages` changes:**
```diff
- brightnessctl
+ greetd
```

**`nativeBuildInputs` — no changes needed** (no dart-sass)

### 3.6 — GSettings Schema Additions

In `src/lib/settings/schema.ts`, add to `generalSchema`:
```ts
.key('experimental-wayland-monitors', 'b', {
    default: false,
    summary: 'Use AstalWl for Wayland-native monitor tracking',
})
```

New schema:
```ts
export const frecencySchema = new Schema({
    id: id + '.launcher',
    path: path + 'launcher/',
})
.key('frecency', 's', {
    default: '{}',
    summary: 'Frecency data for app launcher (JSON)',
});
```

---

## Execution Order

```
Phase 1 — Foundations (no widget changes)
  ├── 1.1 useStyle.ts           ← pure new file
  ├── 1.2 theme.ts              ← pure new file
  ├── 1.3 palette.ts            ← new file, deletes theming.ts
  ├── 1.4 reset.css + shade.css shrink
  └── Nix flake: add all new astalPackages

Phase 2 — Abstractions (change widget files)
  ├── 2.1 PopupWindow.tsx       ← new file
  ├── 2.1 adopt in applauncher
  ├── 2.1 adopt in osd
  ├── 2.1 adopt in quicksettings
  ├── 2.1 adopt in notifications
  ├── 2.1 adopt in region-selector
  ├── 2.1 adopt in screenshot-ui
  └── 1.5 CSS migration (useStyle in each widget)

Phase 3 — Service rewrites (isolated changes)
  ├── 2.2 brightness.ts rewrite
  ├── 2.3 requestHandler.ts rewrite  
  └── GSettings schema additions

Phase 4 — New features
  ├── 3.1 frecency.ts + storage.ts
  ├── 3.2 launcher frecency integration
  ├── 3.3 collisionManager.ts
  └── 3.4 greetd greeter mode

Phase 5 — AstalWl (highest risk, last)
  └── 2.4 monitors.ts rewrite (feature-flagged)
```

Phases are sequential (each depends on the previous). Within a phase, items are independent and can be done in parallel where noted.

---

## Testing per Phase

| Phase | Test approach |
|---|---|
| 1 | Visual: run shell, verify CSS still renders. theme.ts: check dark/light toggle. |
| 2 | Per-widget: toggle each popup, verify margins, ESC dismiss, bar-overlap avoidance |
| 3 | brightness: change via OSD, verify. quarrel: run `shade-shell --help`. |
| 4 | Frecency: launch apps multiple times, verify empty-search shows them. Greet: run greetd session. |
| 5 | Plug/unplug monitor, verify bars appear/disappear. Toggle feature flag, verify rollback. |

---

## Rollback Strategy

- **AstalWl**: GSettings flag instantly reverts to Gdk tracking. No code change needed.
- **useStyle**: if a widget's styles break, inline a `Gtk.CssProvider.load_from_string()` as fallback. 
- **AstalGreet**: greeter mode is a separate entry point. Session lockscreen unchanged.
- **Everything else**: git revert per-batch commits.

---

## Estimated Totals

| Metric | Count |
|---|---|
| New files | 10 |
| Modified files | ~18 |
| Deleted files | 1 (theming.ts) |
| New Nix packages | 5 |
| New GSettings keys | 2 |
| Total time estimate | 14-18 hours |
