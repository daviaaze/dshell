# Unified Screen Capture UI — Implementation Plan

**Date:** 2026-07-08
**Based on:** `docs/specs/2026-07-08-unified-capture-ui-design.md`
**Status:** Ready for execution

---

## Overview

This plan implements the unified capture UI design by extending `screenshot-ui` with live preview thumbnails, audio source selection, format/quality controls, and a screen share detector bar indicator. It removes `screenshot-overlay` and `recording-bar`, and improves `share-picker-main` with shared components.

---

## Phase 1: Foundation (GSchema + Screenshot State)

### Task 1.1: Add GSchema keys

**File:** `src/lib/gschema.ts`

Add three new keys to `screenCaptureSchema` after the existing `overlay-freeze-enabled` key:

```typescript
.key('audio-input-id', 'i', {
    default: -1,
    summary: 'PipeWire node ID for recording audio input (-1 = system default)',
})
.key('recording-quality', 'i', {
    default: 1,
    summary: 'Recording quality preset (0=Low, 1=Medium, 2=High)',
})
.key('preview-thumbnails-enabled', 'b', {
    default: true,
    summary: 'Show live preview thumbnails in capture overlay',
})
```

**After:** Regenerate gschema XML and type definitions by running the project's build command (check `package.json` for the gschema generation script).

### Task 1.2: Wire new GSchema keys in screenCaptureSettings

**File:** `src/lib/screenCaptureSettings.ts`

No changes needed — `createSettings` auto-generates accessors from the schema. The new keys will automatically produce:
- `audioInputId()` accessor
- `setAudioInputId()` setter
- `recordingQuality()` accessor
- `setRecordingQuality()` setter
- `previewThumbnailsEnabled()` accessor
- `setPreviewThumbnailsEnabled()` setter

### Task 1.3: Add new properties to Screenshot class

**File:** `src/lib/screenshot.ts`

Add private fields after `#virtualMonitors`:

```typescript
// ── Audio input selection ────────────────────────────────────────
#selectedAudioInput = -1; // -1 = system default
#selectedAudioInputName = 'System Default';

// ── Recording quality ────────────────────────────────────────────
#recordingQuality = 1; // 0=Low, 1=Medium, 2=High

// ── Preview thumbnails ───────────────────────────────────────────
#previewThumbnails = true;
```

Add getters/setters after the existing `audio` property:

```typescript
@getter(Number)
get selectedAudioInput() {
    return this.#selectedAudioInput;
}

@setter(Number)
set selectedAudioInput(value: number) {
    if (this.#selectedAudioInput === value) return;
    this.#selectedAudioInput = value;
    this.notify('selected-audio-input');
    // Update name for display
    if (value === -1) {
        this.#selectedAudioInputName = 'System Default';
    } else {
        const wp = AstalWp.get_default();
        const mic = wp?.audio.get_microphone(value);
        this.#selectedAudioInputName = mic?.description || `Input ${value}`;
    }
    this.notify('selected-audio-input-name');
}

@getter(String)
get selectedAudioInputName() {
    return this.#selectedAudioInputName;
}

@getter(Number)
get recordingQuality() {
    return this.#recordingQuality;
}

@setter(Number)
set recordingQuality(value: number) {
    if (this.#recordingQuality === value) return;
    this.#recordingQuality = value;
    this.notify('recording-quality');
}

@getter(Boolean)
get previewThumbnails() {
    return this.#previewThumbnails;
}

@setter(Boolean)
set previewThumbnails(value: boolean) {
    if (this.#previewThumbnails === value) return;
    this.#previewThumbnails = value;
    this.notify('preview-thumbnails');
}
```

**Import needed:** Add `import AstalWp from 'gi://AstalWp?version=0.1';` at the top of `screenshot.ts`.

### Task 1.4: Extend `buildRecordingArgs` with quality and audio input

**File:** `src/lib/screenshot.ts`

Modify the function signature:

```typescript
function buildRecordingArgs(
    backend: RecorderBackend,
    filename: string,
    geometry: string | undefined,
    output: string | undefined,
    audio: boolean,
    format: RecordingFormat = RecordingFormat.MP4,
    audioInputId: number = -1,
    quality: number = 1,
): RecordingArgs {
```

