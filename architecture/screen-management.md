# Screen Management System — Architecture Plan

## Overview

A unified, shadé-native screen management system that replaces the current ad-hoc
screenshot/recording approach with a GNOME-style interactive overlay, while adding
screen freeze, recording indicators, virtual monitors, and a custom share picker.

---

## 1. Current Architecture

```
Print Screen (Hyprland keybind)
    │
    ▼
hyprshot (external tool)
    │
    ▼
grim + slurp (external tools)
    │
    ▼
Screenshot saved to ~/Pictures/Screenshots

D-Bus command (shade-shell screenshot/record)
    │
    ▼
requestHandler.ts ──► Screenshot class ──► grim/wf-recorder/slurp
                         │
                     Signals: recordingStarted, recordingStopped
                     Properties: recording, recordingElapsed, audio
                         │
            ┌────────────┼──────────────┐
            ▼            ▼              ▼
      Bar indicator  QS popover   Notifications
```

**What's good:** Clean GObject backend with reactive bindings.
**What's missing:** Interactive overlay UI, freeze, recording boundary, share picker,
virtual monitors, wl-screenrec support.

---

## 2. Target Architecture

```
Print Screen
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│              Screenshot Overlay (Astal.Window OVERLAY)        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [Screenshot]  [Recording]                  [Settings]  │  │
│  │ [Fullscreen] [Area] [Window] [Monitor]                 │  │
│  │ [  ] Audio  [  ] Virtual Monitor    [⏺ Capture]      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
    │
    ├──► Screenshot: wayfreeze (freeze) → show frozen frame → select → grim
    ├──► Recording:  wl-screenrec or wf-recorder + boundary + bar
    ├──► Area:       GTK4 custom region selector (replaces slurp)
    ├──► Virtual:    hyprctl output create → record headless output
    └──► Share:      custom picker launched by XDPH (replaces Qt picker)

Recording active:
┌──────────────────────────────────────────────┐
│  🔴 REC  [elapsed timer]  🎙  [⏹ Stop]      │  ← Recording Bar (OSD layer)
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │
│  │    Red border around recorded area    │   │  ← Red Boundary (OVERLAY layer)
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │
└──────────────────────────────────────────────┘
```

---

## 3. Data Structures

### 3.1. Core State — ScreenManager (replaces Screenshot class)

```typescript
// src/lib/screenManager.ts

enum CaptureMode {
  SCREENSHOT = "screenshot",
  RECORDING = "recording",
}

enum CaptureTarget {
  FULLSCREEN = "fullscreen",
  AREA = "area",
  WINDOW = "window",
  MONITOR = "monitor",
}

enum RecorderBackend {
  WF_RECORDER = "wf-recorder",
  WL_SCREENREC = "wl-screenrec",
}

interface RecordingSession {
  id: string
  process: Process
  backend: RecorderBackend
  startTime: number
  filePath: string
  geometry?: string
  output?: string
  audio: boolean
  virtualMonitor?: VirtualMonitor
}

interface VirtualMonitor {
  name: string              // e.g. "HEADLESS-1"
  resolution: string        // e.g. "1920x1080"
  fps: number
}

interface SharePickerResult {
  type: "monitor" | "window" | "region"
  target: string            // monitor name, window address, or geometry
  geometry?: string
}

interface ScreenManagerState {
  // Recording state
  recording: boolean
  recordingElapsed: number
  recordingSession: RecordingSession | null
  recordedFile: string | null

  // Audio
  audioEnabled: boolean

  // Virtual monitors
  virtualMonitors: VirtualMonitor[]

  // Share tracking (what's being shared with Discord/OBS)
  activeShares: Array<{
    id: string
    type: "monitor" | "window" | "region"
    target: string
    appName: string
  }>

  // UI
  overlayOpen: boolean       // capture toolbar visibility
  freezeActive: boolean      // wayfreeze running
  boundaryVisible: boolean   // red recording boundary
  selectedMode: CaptureMode
  selectedTarget: CaptureTarget
  regionSelectorOpen: boolean

  // Preferences
  recorderBackend: RecorderBackend
  screenshotFormat: "png" | "jpg"
  screenshotDir: string
  recordingDir: string
}

// Reactive GObject signals:
// - notify::recording
// - notify::recording-elapsed
// - notify::audio
// - recording-started
// - recording-stopped
// - share-started
// - share-stopped
// - overlay-shown
// - overlay-hidden
// - freeze-activated
// - freeze-deactivated
```

