# Progress

## Status
Completed

## Tasks
- [x] Fix Service interface: make init optional + add `object` intersection for TS6 compat
- [x] Remove unused `wm` variable from `getWidgetDescriptors()` in index.tsx
- [x] Fix soundAlerts.ts: change `#shellState`/`#dndService` field types to cache objects
- [x] Fix soundAlerts.ts: update lazy getters to pass cache objects to `#getDep`
- [x] Fix networkUtils.test.ts: replace `require('gi://AstalNetwork')` with top-level import
- [x] Fix greeter/main.ts: use `Gtk.Application` instead of `Gio.Application`

## Files Changed
- src/lib/core/serviceRegistry.ts
- src/widget/index.tsx
- src/lib/services/audio/soundAlerts.ts
- src/lib/__tests__/networkUtils.test.ts
- src/apps/greeter/main.ts

## Notes
- All 4 target files now pass type checking
- Remaining errors in tsc output are pre-existing in other files (gnim module types, collisionManager, etc.)
- TypeScript 6.0.3 requires at least one common property for structural compatibility with all-optional interfaces; `object &` intersection resolves this
