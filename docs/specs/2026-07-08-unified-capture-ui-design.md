# Unified Screen Capture, Recording & Share UI — Design Spec

**Date:** 2026-07-08
**Author:** AI-assisted design (user + dshell analysis)
**Status:** Draft — pending user review

---

## 1. Problem & Scope

The dshell currently has three separate screen-capture subsystems that overlap in functionality:

| Subsystem | File(s) | UI Style | Purpose |
|-----------|---------|----------|---------|
| `screenshot-ui` | `src/widget/screenshot-ui/index.tsx` | Fullscreen overlay | Screenshot + recording with frozen preview, area/window selection |
| `screenshot-overlay` | `src/widget/screenshot-overlay/index.tsx` | Centered toolbar overlay | Simple screenshot + recording toolbar (legacy) |
| `share-picker-main` | `src/share-picker-main.ts` | Standalone GTK window | XDPH screen/window picker with live grim thumbnails |
| `recording-bar` | `src/widget/recording-bar/index.tsx` | Bottom-right floating bar | REC indicator + elapsed timer + stop button |
| `recording-boundary` | `src/widget/recording-boundary/index.tsx` | Per-monitor dashed overlay | Red border around recorded area |
| QS button | `src/widget/quicksettings/button-grid/screenshot.tsx` | Popover | Screenshot/recording quick actions + audio/format toggles |
| Bar indicator | `src/widget/bar/indicators/recording.tsx` | Bar button | REC + elapsed time in the bar |

**This design extends `screenshot-ui`** (the newest, most capable overlay) into a unified capture hub that replaces `screenshot-overlay` and absorbs `recording-bar` while the share-picker continues as a separate process but shares UI components.

**New capability added:** Active screen share detection via AstalWp PipeWire streams, shown in the bar.

---

## 2. Architecture

### 2.1 After Changes

```
dshell widgets/processes:

  screenshot-ui (overlay)         ← extended with all capture features
    ├── preview thumbnails         (live grim polling per monitor)
    ├── audio source picker        (AstalWp microphones dropdown)
    ├── format + quality selector  (MP4/WebM + Low/Med/High)
    ├── recording boundary toggle    (existing boundary system)
    └── unified mode/target    (screenshot OR recording, any target)

  bar/indicators/
    ├── recording.tsx             ← existing (dshell's own recordings)
    └── screenShare.tsx           ← NEW (AstalWp stream detector)

  recording-boundary              ← stays as-is (per-monitor dashed overlay)

  share-picker-main (process)     ← improved, shares preview component

  quicksettings/screenshot.tsx    ← stays as-is (quick actions popover)
```

### 2.2 Files to Create

| Path | Purpose |
|------|---------|
| `src/lib/screenShareDetector.ts` | GObject that watches AstalWp for active SCREEN streams |
| `src/widget/bar/indicators/screenShare.tsx` | Bar widget for share indicator |
| `src/widget/screenshot-ui/preview.tsx` | Reusable preview thumbnail card component |
| `src/widget/screenshot-ui/audioSourcePicker.tsx` | Audio source dropdown component |
| `src/widget/screenshot-ui/formatQualitySelector.tsx` | Format + quality controls |

### 2.3 Files to Modify

| Path | Changes |
|------|---------|
| `src/lib/screenshot.ts` | Add: `selectedAudioInput` (int node id), `recordingQuality` (0-2), `previewThumbnailsEnabled`, `#audioInputName` |
| `src/lib/gschema.ts` | Add: `audio-input-id`, `recording-quality`, `preview-thumbnails-enabled` |
| `src/lib/screenCaptureSettings.ts` | Wire new gschema keys |
| `src/widget/screenshot-ui/index.tsx` | Major extension: collapsible options, preview strip, audio picker, format/quality, share-like thumbnails |
| `src/widget/bar/indicators/recording.tsx` | Enhanced to show share stream name and accept a stop signal |
| `src/widget/index.tsx` | Remove `screenshot-overlay` from mount list, register `screenShare` |

### 2.4 Files to Remove