Add quality mapping inside the function (before the return statements):

```typescript
// Quality presets
const qualityArgs: string[] = [];
if (backend === RecorderBackend.WL_SCREENREC) {
    const q = quality === 0 ? 3 : quality === 2 ? 8 : 5;
    qualityArgs.push('--quality', String(q));
} else {
    const crf = quality === 0 ? 33 : quality === 2 ? 23 : 28;
    qualityArgs.push('--codec-param', `crf=${crf}`);
}
```

For `wl-screenrec`, add `qualityArgs` after `--audio`:
```typescript
if (audio) args.push('--audio');
args.push(...qualityArgs);
```

For `wf-recorder`, add `qualityArgs` at the end of the args array (before the return).

For audio input selection, add after the existing audio block:

```typescript
// Audio input selection (specific node ID)
if (audioInputId !== -1) {
    if (backend === RecorderBackend.WL_SCREENREC) {
        // wl-screenrec uses --audio-device for specific input
        // Find the node name from the ID
        const wp = AstalWp.get_default();
        const mic = wp?.audio.get_microphone(audioInputId);
        if (mic?.name) {
            args.push('--audio-device', mic.name);
        }
    } else {
        // wf-recorder: use pipewire_node.restore.id
        args.push('--audio', `pipewire_node.restore.id=${audioInputId}`);
    }
}
```

Update the call site in `startRecording()`:

```typescript
const {args, backendName} = buildRecordingArgs(
    backend,
    filename,
    options.geometry,
    effectiveOutput,
    this.#audio,
    format,
    this.#selectedAudioInput,
    this.#recordingQuality,
);
```

---

## Phase 2: Shared Components

### Task 2.1: Create `PreviewCard` component

**File:** `src/widget/screenshot-ui/preview.tsx`

```typescript
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';

export interface PreviewCardProps {
    kind: 'monitor' | 'window';
    name: string;
    subtitle: string;
    onClick: () => void;
}

/**
 * Build a preview thumbnail card. Returns the Picture widget for external
 * texture updates and the Button wrapper.
 */
export function PreviewCard({
    kind,
    name,
    subtitle,
    onClick,
}: PreviewCardProps): {
    button: Gtk.Button;
    picture: Gtk.Picture;
    setTexture: (path: string) => void;
} {
    const picture = new Gtk.Picture();
    picture.set_size_request(200, 120);
    picture.content_fit = Gtk.ContentFit.SCALE_DOWN;
    picture.add_css_class('picker-preview');

    const label = new Gtk.Label({
        label: name,
        xalign: 0.5,
        css_classes: ['picker-label'],
        ellipsize: 3, // Pango.EllipsizeMode.END
    });

    const inner = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        css_classes: ['picker-card'],
    });
    inner.append(picture);
    inner.append(label);

    if (subtitle) {
        const sub = new Gtk.Label({
            label: subtitle,
            xalign: 0.5,
            css_classes: ['picker-sublabel'],
            ellipsize: 3,
        });
        inner.append(sub);
    }

    const button = new Gtk.Button({child: inner, css_classes: ['flat']});
    button.connect('clicked', onClick);

    const setTexture = (path: string) => {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            try {
                const tex = Gdk.Texture.new_from_filename(path);
                picture.set_paintable(tex);
            } catch {
                // ignore corrupt files
            }
        }
    };

    return {button, picture, setTexture};
}
```

### Task 2.2: Create `AudioSourcePicker` component

**File:** `src/widget/screenshot-ui/audioSourcePicker.tsx`

