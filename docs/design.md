# Shade design and implementation guide

This guide maps the current implementation, not historical screenshots or speculative behavior. Statements in the surface map are source-traced; the capture note is observed runtime evidence. Numeric values are literal source requests or drawing settings, not measurements of a rendered display. The final section separates editorial design reading from implementation facts.

## Application flow and ownership

The shell's source-linked flow is:

```text
apps/shell/src/main.ts
  -> apps/shell/src/App.tsx (Adw.Application, app actions, local/remote dispatch)
    -> packages/widgets/src/index.tsx
      -> packages/widgets/src/bootstrap.ts
        -> settings root -> service initialization -> widget-action wiring
          -> render each non-lazy widget -> dispose widgets and services at shutdown
```

- [`main.ts`](../apps/shell/src/main.ts) initializes logging and translations, installs graceful SIGINT/SIGTERM handling, then runs the application.
- [`App.tsx`](../apps/shell/src/App.tsx) defines `ShadeShell` as an `Adw.Application`. Its constructor registers commands from `ShellState`, `Screenshot`, `LayoutService`, and `Touchpad`. A remote command-line request goes to `requestHandler`; a local invocation mounts the UI through `boot()`. Shutdown disposes widget renderers and then registered services.
- [`widgets/index.tsx`](../packages/widgets/src/index.tsx) re-exports the composition root. Importing [`bootstrap.ts`](../packages/widgets/src/bootstrap.ts) loads built-in service and widget modules for their registration side effects. [`define.ts`](../packages/core/src/define.ts) holds the service specs, widget declarations, and action callbacks. Service specs support dependency/order metadata; [`ServiceRegistry`](../packages/core/src/serviceRegistry.ts) initializes in dependency order and disposes in reverse order.
- `boot()` in [`bootstrap.ts`](../packages/widgets/src/bootstrap.ts) calls `initSettingsRoot()` first, initializes services, registers the collected widget callbacks with `ShellState`, then mounts each non-lazy widget independently. A render failure is logged without stopping the remaining mounts. The Settings widget is declared lazy in [`settings/widget.ts`](../packages/widgets/src/settings/widget.ts), and is rendered when opened.

There are two routes to application actions. [`ShellState`](../packages/services/src/state/shellState.ts) registers GActions for launcher, Quick Settings, bar, switcher, Settings, clipboard, lock, and `close-all`; other services register their own commands in `App.tsx`. The default Hyprland bindings in [`binds.nix`](../nix/hyprland/binds.nix) invoke named GActions through the session bus helper. Remote CLI requests are parsed and routed by [`requestHandler.ts`](../packages/services/src/state/requestHandler.ts). Widget-specific callbacks such as opening Settings are passed into `ShellState` at boot, rather than making the state service import widget modules.

[`ShellState`](../packages/services/src/state/shellState.ts) owns transient launcher/query, Quick Settings, and lock state and emits/subscribes to shell events. The shared typed event bus is defined in [`bus.ts`](../packages/services/src/bus.ts). [`WindowManager`](../packages/services/src/state/windowManager.ts) records selected live windows and per-monitor window collections; the widgets themselves own window construction and rendering.

Settings schemas are declared through [`defineSettings()`](../packages/core/src/settingsRegistry.ts), usually alongside their owning service or widget. It returns a typed lazy accessor; the accessor is usable after the boot-time `initSettingsRoot()`. Domains import their own accessor rather than a global settings context, as shown by [`services/settings/index.ts`](../packages/services/src/settings/index.ts) and [`bar.gschema.ts`](../packages/services/src/settings/bar.gschema.ts). A GSettings-backed control alone does not establish that every setting has the same immediate effect or persistence behavior; inspect the owning page/service for its concrete behavior.

## Separate application entry points

The greeter and XDPH share picker are separate GTK applications, not shell widgets or Settings pages.

- [`apps/greeter/src/main.ts`](../apps/greeter/src/main.ts) starts a standalone `Gtk.Application` and renders `Greeter` from [`greeter-ui/index.tsx`](../apps/greeter/src/greeter-ui/index.tsx), which creates its own Astal window. It does not use the shell's widget bootstrap. The greeter source implements the login/session UI, including username/password steps and feedback.
- [`apps/share-picker/src/main.ts`](../apps/share-picker/src/main.ts) starts its own `Gtk.Application` for the XDPH share flow and presents a GTK window built by [`ui.ts`](../apps/share-picker/src/ui.ts). The current picker has Screens, Windows, and All tabs; selecting a source writes the selection protocol to stdout and exits. Cancel and window close also quit the picker. It is not mounted by the shell composition root.

## Shell surface map