| Path | Reason |
|------|--------|
| `src/widget/screenshot-overlay/index.tsx` | Replaced by enhanced `screenshot-ui` |
| `src/widget/recording-bar/index.tsx` | Absorbed into overlay (stop button lives in overlay + bar indicator) |

### 2.5 Files to Improve (not replace)

| Path | Changes |
|------|---------|
| `src/share-picker-main.ts` | Import shared `preview.tsx` component for thumbnails, add audio source dropdown to recording tab |

---

## 3. screenshot-ui Overlay — Detailed Layout

The toolbar card floats at the top center of the fullscreen dim overlay. Sections collapse to keep the default UI compact.

### 3.1 Default (Collapsed) State

```
┌──────────────────────────────────────┐
│ [Screenshot] [Record]                │  ← mode toggle
│ ──────────────────────────────────── │
│ [Fullscreen] [Area] [Window] [Mon.] │  ← target picker
│ ──────────────────────────────────── │
│ ▶ Options                           │  ← expandable section
│ ──────────────────────────────────── │
│ ┌──────── Take Screenshot ────────┐│  ← capture button
│ ──────────────────────────────────── │
│ Esc to cancel · Enter to capture    │
└──────────────────────────────────────┘
```

### 3.2 Expanded (Recording Mode + Options Open)

```
┌──────────────────────────────────────┐
│ [Screenshot] [Record]                │
│ ──────────────────────────────────── │
│ [Fullscreen] [Area] [Window] [Mon.] │
│ ──────────────────────────────────── │
│ ▼ Options                            │
│ ┌──────────────────────────────────┐│
│ │ Audio: [🎤 Default Mic ▾]       ││
│ │ Format: [MP4 ●] [WebM ○]        ││
│ │ Quality: ──●─────────────[Low][Med][High]│
│ │ Boundary: [✓] Show red border   ││
│ │ Preview: [✓] Live thumbnails    ││
│ └──────────────────────────────────┘│
│ ──────────────────────────────────── │
│ [┌──── Start Recording ────────┐]   │
│ ──────────────────────────────────── │
│ Esc to cancel · Enter to capture    │
└──────────────────────────────────────┘
```

### 3.3 Preview Thumbnail Strip (bottom of overlay)

When Preview is enabled, a horizontal scrollable strip appears at the very bottom of the screen:

```
┌─────────────────────────────────────────────┐
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  ← → │
│ │ DP-1 │ │ DP-2 │ │Firefx│ │Term  │       │
│ │1920x │ │1080p │ │1720x │ │ 800x │       │
│ │1080  │ │      │ │ 1080 │ │ 600  │       │
│ └──────┘ └──────┘ └──────┘ └──────┘       │
└─────────────────────────────────────────────┘
```

- **Monitors**: polled continuously (staggered, ~200ms per monitor)
- **Windows**: captured once when strip opens or on explicit refresh
- **Click** a thumbnail → sets that as the active target
- **Scrollable** — overflow via horizontal ScrolledWindow
- Card size: 200×120px, showing monitor/window name + resolution

---

## 4. Live Preview Component (`preview.tsx`)

Shared between overlay and share-picker process.

```typescript
interface PreviewCardProps {
  kind: 'monitor' | 'window';
  name: string;
  subtitle: string;    // e.g. "1920×1080" or class name
  imagePath: string;     // path to grim PNG
  onClick: () => void;
}
```

Returns a Gtk.Button with Gtk.Picture + labels in a compact card. The component handles texture loading (via Gdk.Texture.new_from_filename) and re-renders when the file at `imagePath` changes.

### Polling Strategy

- **Monitors**: `GLib.timeout_add` at 200ms staggered — each tick captures 1 monitor, cycling through the list. This prevents hammering grim with N concurrent captures.
- **Windows**: Captured once on demand (too expensive to poll all windows continuously). A refresh button in the strip triggers re-capture.
- **Cleanup**: Temp PNGs are cleaned when the overlay closes or on app shutdown.
- The poll timer lives inside the overlay widget; the share-picker process has its own timer.

---

## 5. Audio Source Selection

### Data Source

`AstalWp.get_default().audio` provides:
- `microphones: Endpoint[]` — all available input endpoints
- `defaultMicrophone: Endpoint` — system-selected default