### 3.2. Settings Schema (GSettings)

```xml
<!-- Screenshot settings -->
<key name="recorder-backend" type="i">
  <default>0</default>   <!-- 0 = wl-screenrec, 1 = wf-recorder -->
  <summary>Recording backend (wl-screenrec or wf-recorder)</summary>
</key>
<key name="screenshot-format" type="i">
  <default>0</default>   <!-- 0 = png, 1 = jpg -->
</key>
<key name="record-audio" type="b">
  <default>true</default>
</key>
<key name="show-recording-boundary" type="b">
  <default>true</default>
</key>
<key name="recording-boundary-color" type="s">
  <default>"#FF0000"</default>
</key>
<key name="virtual-monitor-resolution" type="s">
  <default>"1920x1080"</default>
</key>
<key name="virtual-monitor-fps" type="i">
  <default>60</default>
</key>
```

### 3.3. Widget State

```typescript
// src/widget/screenshot-overlay/state.ts
interface ScreenshotOverlayState {
  visible: boolean
  mode: "screenshot" | "recording"
  target: "fullscreen" | "area" | "window" | "monitor"
  audio: boolean
  virtualMonitor: boolean
  virtualMonitorResolution: string
  timerDelay: number    // 0 = instant, 3, 5, 10 seconds
  freezeEnabled: boolean
}

// src/widget/recording-bar/state.ts
interface RecordingBarState {
  visible: boolean
  elapsed: number
  audioActive: boolean
  backendLabel: string
}

// src/widget/recording-boundary/state.ts
interface RecordingBoundaryState {
  visible: boolean
  geometry: { x: number; y: number; width: number; height: number } | null
  color: string
}

// src/widget/share-picker/state.ts
interface SharePickerState {
  visible: boolean
  monitors: Array<{ name: string; description: string; geometry: string }>
  windows: Array<{ address: string; title: string; appClass: string; geometry: string }>
  selected: SharePickerResult | null
  tokenRestore: boolean
}
```

---

## 4. Component Tree

```
src/
├── lib/
│   ├── screenManager.ts       ← New: replaces screenshot.ts (GObject singleton)
│   ├── virtualMonitor.ts      ← New: hyprctl headless output management
│   ├── regionSelector.ts      ← New: GTK4 region selection (replaces slurp)
│   ├── sharePickerProtocol.ts ← New: XDPH custom picker stdout protocol
│   ├── shotwell.ts            ← New: screenshot/image utilities
│   ├── screenshot.ts          ← REFACTOR: slim down, delegate to screenManager
│   ├── process.ts             ← Unchanged
│   └── requestHandler.ts      ← UPDATE: add overlay action
│
├── widget/
│   ├── screenshot-overlay/    ← NEW: main capture toolbar
│   │   ├── index.tsx          ← Astal.Window with floating toolbar
│   │   ├── mode-toggle.tsx    ← Screenshot/Recording tab bar
│   │   ├── target-picker.tsx  ← Fullscreen/Area/Window/Monitor buttons
│   │   ├── options-bar.tsx    ← Audio, virtual monitor, timer options
│   │   └── capture-button.tsx ← The big capture/start button
│   │
│   ├── recording-bar/         ← NEW: OSD-style recording indicator
│   │   ├── index.tsx          ← Astal.Window anchored bottom
│   │   └── timer-label.tsx    ← Elapsed time formatter
│   │
│   ├── recording-boundary/    ← NEW: red border around recorded area
│   │   ├── index.tsx          ← Astal.Window transparent overlay
│   │   └── border.tsx         ← Cairo/GTK drawing of border
│   │
│   ├── region-selector/       ← NEW: custom GTK4 region picker
│   │   ├── index.tsx          ← Fullscreen overlay with selection
│   │   ├── selection-box.tsx  ← Draggable/resizable rectangle
│   │   ├── window-hints.tsx   ← Window boundary highlights
│   │   └── guides.tsx         ← Alignment guides
│   │
│   ├── share-picker/          ← NEW: XDPH custom share picker
│   │   ├── index.tsx          ← Astal.Window for share selection
│   │   ├── monitor-tab.tsx    ← Monitor list with thumbnails
│   │   ├── window-tab.tsx     ← Window list with thumbnails
│   │   └── region-tab.tsx     ← Region selection button
│   │
│   ├── bar/indicators/
│   │   └── recording.tsx      ← UPDATE: link to screenManager
│   │
│   └── quicksettings/button-grid/
│       └── screenshot.tsx     ← UPDATE: link to overlay instead of direct actions
│
└── nix/
    ├── home/default.nix        ← UPDATE: deps
    ├── hyprland/binds.nix      ← UPDATE: Print Screen keybind
    └── hyprland/default.nix    ← UPDATE: XDPH custom_picker_binary config
```