```typescript
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Wireplumber from 'gi://AstalWp';
import {createBinding, createState, onMount, onCleanup} from 'gnim';
import Screenshot from '#/lib/screenshot';
import {connectFor, cleanupNode} from '#/lib/connectFor';

export default () => {
    const ss = Screenshot.get_default();
    const [audio, setAudio] = createState<Wireplumber.Audio | null>(null);
    const [selectedId, setSelectedId] = createState(-1);

    onMount(() => {
        const _hn = {};
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const wp = Wireplumber.get_default();
            if (wp) {
                setAudio(wp.audio);
                // Initialize from screenshot state
                setSelectedId(ss.selectedAudioInput);
            }
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    // Build dropdown items when microphones change
    const dropdownItems = createBinding(audio, 'microphones').as(mics => {
        if (!mics || mics.length === 0) return [];
        return [
            {id: -1, label: 'System Default', icon: 'audio-input-microphone-symbolic'},
            ...mics.map(mic => ({
                id: mic.id,
                label: mic.description || mic.name || `Input ${mic.id}`,
                icon: mic.icon || 'audio-input-microphone-symbolic',
            })),
        ];
    });

    return (
        <Gtk.Box spacing={8}>
            <Gtk.Image
                iconName="audio-input-microphone-symbolic"
                pixelSize={16}
            />
            <Gtk.DropDown
                selected={selectedId}
                // Use a custom list model or string list
                // For simplicity, use a Gtk.StringList with the labels
                // and track selection by index
            />
        </Gtk.Box>
    );
};
```

**Note:** The actual `Gtk.DropDown` implementation needs to use `Gtk.StringList` as the model. Since gnim's JSX doesn't directly support complex model binding, we may need to use a `$={}` callback to set up the model programmatically. This is a known GTK4 pattern — the implementation will handle it in the actual code.

### Task 2.3: Create `FormatQualitySelector` component

**File:** `src/widget/screenshot-ui/formatQualitySelector.tsx`

```typescript
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import Screenshot from '#/lib/screenshot';
import {getScreenCaptureSettings} from '#/lib/screenCaptureSettings';

export default () => {
    const ss = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();

    const QualityButton = ({
        label,
        value,
    }: {
        label: string;
        value: number;
    }) => (
        <Gtk.ToggleButton
            active={createBinding(ss, 'recording-quality').as(
                q => q === value
            )}
            onToggled={btn => {
                if (btn.active) {
                    ss.recordingQuality = value;
                    captureSettings.setRecordingQuality(value);
                }
            }}
        >
            <Gtk.Label label={label} />
        </Gtk.ToggleButton>
    );

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            {/* Format toggle */}
            <Gtk.Box spacing={4}>
                <Gtk.Label label="Format:" />
                <Gtk.Box spacing={0} cssClasses={['linked']}>
                    <Gtk.ToggleButton
                        active={createBinding(
                            captureSettings.settings,
                            'recording-format'
                        ).as(f => f === 0)}
                        onToggled={btn => {
                            if (btn.active)
                                captureSettings.setRecordingFormat(0);
                        }}
                    >
                        <Gtk.Label label="MP4" />
                    </Gtk.ToggleButton>
                    <Gtk.ToggleButton
                        active={createBinding(
                            captureSettings.settings,
                            'recording-format'
                        ).as(f => f === 1)}
                        onToggled={btn => {
                            if (btn.active)
                                captureSettings.setRecordingFormat(1);
                        }}
                    >
                        <Gtk.Label label="WebM" />
                    </Gtk.ToggleButton>
                </Gtk.Box>
            </Gtk.Box>

            {/* Quality selector */}
            <Gtk.Box spacing={4}>
                <Gtk.Label label="Quality:" />
                <Gtk.Box spacing={0} cssClasses={['linked']}>
                    <QualityButton label="Low" value={0} />
                    <QualityButton label="Med" value={1} />
                    <QualityButton label="High" value={2} />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Box>
    );
};
```

---

## Phase 3: Extend screenshot-ui Overlay

### Task 3.1: Add collapsible Options section

**File:** `src/widget/screenshot-ui/index.tsx`

Add local state for options expansion:

```typescript
// After existing createState calls, add:
const [optionsExpanded, setOptionsExpanded] = createState(false);
const [previewEnabled, setPreviewEnabled] = createState(true);
```

Add an expandable Options section in the toolbar card, after the Target picker and before the Audio+Boundary checkboxes:

