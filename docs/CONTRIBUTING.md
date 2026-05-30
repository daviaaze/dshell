# Contributing to Shade Shell

## Development Setup

```bash
# Enter Nix dev shell (provides all dependencies)
nix develop

# Install Node deps
pnpm install

# Generate GIR TypeScript types (required before type-checking)
pnpm run types

# Type-check
pnpm run check

# Lint
pnpm run lint

# Full validation
pnpm run check:all

# Build (validates bundle + schema, not a runnable binary)
pnpm run build

# Run in VM
nix run .#nixosConfigurations.vm.config.system.build.vm
```

## Architecture Invariants

See [AGENTS.md](./AGENTS.md) for the complete list. Critical ones:

1. **`GObject.notify()` is always kebab-case** — `this.notify("launcher-open")` not `this.notify("launcherOpen")`
2. **`Notifd.get_default()` must be deferred** via `GLib.idle_add` — never call synchronously
3. **`GLib.List` is not iterable** — use `toArray()` from `#/lib/gjsUtils`
4. **`<For>` cannot nest inside `<With>`** — use reactive `visible` bindings instead

## Code Style

- No semicolons (enforced by Prettier)
- 2-space indentation
- Follow surrounding patterns for quotes, naming, imports
- All services use the `static get_default()` singleton pattern with GObject
- Widget mount order in `src/widget/index.tsx` is critical — each widget wrapped in `safe()` for error isolation

## Test Coverage Policy

### Minimum for New Service Classes

Every new service class in `src/lib/` requires a smoke test that validates:

1. **Singleton pattern** — `get_default()` returns the same instance
2. **Core initialization** — `init()` succeeds with valid settings
3. **Dispose cleanup** — `dispose()` releases resources without errors

### Test Location

Tests live alongside their targets:

```
src/lib/__tests__/
  ├── hypridle.test.ts
  ├── clipboard.test.ts
  └── ...
```

### Running Tests

```bash
# Compile and run Hypridle smoke tests
pnpm run test

# Or in CI (compile then run in Nix dev shell)
pnpm run test:compile
nix develop -c gjs -m build/test/hypridle.test.js
```

Tests use a lightweight harness (see `src/lib/__tests__/test-runner.ts`). The API:

```typescript
import { describe, it, expect, run } from "./test-runner"

describe("MyService", () => {
  it("should work", () => {
    expect(actual).toBe(expected)
  })
})

run(import.meta.url)
```

Available matchers: `toBe`, `toEqual`, `toBeGreaterThan`, `toBeLessThan`, `toBeTruthy`, `toBeFalsy`, `toThrow`.

### What to Test

| Component | What to verify | Priority |
|-----------|---------------|----------|
| Service class `init()` | Handles null/valid/invalid settings, double-init guard | High |
| Service class `dispose()` | Cleans up processes, timers, subscriptions | High |
| Config generation (`#writeConfig`, `#validate`) | Produces valid syntax, clamps values, handles edge cases | Medium |
| D-Bus actions (`requestHandler`) | Maps CLI args to correct actions | Medium |
| Widget mount (`safe()`) | Catches and logs errors, doesn't crash siblings | Low |

### What Doesn't Need Tests (Today)

- Gnim reactive bindings in `.tsx` files (manual testing via VM is sufficient)
- GTK widget layout/styling (not testable with unit tests)
- Astal D-Bus backends (tested upstream)

## Commit Convention

```
type(scope): short description (≤50 chars)

- bullet point details
- more details
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `security`

Scopes: `hypridle`, `bar`, `dock`, `qs` (quicksettings), `notifications`, `lockscreen`, `settings`, `lib`, `build`, `nix`