---

## 5. Integration Points

### 5.1. Request Handler (`src/lib/requestHandler.ts`)

New actions:
```
screenshot-overlay     → toggle overlay visibility
share-picker           → launch share picker (for custom use)
create-vmon            → create virtual monitor
remove-vmon            → remove virtual monitor
```

### 5.2. Keybindings (`nix/hyprland/binds.nix`)

Current → New:
```
, PRINT → hyprshot -m output           → shade-shell screenshot-overlay
SUPER, PRINT → hyprshot -m window       → (handled in overlay UI)
SUPERSHIFT, PRINT → hyprshot -m region  → (handled in overlay UI)
SUPERALT, R → shade-shell record        → (kept as quick shortcut)
SUPERSHIFT, S → shade-shell screenshot-area → (kept)
```

New:
```
SUPER, PRINT → shade-shell screenshot-overlay   # Open overlay
SUPERALT, PRINT → shade-shell screenshot-overlay # Open overlay + start recording
```

### 5.3. XDPH Config (`nix/hyprland/default.nix`)

```nix
# Add custom_picker_binary pointing to shade-shell's share picker
# The share picker is launched as: shade-shell share-picker
```

This requires creating a small executable that outputs the share selection
in the format XDPH expects. The shade-shell share picker will be a GJS
script or a compiled binary that implements the XDPH picker protocol.

### 5.4. Settings

New GSettings schema `com.caioasmuniz.shade_shell.screen-capture` added to
`src/lib/gschema.ts` and the corresponding schema XML.

### 5.5. Widget Mount Order

```typescript
// src/widget/index.tsx
safe("screenshot-overlay", screenshotOverlay)  // After OSD, before lockscreen
safe("recording-bar", recordingBar)             // Alongside OSD
safe("recording-boundary", recordingBoundary)   // Alongside wallpaper
safe("share-picker", sharePicker)               // Lazy, only when XDPH calls
```

Widget mount order (current: wallpaper → bar → dock → osd → applauncher →
quicksettings → lockscreen → windowswitcher → notifications → settings):
- Add recording-boundary after wallpaper (behind everything, transparent)
- Add screenshot-overlay after applauncher (floating toolbar)
- Add recording-bar alongside OSD (bottom anchored)
- Add share-picker lazily (not part of initial mount, spawned on demand)

---

## 6. Data Flow Diagrams

### 6.1. Screenshot Flow

```
User presses Print Screen
    │
    ▼
requestHandler → screenManager.showOverlay()
    │
    ▼
screenshot-overlay widget appears (Astal.Window OVERLAY, centered toolbar)
    │
    ▼
User picks: Screenshot → Area
    │
    ▼
screenManager.startFreeze() → spawns wayfreeze (screen frozen)
    │
    ▼
region-selector widget appears on top of frozen frame
  (fullscreen Astal.Window with Gtk drawing overlay)
    │
    ▼
User drags to select region
    │
    ▼
User clicks Capture
    │
    ▼
screenManager.captureScreenshot({ area, fullscreen, window })
  → grim -g geometry filename.png
  → wl-copy < filename.png
  → wayfreeze exits
  → all overlays close
  → notification: "Screenshot saved"
```

