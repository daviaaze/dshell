# Spec: Displays (Monitors & Layouts)

> Runtime monitor management: per-monitor physical setup applied live, plus
> named layouts that snapshot and restore the whole arrangement.

## Overview

- **Source**: `packages/widgets/src/settings/displays.tsx` (settings page), `packages/services/src/display/layouts.ts` (`LayoutService`)
- **Settings**: `packages/services/src/settings/monitors.gschema.ts` (`monitors.auto-apply`)
- **Persistence**: `$XDG_CONFIG_HOME/shade/monitor-layouts.json` (runtime store; overridable via `SHADE_LAYOUTS_FILE` for tests)
- **Type**: one `Adw.PreferencesPage` in the Shade Settings window, with a Monitors group and a Layouts group
- **Related**: Nix-declared layouts (`nix/hyprland/layouts.nix`, `shade-layout` CLI) remain the declarative path; `LayoutService` manages user-edited runtime layouts and complements it.

Research references: [monique](https://github.com/ToRvaLDz/monique) (per-monitor inspector, profile system, hotplug daemon), [nwg-displays](https://github.com/nwg-piotr/nwg-displays) (workspace→output assignments), [hyprmoncfg](https://paolino.me/hyprmoncfg-monitor-configuration-for-hyprland/) (same per-monitor control set).

## Functional

### Monitors group

Per-monitor `Adw.ExpanderRow`, one per live Hyprland monitor:

| Control | Behavior |
|---------|----------|
| Enabled | `monitor NAME,disable` or re-enable with the last enabled spec (cached) |
| Resolution | `Gtk.DropDown` over `availableModes` + `Preferred`; applies `monitor NAME,MODE,POS,SCALE` |
| Scale | SpinRow 0.5–3.0; applies scale |
| Rotation | DropDown Normal/90°/180°/270°; applies `transform,N` (0–3) |
| Horizontal/Vertical Position | SpinRows; applies `POS = XxY` |
| Adaptive Sync (VRR) | Switch; applies `vrr,1` / omits (default off) |

All changes apply live via `hyprctl keyword monitor …` (`LayoutService.applySpec`), guarded against echo loops (handler compares against the monitor's current astal property before applying). Changes are NOT persisted until saved into a layout.

Guard: the last enabled monitor cannot be disabled.

### Layouts group

- **Save**: `Adw.EntryRow` + save button — snapshots the live monitors (`currentFormat`, `XxY`, scale, transform, vrr, enabled) plus workspace→monitor bindings into a named layout.
- **Apply**: per-layout button — re-applies every monitor spec then `hyprctl keyword workspace N,monitor:NAME,default:true` for each binding. Marks the layout `Active` (persisted as `current`).
- **Delete**: per-layout button; clears `current` if it pointed at the layout.
- **Auto-apply on monitor change**: `monitors.auto-apply` (default on). On Hyprland `monitor-added`/`monitor-removed`, after a 500 ms debounce, the saved layout whose monitors are all connected (or disabled) with the most enabled monitors is applied, unless already active.

### Data model

```json
{ "version": 1, "current": "Home",
  "layouts": { "Home": {
    "monitors": [{ "name": "DP-1", "resolution": "3440x1440@144",
                   "position": "0x0", "scale": 1, "transform": 0, "vrr": null,
                   "disabled": false }],
    "workspaces": { "1": "DP-1", "2": "DP-1", "3": "HDMI-A-1" } } } }
```

`monitors[].transform`: 0=normal, 1=90°, 2=180°, 3=270°. Rendered to `hyprctl` as `monitor NAME,RES,POS,SCALE[,transform,N][,vrr,N]` / `monitor NAME,disable`.

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Change a monitor control | Applied live; row stays consistent (binds to astal monitor properties) |
| I2 | Save a layout | Current arrangement snapshotted and persisted; appears in list |
| I3 | Apply a layout | Monitors + workspaces restored; row shows `Active` |
| I4 | Unplug/replug a monitor | Best matching saved layout reapplies after 500 ms (if auto-apply on) |
| I5 | Disable last enabled monitor | Rejected with a warning notification |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Store file missing/corrupt | Treated as empty store; first save recreates it |
| E2 | Layout applied with disconnected monitor | That spec fails via hyprctl, error logged + notified; others still apply |
| E3 | No Hyprland (getHyprland null) | Page renders nothing; `save()` refuses empty captures; auto-apply never schedules |
| E4 | Re-enable after disable | Uses last applied enabled spec (resolution/position/scale/transform preserved) |
| E5 | Current mode not in `availableModes` | DropDown shows `Preferred` |

## Service API

`LayoutService` (singleton, `@shade/services/display/layouts`):

- `names`, `current` (read-only properties), signals `applied(name)`, `storeChanged()`
- `get(name)`, `save(name, layout?)`, `remove(name)`, `apply(name)`
- `specFor(mon)`, `monitorSpecs()`, `captureWorkspaces()`, `captureLayout()`
- `applySpec(spec)`, `applyEnabled(name, enabled)`
- `testReset()` (tests)

Note: object-typed private fields (`#store`, `#lastEnabled`) must be initialized in the constructor body — field initializers on gnim `@register` classes are shared across instances.

## Visual (Adwaita alignment)

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Page | `Adw.PreferencesPage`, icon `video-display-symbolic` | after Appearance |
| Groups | `Adw.PreferencesGroup` for Monitors / Layouts | |
| Monitor rows | `Adw.ExpanderRow` + `Adw.SwitchRow` / `Adw.SpinRow` / `Adw.ActionRow`+`Gtk.DropDown` | |
| Layout rows | `Adw.ActionRow` + suffix icon buttons | `document-save-symbolic`, `system-run-symbolic`, `user-trash-symbolic` |

## Test plan

- **Unit** (`packages/services/src/display/__tests__/layouts.test.ts`): `renderMonitorSpec` matrix (full spec, transform/vrr omission, disable); store round-trip across instances; sorted names; empty-name/empty-capture refusal; remove clears `current`; apply of unknown layout returns false.
- **Manual**: open Displays; change scale/rotation/position on each monitor; toggle enabled; save two layouts; apply each; unplug a monitor and verify auto-apply; re-enable a disabled monitor preserves its spec.