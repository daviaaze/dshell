# Spec: Editable compositor integration

## Goal

Make Shade the runtime owner of the user's Hyprland configuration while retaining Nix as the source of defaults. Remove duplicated Lua generation and direct Hyprland IPC from widgets and domain services. Support editing bindings, monitor profiles, startup apps, window rules, compositor options, and input in Shade without a Nix rebuild.

## Decisions

- Hyprland 0.57 is the initial and only compositor backend. No cross-compositor abstraction.
- Nix serializes a versioned, typed seed JSON; it does not render Lua or own runtime edits.
- `compositor-model` is pure TypeScript: validates/merges seed plus user overrides, produces effective state, and is the only Lua emitter.
- Persistent user overrides live in `$XDG_CONFIG_HOME/shade/compositor.json`; render-only output lives in `$XDG_RUNTIME_DIR/shade/hyprland.lua`.
- `CompositorPort` is the sole Hyprland boundary: typed snapshots, typed actions, apply operations, and events. Domain code/UI do not run `hyprctl`, parse `hyprctl` output, or build Lua strings.
- `CompositorStore` owns effective model, persistence, validation, migration, live apply, confirmation/rollback, and state notifications.
- Existing `extraLuaConfig` remains a clearly documented, read-only startup escape hatch; it is not editable or introspected by the UI.
- Existing custom user settings are preserved. One-time migration imports `monitor-layouts.json` into the unified document and never deletes the source file.

## Model and merge

Top-level document is schema-versioned. It contains Nix defaults plus user overrides, with stable IDs for bindings, window rules, startup items, and monitor layouts. User entries can add, replace, disable, or delete seeded entries. Options and input are typed values keyed by supported config paths. Invalid, unknown-version, or unparseable user data falls back to seed at compositor startup and is surfaced as a recoverable error in the shell; it is not overwritten until the user explicitly saves a valid edit.

The schema covers existing Nix defaults and host customizations, including binding flags/actions, monitor profiles/workspace assignments, startup commands, supported window match/effect fields, supported compositor options, and keyboard/touchpad options. Commands are data, never interpolated into shell source; Lua strings use a single correct encoder. The launcher calls the same pure model/emitter as the shell.

## Startup and runtime flow

UWSM launcher invokes `shade-shell compositor render` before `start-hyprland`. It writes the effective Lua to the runtime directory atomically, exports `HYPRLAND_CONFIG` to that file, then execs the pinned `start-hyprland`. If user JSON fails validation, render seed-only config and keep the invalid file for recovery. Essential bindings and settings therefore do not depend on shade-shell being alive.

At runtime, UI calls `CompositorStore.edit(patch)`. Store computes and validates the full candidate, applies the typed diff through the port, then atomically persists it. On apply failure it restores the prior model and does not persist. At compositor restart/reload, the store observes the event and reconciles from the persisted effective model. Every update is idempotent by stable ID.

Use native Lua handles to add/replace/remove binds and named window rules where supported. Runtime changes that are not safely reversible use the existing 15-second preview/confirm/revert transaction. Do not reload the compositor for routine edits. Preserve runtime-only state such as SHADE-VMON; a whole-config reload is a last-resort path and must not be used unless that state is reconciled.

## Store migration

On first load only, when the unified file is absent, import `monitor-layouts.json` and preserve its layouts/current choice. Existing display preview/rollback behavior and layout semantics remain unchanged. The old file remains untouched as a backup. Thereafter the unified store is authoritative; no dual writes.

## UI behavior

- Shortcuts: list from the manifest/model, show action and current chord, capture/remap/add/disable/restore with conflict validation; never infer command descriptions from `hyprctl binds -j`.
- App launcher: show optional chord badges by matching manifest `desktopId` against the desktop entry ID. Only app-launch actions are eligible.
- Startup apps, window rules, compositor options, and input: edit the modeled values, validate, apply with preview where required, and offer reset-to-Nix-default.
- Monitor layout editor is migrated to `CompositorStore`; preserve its current preview/revert UX.
- Key display overlay is off by default and stores no keystroke history. When explicitly enabled, receive XKB key events from the compositor Lua hook over its custom socket event, display an on-screen layer surface with no input region, pause while locked, and cap/expire buffered key state. Explain that it can expose typed text in screen recordings; password fields in arbitrary apps cannot be reliably detected, so the toggle remains obvious and immediately reachable. No privileged input-device reader or key event persistence.

## Error handling and safety

- Schema and domain validation occur before apply or persistence.
- File writes use temp-file + rename; failed writes do not claim success.
- Invalid seed is a build/evaluation error; invalid user data falls back to seed and is reported.
- Key conflicts identify both IDs and the conflicting chord; never silently replace.
- Lock/unlock and monitor/input changes use explicit preview/confirmation and revert on timeout/failure.
- Runtime transport loss leaves stored configuration intact, exposes degraded status, and reconciles when Hyprland returns.
- Generated Lua is verified with Hyprland's config verifier in an isolated process; verification must not execute runtime actions against the user's live compositor.

## Verification

- Pure tests for schema validation, stable-ID merge, conflict detection, migrations, escaping, and Lua output semantics.
- Nix evaluation tests ensure host-resolved settings, workspace rules, binds and cursor environment are represented in the seed.
- Port contract tests exercise typed requests and event parsing without shelling out from consumers.
- Integration smoke: render seed + user overrides, validate Lua using a disposable Hyprland instance/config verifier, apply/remove a disposable bind via dispatch, and verify `hyprctl binds -j` reflects it.
- UI smoke: edit and restore a bind, show an app badge, confirm invalid/conflicting edits are rejected, preview/revert risky edits, enable/disable overlay and confirm no input interception.
- Full test/type/lint/build suite after all migration slices are integrated.
