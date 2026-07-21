# Task for worker

[Read from: /home/daviaaze/Projects/pessoal/dshell/context.md, /home/daviaaze/Projects/pessoal/dshell/plan.md]

Fix miscellaneous type errors in /home/daviaaze/Projects/pessoal/dshell.

## File 1: src/widget/index.tsx — 2 errors

1. Line 104: `Property 'init' is missing in type 'ShellState' but required in type 'Service'`.
Fix: make `init` optional in the Service interface in src/lib/core/serviceRegistry.ts:
```ts
export interface Service {
  init?(...args: unknown[]): void;
  dispose?(): void;
}
```
The runtime already checks `typeof reg.service.init !== 'function'` and skips, so the type should match.

2. Line 193: `'wm' is declared but its value is never read`. In getWidgetDescriptors(), `const wm = WindowManager.get_default();` is unused. Just delete that line:
```ts
function getWidgetDescriptors(): WidgetDescriptor[] {
-    const wm = WindowManager.get_default();
     return [
```

## File 2: src/lib/services/audio/soundAlerts.ts — 4 errors

Issues:
- Lines 52, 53: `#shellState` and `#dndService` fields are declared but never read.
- Lines 63, 67: `this.#getDep('ShellState', this)` — `this` doesn't have `{v?: T}` shape.

The `#getDep` method expects a cache `{v?: T}`. The dead fields should BE the cache. Fix:
1. Change field types from `T | undefined` to `{v?: T}`:
```ts
-  #shellState?: import('#/lib/services/state/shellState').default;
-  #dndService?: import('#/lib/services/notifications/dnd').default;
```
→
```ts
  #shellState: {v?: import('#/lib/services/state/shellState').default} = {};
  #dndService: {v?: import('#/lib/services/notifications/dnd').default} = {};
```

2. Change the lazy getters to pass the cache objects:
```ts
  get #shell(): import('#/lib/services/state/shellState').default {
    return this.#getDep('ShellState', this.#shellState);
  }

  get #dnd(): import('#/lib/services/notifications/dnd').default {
    return this.#getDep('DndService', this.#dndService);
  }
```

## File 3: src/lib/__tests__/networkUtils.test.ts — 1 error

Line 45: `require('gi://AstalNetwork')` — 'require' not found in ES module context.
Fix: import at top of file instead:
- Remove `// eslint-disable-next-line @typescript-eslint/no-require-imports`
- Replace `const {DeviceState} = require('gi://AstalNetwork');` inside the test with a top-level import:
```ts
import AstalNetwork from 'gi://AstalNetwork';
```
At the top of the file (after the other imports), then use `AstalNetwork.DeviceState` in the tests.
Check the existing imports structure at top of file and add it there.

## File 4: src/apps/greeter/main.ts — 1 error

Line 36: `Greeter({application: app})` where `app` is `Gio.Application` but Greeter expects `Gtk.Application`.
Fix: construct a `Gtk.Application` instead of `Gio.Application`:
```ts
import Gtk from 'gi://Gtk?version=4.0';
// ...
const app = new Gtk.Application({
  applicationId: appId,
  flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});
```
Check if Gtk.Application constructor accepts `flags` — in GTK4, Gtk.Application extends Gio.Application so flags works. Update import: remove the `Gio` import if no longer needed, or keep both.

## Validation
After edits, run `cd /home/daviaaze/Projects/pessoal/dshell && pnpm run check > /tmp/tsc-agent4.txt 2>&1; echo EXIT=$?` to verify.

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