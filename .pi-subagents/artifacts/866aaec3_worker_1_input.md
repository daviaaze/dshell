# Task for worker

[Read from: /home/daviaaze/Projects/pessoal/dshell/context.md, /home/daviaaze/Projects/pessoal/dshell/plan.md]

Fix GI type stubs and related source files in /home/daviaaze/Projects/pessoal/dshell.

## File 1: src/types/gi-modules.d.ts — add missing APIs

### Secret (keyManager.ts:138 — `password_clear_sync` missing)
Add to Secret namespace stub:
```ts
function password_clear_sync(schema: Schema, attributes: Record<string, string>, cancellable: unknown): boolean;
```

### AstalGreet.Greeter (GreetSession.ts — missing create_session, post_auth, start_session_finish)
Add to Greeter class stub:
```ts
create_session(username: string): void;
post_auth(response: string): void;
start_session_finish(res: unknown): void;
```

### AstalBrightness.Brightness (brightness.ts:35,47 — readonly props)
Change `readonly screen: number; readonly kbd: number;` → `screen: number; kbd: number;` (remove readonly)

### AstalCava — add new stub module
Add after AstalWl block:
```ts
declare module 'gi://AstalCava' {
  import type GObject from 'gi://GObject';
  namespace AstalCava {
    class Cava extends GObject.Object {
      bars: number;
      framerate: number;
      active: boolean;
      get_values(): number[];
    }
  }
  export default AstalCava;
}
```

### imports.gi.AstalCava typing for cava.tsx
Add a declaration for the `imports.gi` for AstalCava:
```ts
declare global {
  namespace imports {
    namespace gi {
      const AstalCava: typeof import('gi://AstalCava') | undefined;
    }
  }
}
```
But check if `imports` is already globally typed by @girs/gjs. If it conflicts, use the pattern from the existing code: cast `(imports.gi as Record<string, unknown>).AstalCava` in cava.tsx. Read the existing cava.tsx code first to decide.

## File 2: src/lib/services/display/brightness.ts — fix wrong API + null guards
- Line 35/47: fix assignment to readonly (already fixed by stub change above — remove readonly)
- Line 55: `AstalBrightness.get_default()` → `AstalBrightness.Brightness.get_default()` (the real GI module has get_default on the class, not the module)
- Lines 58,61: `this.#service` possibly null in constructor closures. Fix: capture local var `const svc = AstalBrightness.Brightness.get_default();` and use `svc.connect(...)` instead of `this.#service.connect(...)` since `this.#service = svc;` is just called before.

## File 3: src/lib/settings/schema.ts — add cava keys to generalSchema

Add three keys before the 'weather-is-daytime' key:
```ts
// ── Audio Visualizer (Cava) ──────────────────────────────────────
.key('cava-enabled', 'b', {
  default: false,
  summary: 'Show audio visualizer in quick settings',
})
.key('cava-bars', 'i', {
  default: 16,
  summary: 'Number of bars in the audio visualizer',
  range: {min: 4, max: 64},
})
.key('cava-framerate', 'i', {
  default: 60,
  summary: 'Frame rate of the audio visualizer',
  range: {min: 15, max: 120},
})
```

## File 4: src/widget/quicksettings/cava.tsx — fix imports.gi access + settings keys

Replace the `AstalCava` lazy load blob (lines 4-16) with:
```ts
const AstalCava = (() => {
  try {
    return (imports.gi as unknown as Record<string, unknown>).AstalCava as typeof import('gi://AstalCava') | null;
  } catch {
    return null;
  }
})();
```
Wait — `typeof import('gi://AstalCava')` won't resolve until the stub is declared. Instead just use a simple `any` cast pattern matching the project style, or if the stub is declared above, it will work. Safer: keep the dynamic import but cast with `as any`:
```ts
const AstalCava = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (imports.gi as any).AstalCava;
  } catch {
    return null;
  }
})();
```

Also fix the cava try/catch for versions (line 4-9) — it's `imports.gi.versions.AstalCava` which should work since `versions` is typed as `Record<string, string>`. If there's no type error on line 6, leave it.

## Validation
Run `cd /home/daviaaze/Projects/pessoal/dshell && pnpm run check > /tmp/tsc-agent2.txt 2>&1; echo EXIT=$?` after editing.

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