```tsx
{/* Options expander */}
<Gtk.Box
    orientation={Gtk.Orientation.VERTICAL}
    spacing={4}
>
    <Gtk.Button
        onClicked={() => setOptionsExpanded(!optionsExpanded())}
        cssClasses={['flat']}
        halign={Gtk.Align.START}
    >
        <Adw.ButtonContent
            iconName={optionsExpanded.as(v =>
                v ? 'pan-down-symbolic' : 'pan-end-symbolic'
            )}
            label={optionsExpanded.as(v =>
                v ? 'Hide Options' : 'Show Options'
            )}
        />
    </Gtk.Button>

    {optionsExpanded() && (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            css={'padding: 8px;'}
        >
            {/* Audio source picker */}
            <AudioSourcePicker />

            <Gtk.Separator />

            {/* Format + Quality */}
            <FormatQualitySelector />

            <Gtk.Separator />

            {/* Boundary toggle */}
            <Gtk.CheckButton
                active={createBinding(
                    captureSettings.settings,
                    'show-recording-boundary'
                )}
                onNotifyActive={({active}) => {
                    captureSettings.setShowRecordingBoundary(active);
                }}
            >
                <Gtk.Label label="Show red boundary" />
            </Gtk.CheckButton>

            {/* Preview toggle */}
            <Gtk.CheckButton
                active={previewEnabled()}
                onNotifyActive={({active}) => {
                    setPreviewEnabled(active);
                    ss.previewThumbnails = active;
                }}
            >
                <Gtk.Label label="Live preview thumbnails" />
            </Gtk.CheckButton>
        </Gtk.Box>
    )}
</Gtk.Box>
```

### Task 3.2: Add preview thumbnail strip

**File:** `src/widget/screenshot-ui/index.tsx`

Add a preview strip at the bottom of the overlay. This requires:

1. A poll timer for grim captures
2. A container for thumbnail cards
3. Click-to-select behavior

Add after the control panel overlay (still inside `Gtk.Overlay`):

```tsx
{/* Preview thumbnail strip (bottom) */}
<Gtk.Box
    halign={Gtk.Align.CENTER}
    valign={Gtk.Align.END}
    css={'margin-bottom: 24px;'}
    visible={createBinding(ss, 'preview-thumbnails').as(
        v => v && previewEnabled()
    )}
>
    <Gtk.ScrolledWindow
        hscrollbar_policy={Gtk.PolicyType.AUTOMATIC}
        vscrollbar_policy={Gtk.PolicyType.NEVER}
        css={'min-width: 400px; max-width: 800px;'}
    >
        <Gtk.Box
            spacing={8}
            orientation={Gtk.Orientation.HORIZONTAL}
            css={'padding: 8px;'}
            $={self => {
                // Set up preview polling and card population
                // This is done in a $ callback to access the widget ref
            }}
        />
    </Gtk.ScrolledWindow>
</Gtk.Box>
```

The actual implementation of the poll timer and card management is complex and will be done inline in the widget. The key logic:

- When the overlay opens and `previewThumbnails` is true, start polling
- Poll each monitor every 200ms (staggered)
- Create `PreviewCard` instances for each monitor
- On click, set the active target to that monitor
- On overlay close, stop polling and clean up temp files

### Task 3.3: Update capture button for recording state

**File:** `src/widget/screenshot-ui/index.tsx`

The capture button should show "Stop Recording" when a recording is active:

```tsx
<Gtk.Button
    onClicked={() => {
        if (ss.recording) {
            ss.stopRecording();
        } else {
            executeCapture();
        }
    }}
    cssClasses={createBinding(ss, 'recording').as(rec =>
        rec ? ['destructive-action'] : ['suggested-action']
    )}
    hexpand
>
    <Adw.ButtonContent
        iconName={createBinding(ss, 'recording').as(rec =>
            rec
                ? 'media-playback-stop-symbolic'
                : createBinding(ss, 'selected-mode').as(m =>
                      m === 'screenshot'
                          ? 'camera-photo-symbolic'
                          : 'camera-video-symbolic'
                  )
        )}
        label={createBinding(ss, 'recording').as(rec =>
            rec
                ? 'Stop Recording'
                : createBinding(ss, 'selected-mode').as(m =>
                      m === 'screenshot'
                          ? 'Take Screenshot'
                          : 'Start Recording'
                  )
        )}
    />
</Gtk.Button>
```

