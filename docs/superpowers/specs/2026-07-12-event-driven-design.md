# Event-Driven Architecture — July 2026

## Overview

Decouple cross-service dependencies to enable isolated testing, parallel service initialization, and easier cross-cutting features. Delivered in two incremental phases: GSettings intermediation (Phase 1) and EventBus + requestHandler IoC (Phase 2).

---

## Current Coupling Map

```
Weather ──imports──> ColorScheme ──imports──> NightLight
```

| Coupling | File | Mechanism |
|----------|------|-----------|
| ColorScheme → Weather | `colorScheme.ts` | `init(weather, ...)` + `weather.connect('notify::info')` for daytime/sunrise/sunset |
| NightLight → ColorScheme | `nightLight.ts` | `init(..., colorScheme)` + `this.#colorScheme.daytime` for auto-schedule |
| requestHandler → 6 modules | `requestHandler.ts` | Imports ShellState, WindowManager, Screenshot, Touchpad, openSettings, toggleWindowSwitcher |
| Init chain ordering | `widget/index.tsx` | `ColorScheme.init(Weather.get_default(), ...)` — must run after Weather.init |
| requestHandler → widget code | `requestHandler.ts` | Imports `openSettings` from `#/widget` and `toggleWindowSwitcher` from `#/widget/windowswitcher` (wrong layer direction) |

---

## Phase 1: GSettings Intermediation

### Approach

Weather writes computed state (daytime, sunrise time, sunset time) to GSettings. ColorScheme and NightLight read from GSettings instead of importing each other. The init chain becomes flat with no ordering requirements.

### New GSettings Keys

Added to `generalSchema` in `src/lib/settings/schema.ts`:

```ts
.key('weather-is-daytime', 'b', {
    default: true,
    summary: 'Whether it is currently daytime (set by Weather service)',
})
.key('weather-sunrise-time', 'd', {
    default: 0.0,
    summary: 'Unix timestamp of next sunrise (set by Weather service)',
})
.key('weather-sunset-time', 'd', {
    default: 0.0,
    summary: 'Unix timestamp of next sunset (set by Weather service)',
})
```

`double` for timestamps to avoid 32-bit integer overflow (year 2038 problem).

### Per-Service Changes

#### Weather (`src/lib/services/location/weather.ts`)

- Opens `generalSchema` GSettings directly in `init()` (no new init parameters)
- In the `'updated'` signal handler, after `this.notify('info')`, writes all three keys:
  ```ts
  if (this.#weather.is_valid()) {
      const [, sunrise] = this.#weather.get_value_sunrise();
      const [, sunset] = this.#weather.get_value_sunset();
      generalSettings.set_boolean('weather-is-daytime', this.#weather.is_daytime());
      generalSettings.set_double('weather-sunrise-time', sunrise);
      generalSettings.set_double('weather-sunset-time', sunset);
  }
  ```

#### ColorScheme (`src/lib/services/display/colorScheme.ts`)

- `init(weather: Weather, settings)` → `init(settings)`
- Removes `import Weather` entirely
- `#weather` field and `#weatherHandlerId` are removed
- `updateFromWeather()` closure is replaced with a GSettings listener:
  ```ts
  generalSettings.connect('changed::weather-is-daytime', () => {
      const newDaytime = generalSettings.get_boolean('weather-is-daytime');
      if (newDaytime !== this.#daytime) {
          this.#daytime = newDaytime;
          this.notify('daytime');
          if (this.#colorScheme === DarkModes.AUTO) {
              this.colorScheme = DarkModes.AUTO;
          }
      }
      this.timeout();
  });
  ```
- `timeout()` reads `generalSettings.get_double('weather-sunrise-time')` and `get_double('weather-sunset-time')` instead of `weather.info.get_value_sunrise/sunset()`
- `dispose()` no longer disconnects a weather handler

#### NightLight (`src/lib/services/display/nightLight.ts`)

- `init(settings, colorScheme: ColorScheme)` → `init(settings)`
- Removes `import {ColorScheme}` entirely
- `#colorScheme` field is removed
- `#checkSchedule()` reads from GSettings:
  ```ts
  #checkSchedule() {
      if (!this.#autoSchedule) return;
      const isDaytime = generalSettings.get_boolean('weather-is-daytime');
      const shouldBeOn = !isDaytime;
      if (this.#enabled !== shouldBeOn) {
          this.enabled = shouldBeOn;
      }
  }
  ```
- On init, subscribes to `changed::weather-is-daytime` to re-evaluate the schedule

#### Init Chain (`src/widget/index.tsx`)

