# Spec: Displays (Monitors & Layouts)

> Runtime monitor management combines built-in display modes, per-output controls,
> and named layouts. Output modes and window tiling are separate concerns.

## Overview

- **Settings**: `packages/widgets/src/settings/displays.tsx`
- **Quick Settings**: `packages/widgets/src/quicksettings/display.tsx`
- **Service**: `packages/services/src/display/layouts.ts` (`LayoutService`)
- **Persistence**: `$XDG_CONFIG_HOME/shade/monitor-layouts.json` (runtime store; overridable via `SHADE_LAYOUTS_FILE` for tests)
- **Nix seed**: `nix/hyprland/layouts.nix` declares initial named layouts; a monitor's optional `mirror` names another monitor in the same profile.
- **Auto-apply**: `monitors.auto-apply` controls profile selection on startup and topology changes.

## Built-in display modes

The available mode chooser is keyboard-focusable and is available in Quick Settings. It previews a selection without changing outputs on focus/navigation. A preview has a 15-second confirmation window; Keep Changes commits it, and Revert or timeout restores the previous arrangement. Starting another preview replaces the candidate while retaining the original rollback target.

| Mode | Result |
|------|--------|
| Internal only | Enable the first attached `eDP-*` output and disable other outputs. |
| External only | Disable the internal panel and enable all attached external outputs independently. |
| Extend | Enable all attached outputs independently. |
| Duplicate | Enable all outputs and mirror every output to one source (the internal panel when attached, otherwise the lexical-first output). |

Unavailable modes are omitted. A mode matching the current arrangement is a no-op. Duplicate retains each output's own resolution; source content can therefore scale or differ in aspect ratio on mirror destinations. Named layouts can store mixed arrangements, such as one mirrored pair plus an independently extended output; these are displayed as custom setups rather than extra built-in modes.

Quick Settings individual-output switches use the same preview transaction. An enabled mirror destination is labeled with its source. Disabling a mirror source promotes a remaining destination and redirects its dependent destinations. The last enabled independent desktop cannot be disabled.

## Displays settings

- Per-output resolution, scale, transform, position, VRR, enabled state, and mirror source are editable.
- Mirror sources are enabled independent outputs; mirror destinations cannot themselves be sources. Invalid dependencies are rejected on Apply without changing live outputs.
- The arrangement canvas depicts independent desktop rectangles only; mirror destinations are represented in their output rows.
- Mode selection immediately previews that mode and replaces the draft with the resulting live arrangement. Manual draft edits remain separate until Apply.
- Named layouts save/restore the complete output arrangement (including mirror relationships) and workspace assignments.
- A short `Window tiling` explanation points to Hyprland per-workspace layout configuration; this feature does not change window tiling algorithms.

## Data model

```json
{ "version": 1, "current": "Mixed",
  "layouts": { "Mixed": {
    "monitors": [
      { "name": "eDP-1", "resolution": "preferred", "position": "0x0",
        "scale": 1, "transform": 0, "vrr": null, "disabled": false },
      { "name": "HDMI-A-1", "resolution": "preferred", "position": "0x0",
        "scale": 1, "transform": 0, "vrr": null, "disabled": false,
        "mirror": "eDP-1" },
      { "name": "DP-1", "resolution": "preferred", "position": "auto-right",
        "scale": 1, "transform": 0, "vrr": null, "disabled": false,
        "mirror": null }
    ],
    "workspaces": { "1": "eDP-1", "2": "DP-1" } } } }
```

`mirror` is additive and nullable: absent or `null` means an independent output. Its value is the source monitor name in the profile. Existing version-1 profiles without this field remain independent outputs. Hyprland mirror destinations are physically enabled but are not independent logical desktops.

## CLI and default bindings

- `shade-shell display-next` previews the next matching saved layout.
- `shade-shell display-mode MODE` previews one of `internal-only`, `external-only`, `extend`, or `duplicate`.
- `shade-shell display-mode-chooser` opens the mode chooser without applying a mode.
- `shade-shell display-toggle-internal` previews toggling the internal panel.
- Super+M remains saved-layout cycling; Super+Alt+M and XF86Display open the chooser; Super+Shift+M toggles the internal panel. These are default bindings and follow the existing Hyprland binds enable gate.

## Service API

`LayoutService` (singleton, `@shade/services/display/layouts`) owns profile persistence and all preview/confirm/revert transactions. Built-in modes and output toggles share this transaction; a pending candidate is reverted after 15 seconds unless confirmed. The chooser request opens Quick Settings and signals the widget to focus a mode; it does not mutate monitor state.

## Tiling guidance

Configure distinct algorithms through the existing Hyprland workspace rules, for example `"1, monitor:DP-1, layout:master"` and `"2, monitor:HDMI-A-1, layout:dwindle"`. This assigns layouts to workspaces, not a new per-monitor tiling controller.