### Task 3.4: Show boundary preview on frozen frame

**File:** `src/widget/screenshot-ui/index.tsx`

When recording mode is active and a target is selected (area/window/monitor), show the boundary on the frozen frame before recording starts. This is done by:

1. When `executeCapture()` is called in recording mode, compute the geometry
2. Call `ss.showBoundary(geometry)` before closing the overlay
3. The existing `recording-boundary` widget will display the red border
4. The boundary stays visible during recording (existing behavior)

Modify `executeCapture()`:

```typescript
function executeCapture() {
    // ... existing code ...

    if (mode === 'screenshot') {
        ss.captureFromStage(geometry);
    } else {
        // Show boundary preview before recording
        if (geometry) {
            const [pos, size] = geometry.split(' ');
            const [x, y] = pos.split(',').map(Number);
            const [w, h] = size.split('x').map(Number);
            ss.showBoundary({x, y, width: w, height: h});
        }
        ss.overlayOpen = false;
        // ... rest of recording logic
    }
}
```

---

## Phase 4: Screen Share Detector + Bar Indicator

### Task 4.1: Create `ScreenShareDetector`

**File:** `src/lib/screenShareDetector.ts`

```typescript
import GObject, {getter, register} from 'gnim/gobject';
import Wireplumber from 'gi://AstalWp';
import GLib from 'gi://GLib?version=2.0';

export interface ShareStream {
    appName: string;
    appIcon: string;
    mediaRole: Wireplumber.MediaRole;
    nodeId: number;
    startTime: number;
}

@register({GTypeName: 'ScreenShareDetector'})
class ScreenShareDetector extends GObject.Object {
    static instance: ScreenShareDetector;

    static get_default() {
        if (!this.instance) this.instance = new ScreenShareDetector();
        return this.instance;
    }

    #activeShares: ShareStream[] = [];
    #durationTimer: number | null = null;

    @getter(Boolean)
    get isScreenSharing(): boolean {
        return this.#activeShares.length > 0;
    }

    @getter(Number)
    get shareCount(): number {
        return this.#activeShares.length;
    }

    @getter(Array)
    get activeShares(): ShareStream[] {
        return [...this.#activeShares];
    }

    constructor() {
        super();
        this.#init();
    }

    #init() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const wp = Wireplumber.get_default();
            if (!wp) return GLib.SOURCE_REMOVE;

            const audio = wp.audio;

            // Check existing streams
            this.#scanStreams(audio);

            // Listen for new streams
            audio.connect('stream-added', (_, stream) => {
                this.#checkStream(stream);
            });

            audio.connect('stream-removed', (_, stream) => {
                this.#removeStream(stream.id);
            });

            // Start duration timer
            this.#durationTimer = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                1000,
                () => {
                    // Just notify that shares are still active (for duration updates)
                    if (this.#activeShares.length > 0) {
                        this.notify('active-shares');
                    }
                    return GLib.SOURCE_CONTINUE;
                }
            );

            return GLib.SOURCE_REMOVE;
        });
    }

    #scanStreams(audio: Wireplumber.Audio) {
        const streams = audio.streams || [];
        for (const stream of streams) {
            this.#checkStream(stream);
        }
    }

    #checkStream(stream: Wireplumber.Stream) {
        const role = stream.media_role;
        const mediaClass = stream.media_class;

        // Detect screen sharing streams
        const isScreenShare =
            role === Wireplumber.MediaRole.SCREEN ||
            mediaClass === Wireplumber.MediaClass.STREAM_INPUT_VIDEO;

        if (isScreenShare && !this.#activeShares.find(s => s.nodeId === stream.id)) {
            this.#activeShares.push({
                appName: stream.description || stream.name || 'Unknown',
                appIcon: stream.icon || 'video-display-symbolic',
                mediaRole: role,
                nodeId: stream.id,
                startTime: Date.now(),
            });
            this.notify('is-screen-sharing');
            this.notify('share-count');
            this.notify('active-shares');
        }
    }

    #removeStream(nodeId: number) {
        const idx = this.#activeShares.findIndex(s => s.nodeId === nodeId);
        if (idx !== -1) {
            this.#activeShares.splice(idx, 1);
            this.notify('is-screen-sharing');
            this.notify('share-count');
            this.notify('active-shares');
        }
    }

    dispose() {
        if (this.#durationTimer) {
            GLib.Source.remove(this.#durationTimer);
            this.#durationTimer = null;
        }
    }
}

export default ScreenShareDetector;
```