### UI

A `Gtk.DropDown` populated with the microphones list. Each item shows:
- Icon from endpoint's `icon` property (e.g. `audio-input-microphone-symbolic`)
- Description from endpoint's `description` property

### Persistence

- Selected mic ID stored in gschema key `audio-input-id` (int, default -1 = use system default)
- When `-1` (default), the recording backend uses its standard `--audio` flag
- When a specific ID is set, we pass backend-specific arguments:
  - `wf-recorder`: `--audio=pipewire_node.restore.id=<id>`
  - `wl-screenrec`: `--audio-device=<node_id>` (or via PipeWire node name)

### Recording Backend Integration

The `startRecording()` method in `screenshot.ts` already accepts options. Add `audioInputId` to the options interface. The arg builder (`buildRecordingArgs`) gets an additional `audioInput` parameter. When it's set to a specific node ID, the backend args change accordingly.

---

## 6. Format + Quality Selection

### Format (already exists)

| Value | Format | Backend args |
|-------|--------|------|
| 0 | MP4 (H.264+AAC) | Default — no special args |
| 1 | WebM (VP9+Opus) | `wl-screenrec`: `--codec vp9` · `wf-recorder`: `-c libvpx -C libopus` |

### Quality (NEW)

3-level simple preset, stored in gschema `recording-quality`:

| Value | Label | wl-screenrec args | wf-recorder args |
|------|------|-------------------|-----------------|
| 0 | Low | `--quality 3` | `--codec-param crf=33` |
| 1 | Medium | `--quality 5` (default) | `--codec-param crf=28` |
| 2 | High | `--quality 8` | `--codec-param crf=23` |

UI: Three Gtk.ToggleButtons in a linked group: [Low] [Med] [High]. Default = Medium.

---

## 7. Recording Boundary

### Already Existing

`recording-boundary/index.tsx` — per-monitor dashed red overlay. Works well.

### Changes

- **Preview boundary:** When the user selects an area/window in recording mode, show the boundary BEFORE recording starts (on the frozen frame overlay). This gives visual confirmation of what will be recorded.
- **Color picker**: Add a color picker in the overlay Options section (a Gtk.ColorButton bound to `recording-boundary-color` gschema key).

---

## 8. Screen Share Detection (Bar Indicator)

### New file: `src/lib/screenShareDetector.ts`

A `GObject.Object` singleton that monitors AstalWp for screen-sharing activity:

```typescript
@register({GTypeName: 'ScreenShareDetector'})
class ScreenShareDetector extends GObject.Object {
  #activeShares: ShareStream[] = [];
  
  @getter(Boolean) get isScreenSharing(): boolean;  // any active share
  @getter(Array) get activeShares(): ShareStream[];  // detailed list
  @getter(Number) get shareCount(): number;          // how many concurrent shares
}

interface ShareStream {
  appName: string;         // from stream.description
  appIcon: string;         // from stream.icon
  mediaRole: MediaRole;    // SCREEN, COMMUNICATION, etc.
  nodeId: number;
  duration: number;        // ms since stream appeared
}
```

### Detection Logic

- Subscribe to `audio.stream-added` and `audio.stream-removed` signals
- Inspect each stream's `mediaRole` — look for `MediaRole.SCREEN`
- Also check `mediaClass` — `STREAM_INPUT_VIDEO` indicates video/screen sharing
- Track duration locally (interval timer)

The detector is initialized in `widget/index.tsx` alongside other services.

### Bar Widget: `screenShare.tsx`

```
[ Gtk.Button ]
  Icon: video-display-symbolic (when active)
  Color: #FF6600 (orange for external shares)
  Pulsing CSS animation while sharing
  Tooltip: "Screen sharing in Discord"

[ Click → Popover ]
  ┌──────────────────────────┐
  │ Active shares:         │
  │ ┌──────────────────┐ │
  │ │ 🎮 Discord        │ │
  │ │ Screen: DP-1      │ │
  │ │ 00:03:12          │ │
  │ └──────────────────┘ │
  └──────────────────────────┘
```