```ts
// Before (ordered):
{name: 'Weather', init: () => Weather.get_default().init(s.weather)},
{name: 'ColorScheme', init: () => ColorScheme.get_default().init(Weather.get_default(), s.general)},
{name: 'NightLight', init: () => NightLight.get_default().init(s.general, ColorScheme.get_default())},

// After (independent, any order):
{name: 'Weather', init: () => Weather.get_default().init(s.weather)},
{name: 'ColorScheme', init: () => ColorScheme.get_default().init(s.general)},
{name: 'NightLight', init: () => NightLight.get_default().init(s.general)},
```

### Testing

- **ColorScheme**: Create a `Gio.Settings` with a test backend, set `weather-is-daytime`/`sunrise-time`/`sunset-time`, verify color scheme resolution and transition scheduling
- **NightLight**: Set `weather-is-daytime`, verify auto-schedule enables/disables correctly
- **Weather**: Existing tests unaffected; add assertion that GSettings keys are written on update

---

## Phase 2: EventBus + requestHandler IoC

### EventBus (`src/lib/core/eventBus.ts`)

A typed, synchronous pub/sub bus. No async queue — events fire immediately, matching GObject signal semantics.

```ts
export interface EventMap {
    'shell:launcher:toggle': void;
    'shell:qs:toggle': void;
    'shell:bar:toggle': void;
    'shell:clipboard:toggle': void;
    'shell:clipboard:open': void;
    'shell:lockscreen': void;
    'shell:settings:open': void;
    'shell:windowswitcher:toggle': void;
    'capture:screenshot': boolean;             // fullScreen
    'capture:screenshot:area': void;
    'capture:screenshot:overlay': void;
    'capture:record': void;
    'capture:record:area': void;
    'capture:record:window': void;
    'capture:record:window:address': string;   // window address
    'capture:record:output': void;
    'input:touchpad:toggle': void;
}

type Unsubscribe = () => void;

class EventBus {
    #listeners = new Map<string, Set<(...args: any[]) => void>>();

    on<K extends keyof EventMap>(event: K, fn: (payload: EventMap[K]) => void): Unsubscribe {
        if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
        this.#listeners.get(event)!.add(fn);
        return () => this.#listeners.get(event)?.delete(fn);
    }

    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
        const fns = this.#listeners.get(event);
        if (!fns) return;
        for (const fn of fns) fn(payload);
    }
}

export const bus = new EventBus();
```

**Design decisions:**
- **Synchronous dispatch** — no queue, no async. Matches GObject semantics.
- **Returns unsubscribe** — `on()` returns a cleanup function. Callers don't need a separate `connectFor` wrapper.
- **Typed payloads** — `EventMap` ensures each event has a known payload type at compile time.
- **Singleton** — module-level `bus` constant. No DI framework needed.

### Naming Convention

Events use `<domain>:<subsystem>:<action>`:
- `shell:*` — shell UI state (launcher, quick settings, lock screen, clipboard, settings)
- `capture:*` — screenshot/recording operations
- `input:*` — input device state changes

### RequestHandler (`src/lib/services/state/requestHandler.ts`)

**Before:** Imports ShellState, WindowManager, Screenshot, Touchpad, and widget functions.

**After:** Imports only the bus. Maps CLI arguments to bus events:

```ts
import {bus} from '#/lib/core/eventBus';

const commandRoutes: Record<string, (app: Gio.Application, args: string[]) => void> = {
    lockscreen:               () => bus.emit('shell:lockscreen'),
    clipboard:                () => bus.emit('shell:clipboard:toggle'),
    screenshot:               () => bus.emit('capture:screenshot', true),
    'screenshot-area':        () => bus.emit('capture:screenshot:area'),
    'screenshot-overlay':     () => bus.emit('capture:screenshot:overlay'),
    record:                   () => bus.emit('capture:record'),
    'record-area':            () => bus.emit('capture:record:area'),
    'record-window':          () => bus.emit('capture:record:window'),
    'record-window-address':  (app, args) => bus.emit('capture:record:window:address', args[2] || ''),
    'record-output':          () => bus.emit('capture:record:output'),
    touchpad:                 () => bus.emit('input:touchpad:toggle'),
    toggle: (app, args) => {
        const target = args[2];
        if (target) bus.emit(`shell:${target}:toggle` as any);
    },
};
```

`registerActions(app)` is removed. Instead, each service registers its own GActions.

### Per-Service Command Registration

Each service that handles commands gains a `registerCommands(app: Gio.Application)` method:

```ts
// ShellState — registers all shell:* GActions
registerCommands(app: Gio.Application) {
    const actions: Record<string, () => void> = {
        'toggle-applauncher': () => this.toggleLauncher(),
        'toggle-quicksettings': () => this.toggleQuickSettings(),
        'toggle-bar': () => this.toggleBar(),
        'toggle-windowswitcher': () => this.toggleWindowSwitcher(),
        'toggle-settings': () => this.toggleSettings(),
        'toggle-clipboard': () => this.toggleClipboard(),
        'open-clipboard': () => this.openClipboard(),
        lockscreen: () => { this.screenlocked = true; },
    };
    for (const [name, fn] of Object.entries(actions)) {
        const action = Gio.SimpleAction.new(name, null);
        action.connect('activate', fn);
        app.add_action(action);
    }
}
```

