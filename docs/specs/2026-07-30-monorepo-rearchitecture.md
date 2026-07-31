# Spec: Monorepo Rearchitecture

> Design contract for splitting `shade-shell` into real pnpm workspace
> packages, removing direct cross-layer coupling, and making inter-domain
> communication event-driven. Implementation follows the phases in
> §Migration; each phase lands green and is independently revertible.

## Context & goals

`shade-shell` is a GJS/GNOME shell built as a single package with three
apps (`shell`, `greeter`, `share-picker`) and three internal layers
(`lib/core`, `lib/services`, `widget/*`, `style`). Today:

- **18 circular dependencies**, 15 of them a single cycle family:
  `apps/shell/App.tsx → widget/index.tsx → widget/<any>/index.tsx → apps/shell/App.tsx`
- **210 direct widget→service imports**; the event bus (`lib/core/eventBus.ts`)
  exists but is used by only 7 of 197 files
- `Screenshot` is a GObject god-class (393 lines, 55 outgoing refs) with
  3 internal cycles
- `widget/index.tsx` is a 43-module barrel (fan-out anti-pattern)

Goals: real package boundaries (enforced, not convention), 0 cycles,
commands-via-bus + read-only reactive state, and an incremental migration
that keeps `main` green at every step.

## Decisions locked

| # | Decision | Choice |
|---|----------|--------|
| 1 | End state | **Real pnpm packages** |
| 2 | Granularity | **Coarse (~7 pkgs)** |
| 3 | Event depth | **Commands via bus, state read-only** |
| 4 | Migration | **Incremental, always green** |
| 5 | Contracts | **Per-domain `contract.ts` modules** |

## Architecture

### Package layout

```
apps/                              ← composition roots; nothing imports these
  shell/        @shade/app-shell
  greeter/      @shade/app-greeter
  share-picker/ @shade/app-share-picker
packages/
  core/         @shade/core     — createBus<Events>(), logger, process,
                                 decorators, file, time, timeout, gjsUtils.
                                 ZERO domain knowledge.
  services/     @shade/services — domains: state, capture, notifications,
                                 power, shell. Each domain exposes ONLY via
                                 sub-path exports:
                                   "@shade/services/capture"
                                       → contract.ts  +  state facade
  widgets/      @shade/widgets  — all 15 widgets
  style/        @shade/style    — theme, palette
```

### Dependency DAG

```
apps ─→ widgets ─→ services ─→ core
  └──────┴────────→ style ────→ core
```

Enforced two ways:
1. `package.json` `dependencies` declarations per package.
2. pnpm `"exports"` maps that make package internals physically unimportable
   (services internals cannot be reached from widgets — only the domain's
   `contract.ts` + state facade are exported).

Rules:
- `core` → nothing internal.
- `services` → `core` only. Cross-domain communication inside services is via
  bus contracts, never direct imports between domains.
- `widgets` → `core`, `style`, and services **sub-path exports only**.
- `apps` → everything; sole composition root.

Coarse packages still enforce *domain* boundaries through sub-path exports:
`@shade/services` is one package, but `@shade/services/capture` exposes only
its `contract.ts` + read-only `CaptureState` facade — the `Screenshot` class
and its helpers stay private.

### Event contract design

The bus mechanism moves to core and becomes generic — `createBus<Events>()` —
so each domain's contract types its own slice. A contract module:

```ts
// packages/services/src/capture/contract.ts
export interface CaptureEvents {
    'capture:screenshot': {fullScreen: boolean};
    'capture:screenshot:area': void;
    'capture:record': {target: 'window' | 'output' | 'area'};
}
export interface CaptureState {        // read-only, gnim-reactive facade
    readonly recording: boolean;
    readonly lastScreenshot: string | null;
}
```

Each domain's `index.ts` (its only public sub-path) exports the contract, the
state facade, and a `register(bus)` that wires the domain's handlers. Apps
call `register()` at startup; widgets only ever see the contract types and
emit events. Existing `shell:*` / `capture:*` / `system:*` event names already
imply the domain boundaries and are preserved.

### Removing the `app` singleton

Widgets today import `{app}` from `apps/shell/App.tsx` for two reasons:

