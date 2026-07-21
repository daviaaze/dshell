Here is the complete summary of changes and verification.

---

**Implemented:** 5 files changed to fix 8 type errors across 4 files.

**Changed files:**

| File | Change |
|------|--------|
| `src/lib/core/serviceRegistry.ts` | Changed `Service` from interface to `type Service = object & { init?(...args: unknown[]): void; dispose?(): void; }`. Makes `init` optional (per task) and adds `object` intersection to satisfy TS6's "at least one common property" check. |
| `src/widget/index.tsx` | Removed unused `const wm = WindowManager.get_default();` from `getWidgetDescriptors()` |
| `src/lib/services/audio/soundAlerts.ts` | Changed `#shellState`/`#dndService` from `T | undefined` to `{v?: T} = {}` cache objects; updated `#shell`/`#dnd` getters to pass cache objects to `#getDep` |
| `src/lib/__tests__/networkUtils.test.ts` | Replaced inline `require('gi://AstalNetwork')` with top-level `import AstalNetwork from 'gi://AstalNetwork'`; used `AstalNetwork.DeviceState.*` throughout |
| `src/apps/greeter/main.ts` | Added `import Gtk from 'gi://Gtk?version=4.0'`; changed `new Gio.Application(...)` to `new Gtk.Application(...)` |

**Validation:** `pnpm run check` (tsc --noEmit) — **All 8 targeted errors eliminated**. Remaining errors are pre-existing in unrelated files (gnim module types, collisionManager, etc.).

**Residual risks:** None. The `object &` intersection on `Service` type accepts any non-primitive, but the runtime already duck-checks `typeof reg.service.init !== 'function'`. The change widens the type contract without behavioral change.

**No staged files.**