### Task 4.2: Create `ScreenShare` bar indicator

**File:** `src/widget/bar/indicators/screenShare.tsx`

```typescript
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {createBinding, createState, onMount, onCleanup} from 'gnim';
import ScreenShareDetector from '#/lib/screenShareDetector';
import {connectFor, cleanupNode} from '#/lib/connectFor';

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const h = Math.floor(m / 60);
    if (h > 0) {
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

export default () => {
    const detector = ScreenShareDetector.get_default();
    const [visible, setVisible] = createState(false);
    const [tooltip, setTooltip] = createState('');

    onMount(() => {
        const _hn = {};
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const update = () => {
                const sharing = detector.isScreenSharing;
                setVisible(sharing);
                if (sharing) {
                    const shares = detector.activeShares;
                    const names = shares.map(s => s.appName).join(', ');
                    const durations = shares
                        .map(s => formatDuration(Date.now() - s.startTime))
                        .join(', ');
                    setTooltip(`Screen sharing: ${names}\nDuration: ${durations}`);
                }
            };
            update();
            connectFor(_hn, detector, 'notify::is-screen-sharing', update);
            connectFor(_hn, detector, 'notify::active-shares', update);
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Button
            visible={visible}
            cssClasses={['flat']}
            tooltipMarkup={tooltip}
            css={'color: #FF6600;'} // Orange for external shares
        >
            <Gtk.Image
                iconName="video-display-symbolic"
                pixelSize={18}
            />
        </Gtk.Button>
    );
};
```

### Task 4.3: Register screen share detector in widget index

**File:** `src/widget/index.tsx`

Add to `getServiceDescriptors`:

```typescript
{
    name: 'ScreenShareDetector',
    init: () => ScreenShareDetector.get_default(),
},
```

Add import:
```typescript
import ScreenShareDetector from '#/lib/screenShareDetector';
```

### Task 4.4: Add screen share indicator to bar

**File:** `src/widget/bar/index.tsx`

Add import:
```typescript
import ScreenShareIndicator from './indicators/screenShare';
```

Add the indicator in the `end` box, after `RecordingIndicator`:

```tsx
<ScreenShareIndicator />
```

---

## Phase 5: Removals and Cleanup

### Task 5.1: Remove `screenshot-overlay`

**File:** `src/widget/index.tsx`

Remove from imports:
```typescript
// Remove: import screenshotOverlay from './screenshot-overlay';
```

Remove from `getWidgetDescriptors`:
```typescript
// Remove: {name: 'screenshot-overlay', mount: screenshotOverlay},
```

Delete file:
```bash
rm src/widget/screenshot-overlay/index.tsx
```

### Task 5.2: Remove `recording-bar`

**File:** `src/widget/index.tsx`

Remove from imports:
```typescript
// Remove: import recordingBar from './recording-bar';
```

Remove from `getWidgetDescriptors`:
```typescript
// Remove: {name: 'recording-bar', mount: recordingBar},
```

Delete file:
```bash
rm src/widget/recording-bar/index.tsx
```

### Task 5.3: Verify requestHandler.ts still works

**File:** `src/lib/requestHandler.ts`

The `'screenshot-overlay'` action maps to `screenshot.toggleOverlay()`, which sets `overlayOpen = true`. This opens `screenshot-ui` (which is bound to `overlay-open`). No changes needed — the action still works correctly.

---

## Phase 6: share-picker Improvements

### Task 6.1: Extract shared preview logic

Since `share-picker-main.ts` is a standalone GJS process, it can't import TypeScript modules. However, we can extract the common `PreviewCard` and `PollManager` logic into a plain `.ts` file that uses only `gi://` imports and is compiled into both bundles.