New methods added to ShellState:
- `toggleBar()` — toggles bar visibility via WindowManager
- `toggleWindowSwitcher()` — delegates to the existing `toggleWindowSwitcher` widget function
- `toggleSettings()` — delegates to the existing `openSettings` widget function

```ts
// Screenshot — registers all capture:* GActions
registerCommands(app: Gio.Application) {
    const actions: Record<string, () => void> = {
        screenshot: () => this.screenshot(true),
        'screenshot-area': () => this.screenshot(false),
        'screenshot-overlay': () => this.toggleOverlay(),
        record: () => this.toggleRecording(),
        'record-area': () => this.recordArea(),
        'record-window': () => this.recordWindow(),
        'record-output': () => this.recordOutput(),
    };
    for (const [name, fn] of Object.entries(actions)) {
        const action = Gio.SimpleAction.new(name, null);
        action.connect('activate', fn);
        app.add_action(action);
    }
}
```

```ts
// Touchpad
registerCommands(app: Gio.Application) {
    const action = Gio.SimpleAction.new('toggle-touchpad', null);
    action.connect('activate', () => this.toggle());
    app.add_action(action);
}
```

### Init Chain Changes

In `App.tsx`, the `registerActions(this)` call is replaced with per-service `registerCommands` calls:

```ts
// App.tsx constructor
ShellState.get_default().registerCommands(this);
Screenshot.get_default().registerCommands(this);
Touchpad.get_default().registerCommands(this);
```

The `registerActions` function in `requestHandler.ts` is deleted.

### Testing

- **EventBus**: Subscribe, emit, assert listener called. Unsubscribe, emit, assert NOT called. Multiple listeners.
- **RequestHandler**: Existing tests in `requestHandler.test.ts` are updated to assert that the correct bus event is emitted (mock/spy on `bus.emit`) instead of asserting action activation.
- **Service registration**: Each service's `registerCommands()` can be tested by calling it with a mock `Gio.Application` and verifying the correct actions are registered.

---

## Files Summary

### Phase 1 (5 files)

| File | Change |
|------|--------|
| `src/lib/settings/schema.ts` | Add 3 keys to `generalSchema` |
| `src/lib/services/location/weather.ts` | Write to general GSettings on update |
| `src/lib/services/display/colorScheme.ts` | Drop `Weather` import, read from GSettings |
| `src/lib/services/display/nightLight.ts` | Drop `ColorScheme` import, read from GSettings |
| `src/widget/index.tsx` | Flatten init chain |

### Phase 2 (7 files)

| File | Change |
|------|--------|
| `src/lib/core/eventBus.ts` | **New** — typed event bus |
| `src/lib/services/state/requestHandler.ts` | Rewrite: CLI → bus events, drop all service imports |
| `src/lib/services/state/shellState.ts` | Add `registerCommands(app)`, `toggleBar()` method |
| `src/lib/services/capture/screenshot.ts` | Add `registerCommands(app)` |
| `src/lib/services/input/touchpad.ts` | Add `registerCommands(app)` |
| `src/App.tsx` | Replace `registerActions(this)` with per-service `registerCommands` |
| `src/widget/index.tsx` | Simplify init chain |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| GSettings write contention (Weather writes while ColorScheme reads) | GLib GSettings is thread-safe; writes are atomic. The read-subscribe pattern handles this naturally. |
| EventBus memory leaks (forgotten unsubscribes) | `on()` returns an unsubscribe function. Use `connectFor`-style cleanup in widgets. For services, unsubscribe in `dispose()`. |
| Breaking change to `init()` signatures | Backward-compatible: old signatures were only called from `widget/index.tsx`, which is updated in the same commit. |
| GSettings double precision for timestamps | `double` (IEEE 754) has 53-bit mantissa, precise to microseconds for dates ±285 years from epoch. Safe for sunrise/sunset timestamps. |
| RequestHandler test breakage | Existing tests are updated in Phase 2 to assert bus events instead of action activations. No coverage loss. |

---

## Future Extensions

After Phase 2, the EventBus can be used for:
- **Cross-cutting features**: e.g., `'system:dnd:toggle'` listened to by audio, notifications, and idle services simultaneously
- **Widget-to-widget communication**: replace direct `ShellState` imports in widgets with bus subscriptions
- **Plugin system**: third-party services can listen to standard events without modifying core code
- **Logging/monitoring**: a single listener on `'*'` can log all events for debugging