The existing `recording.tsx` bar indicator stays as-is for dshell's own recordings (with the REC icon and elapsed timer). The two indicators sit side by side in the bar's system indicators area.

---

## 9. share-picker Improvements

`share-picker-main.ts` is a standalone GJS process launched by XDPH. We cannot turn it into a dshell widget (XDPH requires a separate process with stdin/stdout protocol). Instead:

### Shared Components

The `preview.tsx` component is defined as a **regular function/module**, not tied to any GObject class, making it importable from both the dshell overlay and the share-picker process. Both import `PreviewCard` and `PollManager` from a shared path.

### Additions to share-picker

- **Audio source dropdown** on the recording tab (informational — XDPH doesn't pass audio through, but shows the option)
- **Live preview polling** using the same staggered-200ms-per-monitor strategy
- **Better thumbnails**: larger default size (320×180) with click-to-select flow
- **Quality selector**: shown for informational purposes / future XDPH protocol extensions

---

## 10. GSchema Additions

New keys in the `com.caioasmuniz.shade_shell.screen-capture` schema:

```typescript
.key('audio-input-id', 'i', {
  default: -1,
  summary: 'PipeWire node ID for recording audio input (-1 = system default)',
})
.key('recording-quality', 'i', {
  default: 1,
  summary: 'Recording quality preset (0=Low, 1=Medium, 2=High)',
})
.key('preview-thumbnails-enabled', 'i', {
  default: 1,
  summary: 'Show live preview thumbnails in capture overlay (0=off, 1=on)',
})
```

---

## 11. State Additions to Screenshot class

New properties on `Screenshot` (in `src/lib/screenshot.ts`):

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `selectedAudioInput` | int (gproperty) | -1 | PipeWire node ID or -1 for default |
| `selectedAudioInputName` | string (gproperty) | `"System Default"` | Human-readable name for display |
| `recordingQuality` | int (gproperty) | 1 | Quality preset 0-2 |
| `previewThumbnails` | bool (gproperty) | true | Whether preview strip is shown |
| `#pollTimer` | number \| null | null | Internal: active poll timer ID |
| `#previewPictures` | Map<string, Gtk.Picture> | - | Internal: temp PNG paths → Picture widgets |

---

## 12. Migration / Removals

### `screenshot-overlay` removal

- Remove from `src/widget/index.tsx` widget descriptors
- Remove `WindowManager.setOverlay()` call from its JSX
- Delete the file entirely
- The `'screenshot-overlay'` action in `requestHandler.ts` routes to `screenshot.toggleOverlay()`, which opens `screenshot-ui` (via `overlayOpen` setter)

### `recording-bar` removal

- Remove from `src/widget/index.tsx` widget descriptors
- Delete the file
- The stop button now lives in the overlay's capture button (changes to "Stop Recording" when recording is active)
- The bar's `recording.tsx` indicator keeps the elapsed timer and stop functionality

---

## 13. Implementation Order

1. **GSchema**: Add new keys → regenerate type definitions
2. **screenshot.ts properties**: Add selectedAudioInput, recordingQuality, previewThumbnails
3. **screenShareDetector.ts**: New file, watch AstalWp streams
4. **Shared components**: preview.tsx, audioSourcePicker.tsx, formatQualitySelector.tsx
5. **screenshot-ui extension**: Collapsible options, preview strip, audio picker, format/quality
6. **Recording boundary preview**: Show on frozen frame before recording
7. **Bar indicator**: screenShare.tsx widget
8. **share-picker improvements**: Use shared preview component, add audio dropdown
9. **Removals**: screenshot-overlay, recording-bar
10. **Widget index cleanup**: Register new widgets, remove old ones

---

## 14. Open Questions / Future

- **Audio in share-picker**: XDPH protocol v4 currently doesn't support audio selection. When v5 lands, the UI is ready.
- **Virtual cameras**: Future work — wire virtual camera support (wlr-screencopy-virtcam) into the same overlay.
- **Region selection**: The current `region-selector` widget works independently via `openRegionSelectorForCapture`. No immediate changes needed — it triggers correctly from the overlay.