1. **Trigger UI actions** (toggle quicksettings, open launcher, …) → become
   bus emits. Most target events already exist (`shell:qs:toggle`,
   `shell:launcher:toggle`, …); ~80% of uses convert with zero new
   infrastructure.
2. **Reach GTK window objects** (e.g. `PopupWindow` for positioning) → move
   into the **widget descriptor contract**: the shell app passes what each
   widget needs at registration time. `getWidgetDescriptors`/`registerServices`
   already exist; the descriptor gains a typed application/window handle
   provided by the composition root.

Dependency flows apps→widgets via the descriptor, never back. `shellState`
moves into services as the `shell` domain so `bus.on('shell:qs:toggle')` is
owned by services, not the app. The app package keeps only GTK bootstrapping.

The 15 barrel cycles die because `widget/index.tsx`'s 43-module fan-out is
replaced by explicit per-widget registration in the app package.

### Capture service split (last 3 cycles)

```
screenshot.ts  (GObject: properties, signals, gnim registration)
   │  creates & owns
   ▼
CaptureSession  (plain TS: prefs, recorder ref, targets, stage geometry.
                 Imports nothing from above.)
   ▲                 passed as first arg
captureFlow.ts   commands.ts   recordTargets.ts
(helpers become functions: doAreaShot(session), registerCommands(session), …)
```

Rules making the 3 cycles structurally impossible:
1. Helpers import `types.ts` + core utilities **only** — never `screenshot.ts`.
2. `Screenshot` is the only importer of helpers (in-domain composition root).
3. `captureFlow`'s current `import type Screenshot` becomes a narrow
   `CaptureSignals` interface (the 2–3 signals it triggers).

Public surface via `@shade/services/capture`: `contract.ts`, `CaptureState`
facade, `register(bus)`. `widget/quicksettings/button-grid` switches from
importing the class to binding the facade + emitting bus events.

## Migration phases (each independently green)

**Phase 0 — Guardrails.** Add `eslint-plugin-import` (`import/no-cycle`,
`import/no-restricted-paths`) encoding today's allowed directions; suppress
the 18 existing cycles inline with a tracking issue. Regenerate the dep
graph in CI. *Gate: green, cycles baseline-recorded.*

**Phase 1 — Generic bus + contracts.** `createBus<Events>()` → core; existing
`EventMap` becomes the `shell` domain contract; capture/system contracts
extracted. No behavior change. *Pure refactor, small diff.*

**Phase 2 — `app` singleton removal.** Widget `import {app}` uses → bus
emits + descriptor handle. `shellState` → services `shell` domain. Deletes
15 cycles. Largest phase but mechanical and file-by-file.

**Phase 3 — Capture split.** Session extraction per §Capture service split.
Deletes last 3 cycles. All inline cycle suppressions removed —
`import/no-cycle` runs at zero tolerance.

**Phase 4 — Physical move.** Files → `packages/` + `apps/` layout;
`pnpm-workspace.yaml` gains packages; tsconfig project references / path
aliases; imports rewritten by codemod. No logic change — the import graph is
already legal from prior phases.

**Phase 5 — Package enforcement + nix.** Per-package `dependencies` +
`workspace:*`; `"exports"` maps lock down internals; nix build bundles each
app from the workspace. Dep-graph CI gate: 0 cycles, 0 upward edges.

Phases 1–3 are pure refactors; 4–5 are mechanical. Stopping after any phase
leaves the repo better than today.

## Testing & enforcement

- **Per-package tests**: existing `__tests__` move with code; capture helpers
  gain unit tests via a mock `CaptureSession` (the testability payoff of
  Phase 3 — no GTK app needed).
- **CI gates**: `pnpm check:all` per workspace; eslint boundary rules; a
  `madge --circular` step that fails on any cycle.
- **Living dep graph**: `scripts/deps-graph.sh` regenerates the SVG in CI and
  diffs the coarse edge set against an allowlist — new cross-layer edges fail
  the build.

## Out of scope

- New features / UI changes.
- Changing the GJS/gnim reactivity model (we work with it, not against it).
- Changing the nix single-bundle-per-app output format.