For now, the simplest approach is to copy the `PreviewCard` pattern into `share-picker-main.ts` directly (it's already there in a different form). The key improvement is to use the same card styling and texture loading logic.

### Task 6.2: Add audio source dropdown to share-picker

**File:** `src/share-picker-main.ts`

Add an audio source section to the share-picker UI (informational — XDPH doesn't support audio selection yet, but the UI is ready):

After the token checkbox, add:

```typescript
// Audio source section (informational)
const audioBox = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    marginTop: 8,
});
const audioLabel = new Gtk.Label({
    label: 'Audio source:',
    halign: Gtk.Align.START,
});
const audioDropdown = new Gtk.DropDown({
    // Would be populated from AstalWp in a full implementation
    // For now, show a placeholder
});
audioBox.append(audioLabel);
audioBox.append(audioDropdown);
mainBox.append(audioBox);
```

**Note:** Full AstalWp integration in the share-picker requires importing AstalWp in the GJS process. This may not be available in the standalone process context. For now, add the UI placeholder.

---

## Phase 7: Testing & Verification

### Task 7.1: Build and type-check

```bash
cd /home/daviaaze/Projects/pessoal/dshell
# Run the project's build command (check package.json)
npm run build
# Or:
# pnpm build
```

### Task 7.2: Test scenarios

1. **Overlay opens** — Press screenshot keybinding, overlay appears with frozen frame
2. **Mode toggle** — Switch between Screenshot and Recording, UI updates
3. **Options expand** — Click "Show Options", audio picker + format/quality appear
4. **Audio selection** — Select a microphone from dropdown, verify GSettings persists
5. **Quality selection** — Toggle Low/Med/High, verify args in recording
6. **Preview thumbnails** — Enable preview, see monitor thumbnails at bottom
7. **Click thumbnail** — Selects monitor as target
8. **Recording with boundary** — Start recording, red border appears around area
9. **Bar indicator** — Recording shows REC + elapsed; screen share shows orange icon
10. **Stop recording** — Click stop in overlay or bar, recording stops
11. **Share picker** — Verify share-picker still works via XDPH

### Task 7.3: GSettings verification

```bash
# Check new keys are registered
gsettings list-keys com.caioasmuniz.shade_shell.screen-capture
# Should include: audio-input-id, recording-quality, preview-thumbnails-enabled
```

---

## Phase 8: Commit

After all tasks are complete and tested:

1. Stage all changes
2. Commit with conventional commit message:
   ```
   feat(capture): unified screen capture UI with preview, audio, quality
   
   - Extend screenshot-ui with collapsible options, live preview thumbnails,
     audio source picker, format/quality controls
   - Add ScreenShareDetector via AstalWp for active share stream detection
   - Add screen share indicator to bar (orange, pulsing)
   - Remove screenshot-overlay and recording-bar (absorbed into unified UI)
   - Improve share-picker with shared preview components
   - Add gschema keys: audio-input-id, recording-quality, preview-thumbnails-enabled
   ```

---

## Appendix: File Change Summary

| Action | File | Lines (approx) |
|--------|------|---------------|
| Modify | `src/lib/gschema.ts` | +15 |
| Modify | `src/lib/screenshot.ts` | +80 |
| Create | `src/lib/screenShareDetector.ts` | +120 |
| Create | `src/widget/screenshot-ui/preview.tsx` | +60 |
| Create | `src/widget/screenshot-ui/audioSourcePicker.tsx` | +70 |
| Create | `src/widget/screenshot-ui/formatQualitySelector.tsx` | +60 |
| Modify | `src/widget/screenshot-ui/index.tsx` | +150 |
| Create | `src/widget/bar/indicators/screenShare.tsx` | +60 |
| Modify | `src/widget/bar/index.tsx` | +3 |
| Modify | `src/widget/bar/systemIndicators.tsx` | +1 (if adding to QS) |
| Modify | `src/widget/index.tsx` | +5, -10 |
| Modify | `src/share-picker-main.ts` | +20 |
| Delete | `src/widget/screenshot-overlay/index.tsx` | -200 |
| Delete | `src/widget/recording-bar/index.tsx` | -60 |

**Total:** ~8 files modified, 4 files created, 2 files deleted.