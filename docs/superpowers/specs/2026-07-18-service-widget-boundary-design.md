# Service–Widget Boundary Refactor

**Date:** 2026-07-18
**Status:** Draft
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

### Phase 1 — Shell Commands (priority: critical)

| Location | What leaks | Fix |
|---|---|---|
| `powerMenu.tsx` | `Process.exec('systemctl reboot')` etc. | New `SessionControl` service: `lock()`, `logout()`, `suspend()`, `reboot()`, `powerOff()` |
| `systemUsage.tsx` | `Process.execAsync(settings.bar.systemMonitor())` | Method `SystemUsage.launchMonitor()` or callback passed at init |
| `appButton.tsx` | `GLib.spawn_command_line_async('uwsm-app ...')` | Add `AppsService.launch(application)` in `src/lib/services/state/apps.ts` |
| `region-selector/index.tsx` | `Process.exec('hyprctl clients -j')` | Move to `HyprlandService` helper or existing window service |

### Phase 2 — Lifecycle (priority: high)

| Location | What leaks | Fix |
|---|---|---|
| `lockscreen/index.tsx` | PAM auth (`pam.supply_secret()`, `pam.start_authenticate()`), fingerprint lifecycle, brightness save/restore | New `AuthSession` service encapsulating PAM + fingerprint + timeout. Widget receives `onUnlock` callback only |

AuthSession service:
- `start()` — inits PAM + fingerprint
- `submitPassword(pw: string)` — delegates to PAM
- `cancel()` — cleanup
- Signals: `success`, `fail(message)`, `auth-status-changed(status)`
- Internal timeout, brightness save/restore lifecycle

### Phase 3 — State Mutations (priority: medium)

| Location | What leaks | Fix |
|---|---|---|
| `powerMenu.tsx` | `ShellState.get_default().screenlocked = true` | Method `shellState.lock()` |
| `applauncher/index.tsx` | `ShellState.get_default().qsOpen = false` | Method `shellState.closeQuickSettings()` |
| `lockscreen/index.tsx` | `ShellState.get_default().screenlocked = false` | Consume existing setter or add `unlock()` method |

### Phase 4 — Data Logic (priority: low)

| Location | What leaks | Fix |
|---|---|---|
| `weatherWidget.tsx` | `useWeatherData()` extracting GWeather info | Compute properties on `Weather` service (`tempSummary`, `windSummary`, `forecasts`, etc.) |
| `applauncher/index.tsx` | Search routing (apps vs clipboard) + frecency re-rank | Move to `LauncherSearch` helper or extend `apps.ts` |

### Phase 5 — Reverse Boundary (priority: medium)

| Location | What leaks | Fix |
|---|---|---|
| `shellState.ts` | Imports `openSettings` from `#/widget` | Invert: widget calls `shellState.openSettings()`, service emits signal, widget listens in App.tsx wiring |

## Guardrails

### ESLint rule — no-restricted-imports

Block these imports in `src/widget/**`:

```js
// eslint.config.js
{
  files: ['src/widget/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        '#/lib/core/process',
      ],
      patterns: [
        'gi://AstalAuth*',
        'gi://Gtk4SessionLock*',
        'gi://GWeather*',
        'gi://cairo*',
      ],
    }],
  },
}
```

### Documented convention

- `src/widget/README.md` or `AGENTS.md` entry: "Widget files must not import Process, AstalAuth, GWeather, Cairo, or Gtk4SessionLock. All business logic belongs in services under `src/lib/services/`."

## Testing

- Each new/modified service method gets a test in `src/lib/__tests__/`
- Validation: `pnpm run check:all` (lint + typecheck + compliance)
- Visual/functional: manual shell session test

## Future Considerations (out of scope)

- Full view-model/store layer (overkill for this codebase's GObject-reactive pattern)
- End-to-end widget tests (no framework exists for this GJS+GTK4 setup)
