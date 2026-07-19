# Widget Code Convention

## Service–Widget Boundary

Widgets **declare**, services **execute**.

### ✅ Allowed in widgets

- `createBinding(service, 'prop')` for reactive state subscriptions
- Calling semantic command methods: `service.toggle()`, `service.stopRecording()`
- Simple UI logic: visibility toggles, focus management, animation state

### ❌ Forbidden in widgets

- **Shell commands**: no `Process.exec`, `Process.execAsync`, `GLib.spawn*`
- **Raw GI service types**: no `AstalAuth`, `Gtk4SessionLock`, `GWeather`, `Cairo`
- **Service lifecycle**: no `new AstalAuth.Pam()`, no `fingerprint.start()`, no brightness save/restore
- **Data transformation**: no extracting/parsing raw GWeather info, no JSON parsing of hyprctl output

### Rationale

Business logic, shell commands, and lifecycle management belong in services under `src/lib/services/`. Widgets should be pure UI — they bind to reactive properties and call high-level methods. This makes services testable and widgets replaceable.

### Guardrails

The ESLint config enforces `no-restricted-imports` for `src/widget/**`:

| Blocked import | Use instead |
|---|---|
| `#/lib/core/process` | Service method (e.g. `SessionControl.logout()`) |
| `gi://AstalAuth*` | `AuthSession` service |
| `gi://Gtk4SessionLock*` | `AuthSession` service |
| `gi://GWeather*` | `Weather` service getters |
| `gi://cairo*` | Drawing methods on the relevant service |