“Not set” means the widget source does not assign that property; this guide does not infer the compositor's default. Layer, keyboard mode, and exclusivity are separate settings. Popup rows identify properties inherited from the shared wrapper rather than pretending every surface implements the same window pattern.

| Surface | Window, layer, anchor, and monitor | Visibility and close path | Composition and current source |
|---|---|---|---|
| Wallpaper | Per-monitor `Astal.Window`; `BACKGROUND`; all four edges; `Exclusivity.IGNORE`; the window receives its `Gdk.Monitor`. | Created visible for each monitor. The image follows color-scheme and day/night wallpaper settings. | Full-window `Gtk.Picture` using `ContentFit.COVER`. [`wallpaper/index.tsx`](../packages/widgets/src/wallpaper/index.tsx) |
| Bar | One `Astal.Window` per GDK monitor; layer not set; anchor follows configured bar edge; `Exclusivity.EXCLUSIVE`. | Visible when mounted; `ShellState.toggleBar()` flips registered bars. | `Gtk.CenterBox`: launcher/system usage at start, workspaces/window title in the center, indicators/clock/weather at end. The groups turn vertical for a left/right bar. [`bar/index.tsx`](../packages/widgets/src/bar/index.tsx), [`shellState.ts`](../packages/services/src/state/shellState.ts) |
| Dock | One `Astal.Window`; `TOP` layer; `BOTTOM + LEFT + RIGHT` anchor; `Exclusivity.NORMAL`; no monitor binding is set in this widget. | Its `visible` property follows `bar.dockEnabled`. | Centered linked card containing pinned apps and running clients, with focused/pinned state for each item. [`dock/index.tsx`](../packages/widgets/src/dock/index.tsx), [`dock/item.tsx`](../packages/widgets/src/dock/item.tsx) |
| Launcher | Direct `Astal.Window`; layer not set; `ON_DEMAND` keymode; anchored top-to-bottom and to the side selected by bar position; follows focused Hyprland monitor. | Bound to `ShellState.launcherOpen`; Escape hides it. Showing it copies the shell query into the entry and grabs entry focus; hiding clears the entry and emits the close event. | Search entry, contextual hint, and scrollable app or clipboard results. The 640 width is a source upper bound; the available logical monitor width, 12-pixel window margins, and 48-pixel vertical-bar reserve can reduce the request. [`applauncher/index.tsx`](../packages/widgets/src/applauncher/index.tsx), [`shellState.ts`](../packages/services/src/state/shellState.ts) |
| Quick Settings | Direct `Astal.Window`; layer and keymode not set here; anchored top-to-bottom on the left when the bar is left, otherwise on the right; follows focused Hyprland monitor. It has 12-pixel edge margins. | Bound to `ShellState.qsOpen`; visibility changes update that state. With a vertical bar, opening it closes an already-open launcher. No Escape handler is declared in this widget. | Scrollable vertical card: button grid, display section, brightness, audio, microphone, tray, expanders, and notification list. Its 420 width is a preferred maximum, clamped to available logical monitor width with the vertical-bar reserve. [`quicksettings/index.tsx`](../packages/widgets/src/quicksettings/index.tsx) |
| Settings | `Adw.PreferencesWindow`, not an Astal layer-shell surface; application attached; layer, anchor, and monitor are not set here. | Lazy. `openSettings()` presents an existing visible window; otherwise it closes/disposes a stale instance, creates a new one, and presents it. Close-request disposes the rendered tree. | Search-enabled preferences pages: Appearance, Displays, Bar & Dock, Idle & Lock, Notifications, Screen Capture, Network, Bluetooth, Clock & Weather, Timer, Sound, Mouse & Touchpad, Keyboard Shortcuts, Default Apps, Startup Apps, About, and Debug. [`settings/index.tsx`](../packages/widgets/src/settings/index.tsx), [`settingsOpen.ts`](../packages/widgets/src/settings/settingsOpen.ts) |
| Notification toasts | `PopupWindow`/`Astal.Window`; the wrapper documents `OVERLAY` as its layer default, derives the anchor from bar position, and defaults to the focused monitor and `ON_DEMAND` keymode. Notifications override margin to 12. | Visible only when the notification service is available, there are toasts, DND is off, and the session is not locked. The newest three are retained as toasts; critical notifications have no auto-dismiss timer. | Vertical stack of shared notification cards. [`notifications/index.tsx`](../packages/widgets/src/notifications/index.tsx), [`common/PopupWindow.tsx`](../packages/widgets/src/common/PopupWindow.tsx) |
| OSD | `PopupWindow`/`Astal.Window`; explicitly `OVERLAY`, anchored `BOTTOM`, focused-monitor default; width request 250 and margin 24. The wrapper sets `ON_DEMAND` keymode; the OSD disables its frame. | Visible while any speaker, screen/keyboard brightness, microphone, or touchpad reveal state is active; timers belong to the domain services. | Vertical linked card of revealers for audio, brightness, microphone, and touchpad. [`osd/index.tsx`](../packages/widgets/src/osd/index.tsx), [`osd/popup.tsx`](../packages/widgets/src/osd/popup.tsx) |
| Lockscreen | One `Astal.Window` per monitor, assigned its `Gdk.Monitor`; all four edges; `Exclusivity.IGNORE`; `EXCLUSIVE` keymode; layer not set. | Created when `ShellState.screenlocked` becomes true. Windows are assigned to the session-lock service before it acquires the lock; successful authentication emits unlock and tears down the UI. | CSS backdrop uses `blur(40px) brightness(0.35)`; foreground has clock, authentication panel, lockscreen widgets, and notifications. [`lockscreen/index.tsx`](../packages/widgets/src/lockscreen/index.tsx), [`shellState.ts`](../packages/services/src/state/shellState.ts) |
| Window switcher | Full-edge `Astal.Window`; `OVERLAY`; `EXCLUSIVE` keymode; follows focused Hyprland monitor. | Initially hidden. Its widget action toggles visibility; opening focuses the selection container. Escape closes; Return focuses the selection; releasing Super/Meta focuses the selected client. | Focusable client list ordered by recent use, with a “No Open Windows” status page. The list container requests width 500. [`windowswitcher/index.tsx`](../packages/widgets/src/windowswitcher/index.tsx), [`windowswitcher/widget.ts`](../packages/widgets/src/windowswitcher/widget.ts) |
| Capture overlay | Full-edge `Astal.Window`; `TOP`; `Exclusivity.IGNORE`; `ON_DEMAND` keymode; follows focused Hyprland monitor. | Bound to `Screenshot.overlayOpen`. Escape or right-click hides/cancels; Enter confirms only when the selected area/window is valid. | `Gtk.Overlay` combines the frozen screenshot stage (or transparent recording background), selection `Gtk.DrawingArea`, and a control panel omitted in quick-select mode. [`screenshot-ui/index.tsx`](../packages/widgets/src/screenshot-ui/index.tsx), [`screenshot-ui/controlPanel.tsx`](../packages/widgets/src/screenshot-ui/controlPanel.tsx) |
| Recording controls | The bar indicator is a button in each mounted bar. A separate `Astal.Window` control surface is `OVERLAY`, anchored `BOTTOM + RIGHT`, with 12-pixel margins, and follows the focused monitor. | Both are visible while recording. Clicking the bar indicator or the overlay Stop button calls `stopRecording()`. | Bar shows record icon and elapsed time; overlay shows REC, elapsed time, optional audio indicator, and Stop. [`bar/indicators/recording.tsx`](../packages/widgets/src/bar/indicators/recording.tsx), [`recording-bar/index.tsx`](../packages/widgets/src/recording-bar/index.tsx) |
| Recording boundary | One `Astal.Window` for each monitor present when this widget mounts; `OVERLAY`; all four edges; `Exclusivity.IGNORE`. | Bound to the capture service's `boundaryVisible`; windows close when the widget tree is disposed. | `Gtk.DrawingArea` draws dashed boundary edges where the selected geometry intersects a monitor. [`recording-boundary/index.tsx`](../packages/widgets/src/recording-boundary/index.tsx) |

