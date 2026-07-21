# Task for worker

[Read from: /home/daviaaze/Projects/pessoal/dshell/context.md, /home/daviaaze/Projects/pessoal/dshell/plan.md]

Fix widget type errors in /home/daviaaze/Projects/pessoal/dshell. Most are JSX Object→Gtk cast patterns and prop typing issues.

## File 1: src/widget/dock/item.tsx — 7 errors

1. Lines 49, 51 — wrong accessor setter. `current.set(...)` and `bar.dockPinnedApps.set(...)`. Fix handlePinToggle to match the pattern in src/widget/settings/bar.tsx:137,152:
```ts
const handlePinToggle = () => {
  logger.info('dock', `${pinned ? 'unpin' : 'pin'}: ${desktopFile}`);
  const current = bar.dockPinnedApps();
  if (pinned) {
    bar.setDockPinnedApps(current.filter(d => d !== desktopFile));
  } else {
    bar.setDockPinnedApps([...current, desktopFile]);
  }
};
```

2. Lines 108, 110 — `icon.set_pixel_size(...)` on `<Gtk.Image />` JSX. Cast: `const icon = (<Gtk.Image iconName={iconName} />) as Gtk.Image;
// then later: icon.set_pixel_size(...)
`

3. Line 116 — `status.css` on `<Gtk.Box />` JSX. Cast: `const status = (<Gtk.Box />) as Gtk.Box;`

4. Line 131 — `status.visible` on Object. Already fixed by cast in #3.

5. Line 148 — `self.child = box` where box is Object. Already `box` is from `<Gtk.Box ...>` JSX. Cast: `self.child = box as Gtk.Widget;`

## File 2: src/widget/osd/popup.tsx — widen connectable prop

`connectable` prop is typed as `GObject.Object` but callers pass `Endpoint | null` (audioCtrl.defaultSpeaker). Fix:
```ts
export default ({
  widget,
  connectable,
  signals,
}: {
  widget: GObject.Object;
  connectable: GObject.Object | null;
  signals: string[];
}) => ...
```
And inside, null-guard the idle_add callback:
```ts
GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
  if (!connectable) return GLib.SOURCE_REMOVE;
  for (const signal of signals) {
    connectFor(self, connectable, signal, showPopup);
  }
  return GLib.SOURCE_REMOVE;
});
```

## File 3: src/widget/osd/index.tsx — 7 errors

1. Lines 36, 60: `connectable={audioCtrl.defaultSpeaker}` etc — fixed by Popup changes above.

2. Lines 39, 63: `iconName: speakerIcon` / `micIcon` where speakerIcon/micIcon are `Accessor<string | undefined>` but Slider expects `Accessor<string>`. Fix the createComputed calls to add fallback:
```ts
const speakerIcon = createComputed(
  () =>
    audioCtrl.defaultSpeaker?.mute || audioCtrl.defaultSpeaker?.volume === 0
      ? MUTED_SPEAKER_ICON
      : audioCtrl.defaultSpeaker?.volumeIcon ?? 'audio-volume-high-symbolic'
);

const micIcon = createComputed(
  () =>
    audioCtrl.defaultMicrophone?.mute || audioCtrl.defaultMicrophone?.volume === 0
      ? MUTED_MIC_ICON
      : audioCtrl.defaultMicrophone?.volumeIcon ?? 'audio-input-microphone-symbolic'
);
```

3. Lines 40, 56, 64: `value: audioCtrl.defaultSpeaker?.volume` etc — these pass `number | undefined` but Slider expects `Accessor<number>`. Wrap in createComputed. But line 56 is `brightness.kbd` which is just `number` (already works per Slider type requiring Accessor<number> — wait no, plain number is also not Accessor). Check: line 46 already passes `createBinding(brightness, 'screen')` which is correct. Lines 40, 56, 64 are wrong. Fix by wrapping in `createComputed`:
```ts
value: createComputed(() => audioCtrl.defaultSpeaker?.volume ?? 0),
```
and similarly for line 64 (mic). For line 56:
```ts
value: createComputed(() => brightness.kbd),
```

## File 4: src/widget/osd/slider.tsx — maybe no change needed

Check if Slider's `value` prop should accept `number | Accessor<number>` instead of just `Accessor<number>`. If it only takes Accessor, change the type to accept both and use a helper. Read slider.tsx first.

Actually simpler: keep it as Accessor<number> and wrap callers in createComputed as described above.

## File 5: src/widget/screenshot-ui/audioSourcePicker.tsx — 3 errors

`ss.selectedAudioInput` doesn't exist on Screenshot — it's on `ss.prefs`. Fix:
- Line 36: `ss.selectedAudioInput` → `ss.prefs.selectedAudioInput`
- Line 56: `ss.selectedAudioInput` → `ss.prefs.selectedAudioInput`
- Line 61: `ss.selectedAudioInput = -1` → `ss.prefs.selectedAudioInput = -1`
- Line 68: `ss.selectedAudioInput = mic.id` → `ss.prefs.selectedAudioInput = mic.id`
(Pattern from formatQualitySelector.tsx which uses `ss.prefs.recordingQuality`)

## File 6: src/widget/quicksettings/tray.tsx — 1 error

Line 60: `TrayItem` name not found. Import TrayService at top and derive the type. Or add import for AstalTray types. Check TrayService's `items` return type: `Tray.TrayItem[]`. Best: export a type from trayService or just use inline type assertion. The nearest pattern: the TrayService comment says "Widgets bind to items instead of importing gi://AstalTray directly." So add a type re-export OR just cast `(item: any)`. Better: add import:
```ts
import type AstalTray from 'gi://AstalTray';
type TrayItem = AstalTray.TrayItem;
```
But ts-for-gir may not have AstalTray types. If error persists, use `(item: Record<string, any>)`.

## File 7: src/widget/lockscreen/authPanel.tsx — 1 error

Line 65: `fpErrorBinding.as(msg => msg ?? 'Retry fingerprint')` — fpErrorBinding is `Accessor<{}>` not `Accessor<string>`. Fix the prop types at the interface:
```ts
interface AuthPanelProps {
  authSession: AuthSession;
  fingerprint: FingerprintAuth;
  fpStateBinding: Accessor<string>;
  fpErrorBinding: Accessor<string | null>;
}
```
(import `Accessor` from 'gnim' if not already)
Check if `Accessor` is already imported in authPanel.tsx — if not, add it.

## Validation
After all edits, run `cd /home/daviaaze/Projects/pessoal/dshell && node --check src/widget/dock/item.tsx src/widget/osd/index.tsx src/widget/screenshot-ui/audioSourcePicker.tsx src/widget/quicksettings/tray.tsx src/widget/lockscreen/authPanel.tsx` (esbuild check) or `pnpm run check > /tmp/tsc-agent3.txt 2>&1; echo EXIT=$?`.

---
Update progress at: /home/daviaaze/Projects/pessoal/dshell/.pi-subagents/artifacts/progress/866aaec3/progress.md

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```