# Task for worker

[Read from: /home/daviaaze/Projects/pessoal/dshell/context.md, /home/daviaaze/Projects/pessoal/dshell/plan.md]

Fix two foundational type errors in the dshell project at /home/daviaaze/Projects/pessoal/dshell.

## File 1: src/lib/core/eventBus.ts — emit signature (clears 11 errors across 4 files)

Current emit signature requires 2 args even when EventMap[K] is void:
```ts
emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void
```

Fix: use conditional rest-args tuple so void-payload events can be emitted with 1 arg:
```ts
emit<K extends keyof EventMap>(event: K, ...args: EventMap[K] extends void ? [] : [payload: EventMap[K]]): void
```

This fixes errors in: captureFlow.ts (5), shellState.ts (4), touchpad.ts (1), requestHandler.ts (1) — all bus.emit calls with void events like `bus.emit('capture:screenshot:area')`.

## File 2: src/types/gnim-overrides.d.ts — signal() decorator context type (clears 4 errors)

Current override declares `SignalContext<M>` as `ClassFieldDecoratorContext` but `@signal` decorates methods (ClassMethodDecoratorContext). Error: kind "method" vs "field" mismatch.

Also `@signal(String)` return type: decorator returns `(this, args) => void` not assignable to method returning `undefined`.

Fix the override: change SignalContext to ClassMethodDecoratorContext, and make the signal() decorator return the method's own type (generic) like gnim's original:

```ts
type SignalContext<M extends (...args: any[]) => any> = ClassMethodDecoratorContext<GObject.Object, M>;

export function signal(...args: any[]): <This extends GObject.Object, M extends (this: This, ...args: any[]) => any>(method: M, ctx: ClassMethodDecoratorContext<This, M>) => M;
```

This fixes errors in: fingerprint.ts (1), keyboard.ts (1), frecency.ts (1), authSession.ts (2).

## Validation
After editing both files, run `node --check <file>` on each. Then run `cd /home/daviaaze/Projects/pessoal/dshell && pnpm run check > /tmp/tsc-agent1.txt 2>&1; echo EXIT=$?` to verify the errors dropped — we expect the 4 bus.emit errors in shellState.ts, touchpad.ts, requestHandler.ts to disappear, plus 4 @signal decorator errors. captureFlow.ts and authSession.ts errors also fixed (potentially more).

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