The shared [`PopupWindow`](../packages/widgets/src/common/PopupWindow.tsx) helper supplies bar-position-derived anchors and margins, focused-monitor default, `ON_DEMAND` keymode, and an Escape callback hook. Its default edge margins are source constants (40 for top/bottom anchors and 8 for side anchors); a surface may override them. Escape invokes `onClose` only when one is supplied; the helper does not itself change the visibility accessor. Direct Astal windows such as the launcher and Quick Settings implement their own visibility and keyboard behavior.

**Observed capture limitation:** runtime area recording produced a full-output opaque white surface with the red boundary rather than the selected crop. This is a verified limitation, not the intended design of the source-traced selection overlay. Window-target capture was not runtime-verified.

## Settings, overlays, and focus

The default Hyprland configuration binds `SUPER+Space` to launcher, `SUPER+n` to Quick Settings, `SUPER+Tab` to switcher, `SUPER+,` to Settings, `SUPER+w` to bar visibility, and `SUPER+Shift+V` to clipboard mode. These are configuration defaults in [`binds.nix`](../nix/hyprland/binds.nix), not global GTK shortcuts.

- The launcher copies `ShellState.launcherQuery` when it becomes visible and focuses the search entry. `openClipboard()` and `toggleClipboard()` use `>` as the clipboard-mode query marker; closing the launcher clears the query. See [`shellState.ts`](../packages/services/src/state/shellState.ts) and [`applauncher/index.tsx`](../packages/widgets/src/applauncher/index.tsx).
- The switcher grabs focus on open and handles navigation/selection keys on its event controller. The lockscreen explicitly uses exclusive keyboard mode. Launcher and popup surfaces use on-demand keyboard mode; layer-shell exclusivity zones are a separate setting. See [`windowswitcher/index.tsx`](../packages/widgets/src/windowswitcher/index.tsx), [`lockscreen/index.tsx`](../packages/widgets/src/lockscreen/index.tsx), and [`PopupWindow.tsx`](../packages/widgets/src/common/PopupWindow.tsx).
- Launcher and Quick Settings close one another only when the bar is vertical, where both are side-anchored. `ShellState.closeAll()` closes the launcher, Quick Settings, and switcher; it is not a universal close operation for every window. See [`applauncher/index.tsx`](../packages/widgets/src/applauncher/index.tsx), [`quicksettings/index.tsx`](../packages/widgets/src/quicksettings/index.tsx), and [`shellState.ts`](../packages/services/src/state/shellState.ts).
- Settings is a normal `Adw.PreferencesWindow` with built-in preferences search and a separate open/present/dispose lifecycle. It is not a layer-shell panel. See [`settings/index.tsx`](../packages/widgets/src/settings/index.tsx) and [`settingsOpen.ts`](../packages/widgets/src/settings/settingsOpen.ts).

