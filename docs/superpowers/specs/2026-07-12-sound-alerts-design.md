# Sound Alerts — July 2026

## Overview

Add system-wide sound alerts to Shade Shell using the freedesktop.org sound theme via `canberra-gtk-play`. Covers notification sounds, screenshot/recording feedback, and low battery warnings. DND-aware and configurable per category.

---

## Architecture

### SoundAlertService (`src/lib/services/audio/soundAlerts.ts`)

A GObject singleton that listens to bus events and AstalNotifd signals, then plays sounds via `canberra-gtk-play`.

```
Bus event → SoundAlertService.on() → check DND → check category enabled → Process.exec(canberra-gtk-play --id=...)
```

- **Backend**: `canberra-gtk-play` CLI tool via `Process.exec`
- **No GIR bindings** — libcanberra GIR is not available
- **DND-aware**: checks `DndService.get_default().dnd` before playing
- **Configurable**: reads per-category enable flags from GSettings

### Sound Event Mapping

| Trigger | `canberra-gtk-play` sound ID | Event source |
|---------|------------------------------|--------------|
| Notification arrives | `message-new-instant` | AstalNotifd `'notified'` signal |
| Screenshot (full/area) | `screen-capture` | `capture:screenshot` / `capture:screenshot:area` bus events |
| Recording starts | `service-login` | `capture:record` / `capture:record:area` / `capture:record:window` bus events |
| Recording stops | `service-logout` | `capture:record:output` bus event |
| Low battery | `dialog-warning` | Battery monitoring (via `upower` or existing battery service) |

### GSettings Schema

Keys added to `generalSchema` in `src/lib/settings/schema.ts`:

```ts
.key('sound-alerts-enabled', 'b', {
    default: true,
    summary: 'Master toggle for all sound alerts',
})
.key('sound-alert-notification', 'b', {
    default: true,
    summary: 'Play sound on notification arrival',
})
.key('sound-alert-capture', 'b', {
    default: true,
    summary: 'Play sound on screenshot/recording events',
})
.key('sound-alert-battery', 'b', {
    default: true,
    summary: 'Play sound on low battery warning',
})
```

---

## Implementation

### SoundAlertService

```ts
@register({GTypeName: 'SoundAlertService'})
export default class SoundAlertService extends GObject.Object {
    static readonly instance: SoundAlertService;
    static get_default(): SoundAlertService;

    #settings: { ... };  // accessor bindings
    #busUnsubs: (() => void)[] = [];
    #notifdHandlerId = 0;
    #initialized = false;

    init(settings: { ... }): void;
    play(soundId: string): void;
    dispose(): void;
}
```

**`init(settings)`**:
- Reads per-category enable flags from GSettings
- Subscribes to GSettings `changed::sound-alert-*` for live updates
- Subscribes to bus events: `capture:screenshot`, `capture:screenshot:area`, `capture:record`, `capture:record:area`, `capture:record:window`, `capture:record:output`
- Connects to AstalNotifd `'notified'` signal

**`play(soundId)`**:
- Checks `DndService.get_default().dnd` — if DND is on, skip
- Calls `Process.exec('canberra-gtk-play --id=' + soundId)`
- Errors are silently caught (no sound theme installed is a valid state)

### Init Chain

Added to `getServiceDescriptors()` in `widget/index.tsx`:
```ts
{name: 'SoundAlerts', init: () => SoundAlertService.get_default().init(s.general)}
```

### Battery Low Detection

`AstalBattery` is already available in the stack. `SoundAlertService` connects to `AstalBattery.get_default()` and monitors `notify::percentage`. When the percentage drops below 15% and the previous reading was above 15%, play `dialog-warning`.

---

## Files

| File | Change |
|------|--------|
| `src/lib/settings/schema.ts` | Add 4 `sound-alert-*` keys to `generalSchema` |
| `src/lib/services/audio/soundAlerts.ts` | **New** — SoundAlertService |
| `src/widget/index.tsx` | Add SoundAlerts to init chain |

---

## Testing

- **SoundAlertService**: Unit test with mock `Process.exec` — verify `canberra-gtk-play` is called with correct sound ID
- **DND gating**: Set DND on, trigger event, verify no sound is played
- **GSettings toggles**: Disable a category, verify no sound for that event