### 6.2. Recording Flow

```
User presses Print Screen → Overlay
    │
    ▼
User picks: Recording → Monitor → Select "DP-1" → Audio ON → Virtual Monitor OFF
    │
    ▼
screenManager.startRecording({ output: "DP-1", audio: true })
  ├── wl-screenrec -o DP-1 -f recording.mp4 --audio
  ├── recording-bar appears (🔴 REC + elapsed timer + stop button)
  ├── recording-boundary appears (red border around DP-1)
  └── Bar indicator updates (shows elapsed time)
    │
    ▼
User clicks Stop (in bar, recording-bar, or QS popover)
    │
    ▼
screenManager.stopRecording()
  ├── wl-screenrec process receives SIGINT
  ├── recording-bar hides
  ├── recording-boundary hides
  └── Notification: "Recording saved: recording.mp4 (2m 34s)"
```

### 6.3. Share Picker Flow

```
Discord requests screen share
    │
    ▼
XDPH detects custom_picker_binary → launches: shade-shell share-picker
    │
    ▼
share-picker widget appears (Astal.Window)
  Reads XDPH_WINDOW_SHARING_LIST env var
  Gets monitor info from AstalHyprland
  Gets window thumbnails via hyprctl
    │
    ▼
User selects a monitor/window
    │
    ▼
Picker prints to stdout:
  [SELECTION]r/screen:DP-1
    │
    ▼
XDPH receives selection, starts PipeWire screencast session
    │
    ▼
screenManager registers active share:
  activeShares.push({ id: "xdp-1", type: "monitor", target: "DP-1", appName: "Discord" })
    │
    ▼
If boundary enabled → recording-boundary shows border around DP-1
    │
    ▼
Discord stops sharing → XDPH destroys session
  → screenManager removes active share
  → boundary hides
```

### 6.4. Virtual Monitor Flow

```
User wants to record a game
    │
    ▼
Overlay: Recording → Monitor → [x] Virtual Monitor → Resolution: 2560x1440 @ 144fps
    │
    ▼
screenManager.createVirtualMonitor({ resolution: "2560x1440", fps: 144 })
  ├── hyprctl output create headless SHADE-VMON-1
  ├── hyprctl keyword monitor SHADE-VMON-1,2560x1440@144,auto-right,1
  ├── Returns VirtualMonitor { name: "SHADE-VMON-1", ... }
    │
    ▼
screenManager.startRecording({ output: "SHADE-VMON-1" })
  └── Recording proceeds on virtual output
    │
    ▼
Recording stops
  ├── hyprctl output remove SHADE-VMON-1
  └── Virtual monitor cleaned up
```

---

## 7. Implementation Phases

### Phase 1: Foundation (refactor + overlay)
1. Refactor `screenshot.ts` → `screenManager.ts` with clean state management
2. Add GSettings schema for screen capture preferences
3. Build `screenshot-overlay` widget (floating toolbar)
4. Update keybinds to point to overlay
5. Wire `requestHandler` with overlay toggle
6. Remove `hyprshot` dependency

### Phase 2: Freeze + Custom Region Selector
7. Add `wayfreeze` to dependencies
8. Build `region-selector` widget (fullscreen GTK4 overlay)
9. Implement freeze → select → capture flow
10. Update `screenManager` to use custom selector instead of slurp
11. Potentially remove `slurp` dependency

### Phase 3: Recording UX
12. Build `recording-bar` widget (OSD-style indicator)
13. Build `recording-boundary` widget (red border overlay)
14. Integrate `wl-screenrec` backend
15. Add virtual monitor support (`virtualMonitor.ts`)
16. Settings for backend selection (wf-recorder vs wl-screenrec)

