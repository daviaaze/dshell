# Service–Widget Boundary Refactor

**Date:** 2026-07-18
**Last updated:** 2026-07-18 (Phase 1–5 complete)
**Status:** Implemented
**Author:** AI pair programming session

## Problem

Widgets across the codebase leak service logic in several ways:

1. **Inline shell commands** — `Process.exec('systemctl reboot')`, `GLib.spawn_command_line_async('uwsm-app ...')`, `Process.exec('hyprctl clients -j')`
2. **Service lifecycle managed by widgets** — PAM auth state machine in `lockscreen/index.tsx` (timeouts, signal handling, fingerprint lifecycle)
3. **Direct property mutation** — `ShellState.get_default().screenlocked = true`
4. **Data transformation logic** — `useWeatherData()` extracting GWeather info, search routing + frecency re-rank in applauncher
5. **Reverse boundary violation** — `ShellState` (service) imports from `#/widget`

## Principle

**Widgets declare, services execute.** Widgets may:
- `createBinding(service, 'prop')` for reactive state
- Call semantic command methods (`service.toggle()`, `service.stopRecording()`)

Widgets must NOT:
- Import `Process`, `GLib.spawn*`, execute shell commands
- Import `AstalAuth`, `SessionLock`, `GWeather`, `cairo`
- Contain business state machines, timeouts, or data transformation pipelines

## Architecture Pattern: Rich Services + Bindings

Services are GObject singletons with:
- `@getter` reactive properties (consumed by widgets via `createBinding`)
- `@setter` for command-style mutations with internal logic
- Methods that encapsulate business logic (shell exec, lifecycle, data fetch)

```
┌─────────────┐     createBinding / method call     ┌──────────────┐
│   Widget    │ ──────────────────────────────────▶ │   Service    │
│  (.tsx)     │ ◀────────────────────────────────── │  (GObject)   │
│             │     notify / GObject signals          │              │
└─────────────┘                                      └──────────────┘
                                                           │
                                                           ▼
                                                    Process.exec,
                                                    D-Bus, GWeather,
                                                    AstalAuth, PAM
```

## Phases

### Phase 1 — Shell Commands (priority: critical) ✅

| Location | What leaks | Fix | Status |
|---|---|---|---|
| `powerMenu.tsx` | `Process.exec('systemctl reboot')` etc. | New `SessionControl` service: `lock()`, `logout()`, `suspend()`, `reboot()`, `powerOff()` | ✅ done |
| `systemUsage.tsx` | `Process.execAsync(settings.bar.systemMonitor())` | Method `SystemUsage.launchMonitor()` or callback passed at init | ✅ done |
| `appButton.tsx` | `GLib.spawn_command_line_async('uwsm-app ...')` | Add `AppsService.launch(application)` in `src/lib/services/state/apps.ts` | ✅ done — `launchApp()` added |
| `region-selector/index.tsx` | `Process.exec('hyprctl clients -j')` | Move to `HyprlandService` helper or existing window service | ✅ done |
| `dock/item.tsx` | `GLib.spawn_command_line_async('gtk-launch ...')` | `launchDesktopFile(entry)` in `apps.ts` + ESLint `no-restricted-properties` for `GLib.spawn*` | ✅ done (2026-07-18) |

### Phase 2 — Lifecycle (priority: high) ✅

| Location | What leaks | Fix | Status |
|---|---|---|---|
| `lockscreen/index.tsx` | PAM auth (`pam.supply_secret()`, `pam.start_authenticate()`), fingerprint lifecycle, brightness save/restore | New `AuthSession` service encapsulating PAM + fingerprint + timeout. Widget receives `onUnlock` callback only | ✅ done — `authSession.ts` |
| `lockscreen/index.tsx` | `Gtk4SessionLock` import (lock lifecycle: `Instance.new`, `lock()`, `unlock()`, `assign_window_to_monitor()`) | New `SessionLockService` in `src/lib/services/session/sessionLockService.ts` | ✅ done (2026-07-18) |

AuthSession service (`src/lib/services/session/authSession.ts`):
- `start()` — inits PAM + fingerprint
- `submitPassword(pw: string)` — delegates to PAM
- `cancel()` — cleanup
- Signals: `success`, `fail(message)`, `auth-status-changed(status)`
- Internal timeout, brightness save/restore lifecycle

SessionLockService (`src/lib/services/session/sessionLockService.ts`):
- Wraps `Gtk4SessionLock.Instance`
- `lock()` / `unlock()` — delegates to SessionLock
- `assignWindow(window, monitor)` — assigns GTK windows to locked session monitors

### Phase 3 — State Mutations (priority: medium) ✅