## Reusable component map

The public common-widget exports in [`common/index.ts`](../packages/widgets/src/common/index.ts) are:

| Concern | Reusable exports |
|---|---|
| Buttons | `QuickToggleButton`, `IconButton`, `IconMenuButton`, `ActionButton` |
| Layout and rows | `LinkedBox`, `IconInfoRow` |
| Controls | `Slider`, `AudioEndpointControl`, `getVolumeIcon` |
| Content/actions | `Notification`, `PowerMenu`, `WeatherIcon`, `WeatherWidget` |
| Lifecycle utility | `usePopoverCleanup` |

Quick Settings composes domain-specific button-grid, display, slider, tray, expander, and notification-list modules around these shared controls. Settings composes feature-page modules inside Adwaita preferences pages; those pages are not interchangeable with the common widget catalog. See [`quicksettings/index.tsx`](../packages/widgets/src/quicksettings/index.tsx) and [`settings/index.tsx`](../packages/widgets/src/settings/index.tsx).

## Native Adwaita theme and visual primitives

[`Theme`](../packages/style/src/theme.ts) applies a five-value palette by updating standard Adwaita CSS custom properties through the shared [`Gtk.CssProvider`](../packages/style/src/cssProvider.ts), registered at user priority. The palette mapping is:

| Palette field | Native property set by `Theme` |
|---|---|
| `bg` | `--window-bg-color` |
| `fg` | `--window-fg-color` |
| `primary` | `--accent-bg-color` and `--accent-color` |
| `surface` | `--card-bg-color` |
| `shadow` | `--shade-color` |

`Theme` also sets `--accent-fg-color` to white. It selects the light or dark half of the active `Stylesheet` based on `Adw.StyleManager`; with no active stylesheet it uses its named Adwaita-inspired light/dark defaults. `--shade-color` is the current native property used by this palette mapping. The optional [`PaletteGenerator`](../packages/style/src/palette.ts) checks whether Matugen is available, observes the dynamic-theme and wallpaper settings, and maps the Matugen `background`, `on_background`, `primary`, `surface_container`/`surface`, and `shadow` colors to the five palette fields.

Widgets use GTK/libadwaita style classes and color references, including `card`, `linked`, `frame`, `flat`, `suggested-action`, `destructive-action`, and `error`. The current switcher stylesheet uses `@window_bg_color`, `@accent_bg_color`, and native `var(--window-radius)`; it does not define a parallel corner-radius token. See [`packages/widgets/src/style.ts`](../packages/widgets/src/style.ts) and the project's [GTK4 + libadwaita theming reference](STYLEGUIDE.md) for the variable and class catalog. No legacy screenshot is used as a current layout reference.

## Design reading, not an additional behavior contract

The implementation favors GTK/libadwaita controls and native theme variables over a second app-wide visual token vocabulary. Edge-anchored shell panels track the configured bar edge, while the launcher and switcher are distinct keyboard-focused surfaces with explicit focus handling. This is an editorial reading of the source, not a new sizing rule, persistence promise, universal focus policy, or claim that every surface shares one window lifecycle.