### Phase 4: Share Picker
17. Build `share-picker` widget
18. Implement XDPH `custom_picker_binary` protocol
19. Wire thumbnail generation
20. Track active shares + show boundaries for active shares

---

## 8. Dependency Review

### Current dependencies (`nix/home/default.nix`):

| Package | Status | Notes |
|---------|--------|-------|
| `hyprshot` | **REMOVE** (Phase 1) | Replaced by our overlay + grim |
| `wl-clipboard` | **KEEP** | Used for clipboard copy |
| `qalculate-gtk` | Keep (unrelated) | Calculator |
| `wf-recorder` | **KEEP** | Fallback recorder backend |
| `wl-screenrec` | **KEEP/PROMOTE** | Make primary GPU-accelerated backend |
| `cliphist` | Keep (unrelated) | Clipboard history |
| `wl-clip-persist` | Keep (unrelated) | Clipboard persistence |
| `brightnessctl` | Keep (unrelated) | Brightness control |
| `playerctl` | Keep (unrelated) | Media player control |
| `libnotify` | Keep (unrelated) | Notifications |

### Proposed additions:

| Package | Phase | Notes |
|---------|-------|-------|
| `wayfreeze` | Phase 2 | Screen freeze, already in nixpkgs |
| `jq` | Phase 3 | JSON parsing for hyprctl (may already be available) |

### Potential removals:

| Package | Phase | Rationale |
|---------|-------|-----------|
| `hyprshot` | Phase 1 | Our overlay replaces all its functionality |
| `slurp` | Phase 2 | Custom GTK4 region selector replaces it |
| `grim` | Phase 2 | Could keep as capture backend, or write our own wlr-screencopy capture |

### Notes on `wayfreeze`

Already packaged in nixpkgs. Simple CLI tool:
```
wayfreeze                 # Freezes screen until click/escape
wayfreeze --hide-cursor   # Without cursor in frozen frame
```
Runs as a layer-shell window overlaying the last compositor frame.
We launch it, then show our GTK overlays on top.

### Notes on `wl-screenrec` vs `wf-recorder`

| Feature | wl-screenrec | wf-recorder |
|---------|-------------|-------------|
| CPU usage (4kp60) | ~2.5% | ~500% (software) / ~75% (VAAPI) |
| GPU encoding | Native | `-c h264_vaapi` |
| Audio support | `--audio` | `-a` |
| Region capture | `-g` | `-g` |
| Output capture | `-o` | `-o` |
| Damage tracking | Yes | `--no-damage` |
| History buffer | `--history` | No |
| In nixpkgs | Yes | Yes |

**Recommendation:** `wl-screenrec` as primary, `wf-recorder` as fallback.

---

## 9. Key Architectural Decisions

### Why a new `screenManager.ts` instead of extending `screenshot.ts`?
The current `Screenshot` class mixes concerns (capture execution, state, UI
coordination). The new `ScreenManager` separates:
- **State** → GObject reactive properties + signals
- **Capture execution** → grim/wf-recorder/wl-screenrec orchestration
- **UI coordination** → showing/hiding overlays, freeze, boundary

### Why custom GTK4 region selector instead of slurp?
Full control over appearance (shadé themed colors, rounded corners, animations),
no external dependency, keyboard-navigable, integrates with our freeze overlay.

### Why not a Hyprland compositor plugin for freeze?
HyprCapture already does this, but it's Qt-based and a separate project.
`wayfreeze` is simpler, works without plugin, and is already in nixpkgs.

### Why build our own share picker instead of using alternatives?
- `hyprland-preview-share-picker` is Rust-based and well done, but can't be themed
  with shadé's Libadwaita styles
- `rofi-xdph` is too minimal
- A shadé-native picker gets the same theming, animations, and window management
  that all other widgets have

---

## 10. Migration Path

```
Current state → Phase 1 → Phase 2 → Phase 3 → Phase 4
                   │         │         │         │
                overlay    freeze    bar +      share
                toolbar    + custom  boundary   picker
                           region    + vmon
                           picker    + wl-screenrec
```

Each phase is independently deployable and doesn't break existing functionality.