| Location | What leaks | Fix | Status |
|---|---|---|---|
| `powerMenu.tsx` | `ShellState.get_default().screenlocked = true` | Method `shellState.lock()` | ✅ done |
| `applauncher/index.tsx` | `ShellState.get_default().qsOpen = false` | Method `shellState.closeQuickSettings()` | ✅ done |
| `lockscreen/index.tsx` | `ShellState.get_default().screenlocked = false` | Method `shellState.unlock()` | ✅ done (`unlock()` already existed) |
| `quicksettings/index.tsx` | `ShellState.get_default().launcherOpen = false` | Method `shellState.closeLauncher()` | ✅ done (2026-07-18) — added `closeLauncher()` to `shellState.ts` |
| `quicksettings/tray.tsx` | `ShellState.get_default().screenlocked = true` / `qsOpen = false` | `shellState.lock()` / `shellState.closeQuickSettings()` | ✅ done (2026-07-18) |
| `applauncher/index.tsx` | `ShellState.get_default().launcherQuery = ''` / `launcherOpen = self.visible` in `onNotifyVisible` | `shellState.closeLauncher()` | ✅ done (2026-07-18) |

### Phase 4 — Data Logic (priority: low) ✅ (partial)

| Location | What leaks | Fix | Status |
|---|---|---|---|
| `weatherWidget.tsx` | `useWeatherData()` extracting GWeather info | Compute properties on `Weather` service | ✅ done — `Weather` service has rich getters (`tempSummary`, `feelsLike`, `skyDesc`, `weatherIcon`, `windSpeed`, `windDirection`, `humidity`, `pressure`, `sunrise`, `sunset`, `moonPhase`, `gradient`, forecast methods) |
| `bar/weather.tsx` | `GWeather.TemperatureUnit.CENTIGRADE` enum for temp formatting — raw `info` binding + manual `.toFixed() + '°C'` | Use `weatherIcon` + `tempSummary` reactive getters | ✅ done (2026-07-18) — ESLint exemption removed |
| `settings/weather.tsx` | `GWeather.Location.get_world()` inline location search | Use `Weather.updateFromCoords(lat, lon)` | ✅ done (2026-07-18) — ESLint exemption removed |
| `applauncher/index.tsx` | Search routing (apps vs clipboard) + frecency re-rank | Move to `LauncherSearch` helper or extend `apps.ts` | ⏳ not started |

### Phase 5 — Reverse Boundary (priority: medium) ✅

| Location | What leaks | Fix | Status |
|---|---|---|---|
| `shellState.ts` | Imports `openSettings` from `#/widget` | Invert: widget calls `shellState.openSettings()`, service emits signal, widget listens in App.tsx wiring | ✅ done |

## Guardrails ✅

### ESLint rules — `src/widget/**`

**`no-restricted-imports`** (active for all `src/widget/**`):
- `#/lib/core/process` — shell execution
- `gi://AstalAuth*`, `gi://Gtk4SessionLock*`, `gi://GWeather*`, `gi://cairo*` — raw GI services

**`no-restricted-properties`** (active for all `src/widget/**`):
- `GLib.spawn_command_line_async`, `GLib.spawn_async`, `GLib.spawn_command_line`

### Exemptions (files with drawing-specific cairo use)

- `src/widget/common/sunArc.tsx`
- `src/widget/recording-boundary/**`
- `src/widget/region-selector/**`
- `src/widget/screenshot-ui/**`

These files are exempt from the cairo, AstalAuth, Gtk4SessionLock, GWeather, and GLib.spawn restrictions. They still cannot import `#/lib/core/process`.

### Documented convention ✅

- `src/widget/README.md` covers the full boundary rules with a table of blocked imports and their service replacements.

## Testing ✅

- `shellState.test.ts` — tests `closeLauncher()` (state mutation + idempotency)
- `sessionLockService.test.ts` — tests singleton contract and constructor
- Validation: `pnpm run check:all` (lint + typecheck + compliance) — all clean

## Remaining work

- **Phase 4 remaining:** `applauncher/index.tsx` search routing + frecency re-rank still in widget (low priority)
- **Cairo exemptions:** sunArc, recording-boundary, region-selector, screenshot-ui — deemed legitimate UI-drawing, kept as documented exemptions
- **GLib.spawn guard:** uses `no-restricted-properties` (catches `GLib.spawn_*` property access) — works for `GLib.` prefixed calls, won't catch destructured `spawn_command_line_async` (no widgets use that pattern)

## Future Considerations (out of scope)

- Full view-model/store layer (overkill for this codebase's GObject-reactive pattern)
- End-to-end widget tests (no framework exists for this GJS+GTK4 setup)
