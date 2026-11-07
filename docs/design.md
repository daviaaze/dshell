# Shade design and implementation guide

This guide maps current source behavior; it is not a claim that every surface/backend has been runtime-verified. See each linked spec for concise manual procedures and explicit limits.

## Application composition

[`apps/shell/src/main.ts`](../apps/shell/src/main.ts) starts the `Adw.Application` in [`App.tsx`](../apps/shell/src/App.tsx). [`packages/widgets/src/bootstrap.ts`](../packages/widgets/src/bootstrap.ts) initializes Settings root, services, action callbacks and non-lazy widgets; Settings is lazy. Registered services dispose in reverse dependency order. Shell actions are owned by [`ShellState`](../packages/services/src/state/shellState.ts); request dispatch by [`requestHandler.ts`](../packages/services/src/state/requestHandler.ts); widget window references by [`WindowManager`](../packages/services/src/state/windowManager.ts). Settings schemas are defined through [`defineSettings`](../packages/core/src/settingsRegistry.ts); page/service ownership, not the control alone, determines backend effects.

Greeter and share picker are standalone GTK applications. The picker source-selection/review/confirm protocol is documented in [share-picker.md](specs/share-picker.md); preview is not authorization or evidence of transmission.

## Shell surfaces

| Surface | Current ownership and route | Source/spec |
|---|---|---|
| Bar | Per-monitor bar, configuration-driven edge; hosts launcher, indicators, clock/weather and workspace/window title. | [`bar/index.tsx`](../packages/widgets/src/bar/index.tsx), [bar spec](specs/bar.md) |
| Dock | Pinned desktop entries plus unpinned running clients; setting-driven visibility and pinning. | [`dock/index.tsx`](../packages/widgets/src/dock/index.tsx), [dock spec](specs/dock.md) |
| Launcher | Apps/clipboard search; query and open state in ShellState. | [`applauncher/index.tsx`](../packages/widgets/src/applauncher/index.tsx), [launcher spec](specs/applauncher.md) |
| Quick Settings | Home/detail routes, control and data pages; notifications route to independent center. | [`quicksettings/index.tsx`](../packages/widgets/src/quicksettings/index.tsx), [spec](specs/quicksettings.md) |
| Settings | 13 task rows and 21 mounted modules; native navigation split and a single search entry. | [`settings/index.tsx`](../packages/widgets/src/settings/index.tsx), [spec](specs/settings.md) |
| Toasts and notification center | Passive capped toast stack and independently opened DND/history center. | [`notifications/index.tsx`](../packages/widgets/src/notifications/index.tsx), [`notification-center/index.tsx`](../packages/widgets/src/notification-center/index.tsx), [spec](specs/notifications.md) |
| OSD | Passive domain-service revealers; `Keymode.NONE`. | [`osd/index.tsx`](../packages/widgets/src/osd/index.tsx), [spec](specs/osd.md) |
| Capture overlay | Unified selection, review, then explicit capture/start; cancel is non-committing. | [`screenshot-ui/index.tsx`](../packages/widgets/src/screenshot-ui/index.tsx), [spec](specs/screenshot-ui.md) |
| Recording/capture feedback | Active/busy/result/error output, including actual result path and image preview. | [`recording-bar/index.tsx`](../packages/widgets/src/recording-bar/index.tsx), [spec](specs/recording-bar.md) |
| Switcher | Focused-monitor window list with MRU ordering and keyboard selection. | [`windowswitcher/index.tsx`](../packages/widgets/src/windowswitcher/index.tsx), [spec](specs/windowswitcher.md) |

The former RegionSelector is not a current widget; see its [history note](specs/region-selector.md). Avoid treating old implementation details as current behavior.

## Shared UI and theme

[`common/index.ts`](../packages/widgets/src/common/index.ts) exports reusable controls, rows, audio controls, notification/power content, weather content and popover cleanup. This catalog is distinct from domain pages and full surfaces. [`Theme`](../packages/style/src/theme.ts) maps the palette to Adwaita CSS properties; color validation and accent contrast are not whole-app accessibility certification. Dynamic palette generation remains optional and wallpaper-derived. See [STYLEGUIDE.md](STYLEGUIDE.md).

## Verification boundary

Manual procedures in specs are proposed unless explicitly recorded below. Validate on a suitable GTK/Hyprland runtime; inspect real files, service/backend state and portal protocol rather than infer them from visuals. Display changes retain their preview/confirm/rollback lifecycle. Preserve compositor-confirmed lock state; never stop the shell while it owns the session lock.

Observed redesign checks:

- `nix build .#` and the existing `scripts/test.sh` suites passed with the compatible built GJS/GI runtime.
- The disposable `vm-workflow-test.py --scenario capture` run passed real greeter rejection/Back/retry/login, selection cancellation, PNG creation, byte-identical PNG clipboard transfer and a responsive shell after completion.
- A disposable compositor session confirmed `locked=true`; submitting the actual account credential changed it to `locked=false`. This does not certify physical fingerprint hardware.
- Native dark appearance and the 650×600 collapsed Settings layout were exercised visually; Escape returned from Bluetooth to its preserved search results and then to the sidebar.
- A clean VM exercised all 21 Settings destinations and search return, real Wi-Fi password entry with DHCP/connect/disconnect, wrong-password rejection and authenticated unlock, and all nine power-dialog cancellation paths.
- Native controls moved the bar to all four edges and restored its saved position. Both area selectors recorded with the boundary on/off; PNG window capture and a 480×320 window recording were verified against real output files and decoded pattern pixels.
- Type checking still reports seven diagnostics in the unchanged display-layout and battery-history files; it is not a clean type-check gate.
