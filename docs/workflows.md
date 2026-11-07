# Shade workflows

This guide separates **source-defined** paths from **observed in the isolated VM**. Unless a step is explicitly marked as observed, it is traced from the current Shade source and is not a claim that the live GUI, service, device, portal, or action was exercised. The shortcuts below are the defaults in [`binds.nix`](../nix/hyprland/binds.nix); a local Hyprland configuration can override them.

## Coverage

| Journey | Entry point | Visible outcome | Implementation trail |
|---|---|---|---|
| Sign in | Separate greetd greeter | Authenticate, choose a session, start it, or return to username entry | [Greeter UI](../apps/greeter/src/greeter-ui/index.tsx), [GreetSession](../apps/greeter/src/greeter-ui/GreetSession.ts) |
| Orient on the desktop | After the selected session starts | Use bar, workspaces, indicators, wallpaper, and dock | [Bar](../packages/widgets/src/bar/index.tsx), [dock](../packages/widgets/src/dock/index.tsx), [wallpaper](../packages/widgets/src/wallpaper/index.tsx) |
| Find an app or clipboard item | `Super+Space`, bar launcher, or `Super+Shift+V` | Launch an app or copy a selected clipboard item | [Launcher](../packages/widgets/src/applauncher/index.tsx), [search](../packages/services/src/search/launcher.ts) |
| Switch windows | `Super+Tab` | Focus the selected open window or cancel | [Window switcher](../packages/widgets/src/windowswitcher/index.tsx), [default bindings](../nix/hyprland/binds.nix) |
| Use Quick Settings | `Super+N` or the bar's system-indicator button | Navigate radio, dedicated **Telas**, audio, Other, Data & Weather, and Notification Center routes | [Quick Settings](../packages/widgets/src/quicksettings/index.tsx), [other controls](../packages/widgets/src/quicksettings/button-grid/index.tsx), [Notification Center](../packages/widgets/src/notification-center/index.tsx) |
| Navigate Settings and use all 21 destinations | `Super+,` or Quick Settings → Configurações | Search preferences across 13 section indices | [Settings registry](../packages/widgets/src/settings/index.tsx), [open lifecycle](../packages/widgets/src/settings/settingsOpen.ts), [feature guide](#current-settings-pages) |
| Capture screenshots or record | `Print`, capture tile, or a routed shell command | Select, review and explicitly confirm overlay capture; other routes have separate flows | [Capture overlay](../packages/widgets/src/screenshot-ui/index.tsx), [capture service](../packages/services/src/capture/screenshot.ts) |
| Choose a screen-sharing source | A separate app launched by the XDPH/portal flow | Select a screen/window or cancel the picker | [Picker entry](../apps/share-picker/src/main.ts), [picker UI](../apps/share-picker/src/ui.ts) |
| Review notifications, lock, or request power action | Notification toast, Quick Settings, or a routed shell command | Dismiss/read, authenticate to unlock, or confirm an action | [Notification toasts](../packages/widgets/src/notifications/index.tsx), [lockscreen](../packages/widgets/src/lockscreen/index.tsx), [power menu](../packages/widgets/src/common/powerMenu.tsx) |
| See an OSD | Change audio, brightness, or touchpad state | Show a short level/state overlay | [OSD](../packages/widgets/src/osd/index.tsx), [default bindings](../nix/hyprland/binds.nix) |

## Sign in at the greeter

**Entry and requirements.** The greeter is a separate login program, not a Shade Shell window or Settings page. It appears before the selected user session. Authentication requires an available account and a working greetd/PAM configuration.

**Steps and result.** A preselected known account starts its PAM conversation automatically; fingerprint prompts can therefore begin without pressing **Continue**. Choose another account or **Back** to change the username/session. For a manually entered username, press **Continue** or Enter. When PAM requests a password, enter it and press **Log In** or Enter. Successful authentication starts the selected session. PAM information, biometric feedback, and errors appear inline; actual fingerprint availability depends on the configured PAM stack and hardware.

**Back, empty, and unavailable states.** **Back** or Escape returns from the password step to username entry and keeps the username. If AccountsService supplies no selectable users, the greeter shows a manual username field. The session menu is built from the `SHADE_SESSION_COMMAND` default entry and discovered Wayland/X session files; if none are discovered, the source provides a Hyprland fallback. Authentication or session-start failures show an error and do not complete the handoff. The pre-login greeter also exposes **Restart** and **Power Off** actions; this guide does not claim they were exercised.

**Implementation trail.** [Greeter UI](../apps/greeter/src/greeter-ui/index.tsx) owns the form and session selection; [GreetSession](../apps/greeter/src/greeter-ui/GreetSession.ts) handles greetd/PAM requests and session start; [session discovery](../apps/greeter/src/greeter-ui/sessions.ts) and [user selection](../apps/greeter/src/greeter-ui/users.ts) supply the choices.

## Orient on the desktop

**Entry and requirements.** After login, the shell mounts its registered widgets. The bar and wallpaper are created for detected monitors. The bar follows its configured edge: top/bottom layouts are horizontal and left/right layouts are vertical. The dock is a separate bottom-anchored surface and is visible when enabled.

**Steps and result.** Use the bar launcher button or `Super+Space` to search apps. Workspace groups show window icons for their monitor; click a shown window icon to focus it. The system-indicator button opens Quick Settings; scrolling on it adjusts output volume. Use the configured workspace bindings `Super+Alt+Left` and `Super+Alt+Right` to move between relative workspaces. In the dock, click a running app to focus it or a pinned non-running app to launch it. Right-click a dock item for **Focus**, **Close**, and **Pin**/**Unpin** actions as applicable. The wallpaper uses configured day/night images and the current color scheme.

**Unavailable states.** Bar modules can be hidden in **Settings → Bar & Dock**. The dock is hidden when disabled and its entries come from pinned and running apps. The Settings page contains an **Auto Hide** switch, but the current dock widget does not read that setting; no auto-hide effect is claimed here. Widgets that require Hyprland do not mount when it is unavailable.

**Implementation trail.** [Shell bootstrap](../packages/widgets/src/bootstrap.ts) registers and mounts the widgets; [bar](../packages/widgets/src/bar/index.tsx), [workspace/window icons](../packages/widgets/src/bar/workspaces.tsx), [system indicators](../packages/widgets/src/bar/systemIndicators.tsx), [dock items](../packages/widgets/src/dock/item.tsx), and [wallpaper](../packages/widgets/src/wallpaper/index.tsx) define the visible behavior.

## Find an app or use clipboard history

**Entry and requirements.** Press **Super+Space** or click the bar launcher for app search. Press **Super+Shift+V** for clipboard mode. The shell must be running under Hyprland; clipboard mode also requires available clipboard history for results.

**Steps and result.** Type in the search field to fuzzy-search apps. Click a result or press Enter to launch the first matching app. With an empty app query, the launcher can show the available app list, ranked by usage when usage data exists. In clipboard mode, type `>` followed by an optional search term; `>` alone searches all clipboard history. Click a result to copy that item and close the launcher. A routed `shade-shell open-clipboard` request opens clipboard mode directly; `shade-shell clipboard` toggles it.

**Cancel and empty states.** Escape closes the launcher. The app list shows **No applications found** when there are no matches; clipboard mode shows **No results in clipboard history**. Pressing Enter in clipboard mode closes the window; selecting a result is the copy action. Closing the launcher resets it to app mode.

**Implementation trail.** [Launcher UI](../packages/widgets/src/applauncher/index.tsx) handles search, keyboard activation, and empty states; [search routing](../packages/services/src/search/launcher.ts) interprets the `>` prefix; [clipboard result buttons](../packages/widgets/src/applauncher/clipboardButton.tsx) copy the selected item; [shell state](../packages/services/src/state/shellState.ts) registers the actions.

## Switch between open windows

**Entry and requirements.** Press **Super+Tab** to open the switcher on the focused monitor. Windows are listed in most-recently-used order; when more than one is open, the next item is initially selected.

**Steps and result.** While holding Super, press Tab or Right to move forward and Shift+Tab or Left to move backward. Release Super to focus the selected window. Enter also focuses the selected window and closes the switcher.

**Cancel and empty state.** Escape closes without changing focus. With no open windows, the switcher shows **No Open Windows** and releasing Super closes it. **Q** kills the selected window; it is not a navigation key.

**Implementation trail.** [Window switcher](../packages/widgets/src/windowswitcher/index.tsx) implements selection and key handling; [binds.nix](../nix/hyprland/binds.nix) defines `Super+Tab`.

## Use Quick Settings

**Entry and requirements.** Press **Super+N** or click the bar's system-indicator button. **Controles rápidos** (Home) is a scrollable, focused-monitor panel, not a collection of nested popovers. Its Home groups are **Conexões** and **Tela e som**. Open Wi-Fi, Bluetooth, **Telas**, **Saída de áudio**, or **Microfone** details; audio details lead to **Mixer de aplicativos**. **Voltar** or Escape returns to the originating page/control; Escape on Home closes the panel. Closing resets navigation to Home. Leaving a pending display preview first requests rollback; rollback failure is shown rather than silently navigating away.
**Other and data routes.** **Outros controles** opens energy/profile, appearance, capture, keep-awake, timer, night-light, and touchpad controls, plus battery, media and tray items. **Data e clima** opens calendar, weather and world clocks. **Notificações** opens the independent Notification Center. The Home header exposes **Configurações** and **Sessão e energia**.

### Wi-Fi and Bluetooth

**Steps and result.** Wi-Fi and Bluetooth cards expose radio toggles and detail navigation. Wi-Fi details contain scanning, access-point selection and credential entry; selecting an active access point disconnects it. Open **Configurações de rede** or **Configurações de Bluetooth** for the full settings destination, including Bluetooth discovery/pairing and forget confirmation. Availability and operation errors depend on the actual adapters/services; an empty or unavailable device list is not successful connectivity.

**Cancel and unavailable states.** Wi-Fi and Bluetooth controls depend on ready adapters. Settings reports adapter/device empty states; failed operations show errors rather than establishing connectivity.

**Implementation trail.** [Quick Settings route stack](../packages/widgets/src/quicksettings/index.tsx), [Wi-Fi card/details](../packages/widgets/src/quicksettings/network/index.tsx), [access-point rows](../packages/widgets/src/quicksettings/network/apRow.tsx), [Bluetooth card/details](../packages/widgets/src/quicksettings/button-grid/bluetooth.tsx), [other controls](../packages/widgets/src/quicksettings/button-grid/index.tsx), [Bluetooth Settings](../packages/widgets/src/settings/bluetooth.tsx), and [Network Settings](../packages/widgets/src/settings/network.tsx).

### Displays, brightness, sound, and timer

**Steps and result.** Open the dedicated **Telas** entry in Quick Settings. Choose an available quick mode—internal only, external only, extend, or duplicate—or preview a saved layout or toggle a connected monitor. Navigating between mode choices does not apply them; activate a choice to preview it. A pending change offers **Keep Changes** and **Revert**, and reverts after 15 seconds if not confirmed. Use **Configurações de telas** for the separate advanced page: arrange monitor rectangles and edit resolution/refresh rate, scale, rotation, or display power; press **Apply** to preview, then keep or revert. Adjust screen brightness with its slider; clicking its icon cycles brightness presets. Adjust speaker or microphone level with its slider, mute/unmute with its control, and expand audio controls to choose an endpoint; the speaker controls also expose an **Applications** mixer. The bar's system-indicator button also adjusts output volume by scrolling. Default hardware bindings include `XF86AudioRaiseVolume`, `XF86AudioLowerVolume`, `XF86AudioMute`, `XF86AudioMicMute`, and `XF86MonBrightnessUp/Down`.

Open **Outros controles → Temporizador** to choose a countdown preset, enter a custom duration, or select **Pomodoro**. An active timer exposes remaining time and pause/resume/stop actions; the details route has its own cancellation control.

**Unavailable states.** Available modes depend on attached outputs; unavailable modes are omitted. Monitor controls correspond to attached outputs, and saved layouts depend on existing profiles. Brightness and audio controls depend on the related service/device exposing a value or endpoint.

**Implementation trail.** [Quick Settings](../packages/widgets/src/quicksettings/index.tsx) composes [display controls](../packages/widgets/src/quicksettings/display.tsx), [brightness/audio/microphone controls](../packages/widgets/src/quicksettings/sliders.tsx), and [timer controls](../packages/widgets/src/quicksettings/timer/TimerSection.tsx). [Display layouts](../packages/services/src/display/layouts.ts), [audio controls](../packages/widgets/src/common/audioControl.tsx), [TimerService](../packages/services/src/time/timerService.ts), and [OSD](../packages/widgets/src/osd/index.tsx) implement the related behavior.

### Notifications, DND, power, and capture

**Steps and result.** Open **Notificações** from Home to use the independent Notification Center's DND, current/history, dismissal, and deletion controls. Use the Home header for Settings and session/power actions. **Outros controles → Captura** exposes capture entry points; target selection and explicit consent belong to the capture overlay described below.

**Cancel and empty states.** Empty notification/history states are explicit. DND suppression with a foreign notification daemon is not guaranteed. Capture requires working compositor and capture tools.

**Implementation trail.** [Quick Settings routes](../packages/widgets/src/quicksettings/index.tsx), [capture controls](../packages/widgets/src/quicksettings/button-grid/screenshot.tsx), [power menu](../packages/widgets/src/common/powerMenu.tsx), and [DND service](../packages/services/src/notifications/dnd.ts).

## Navigate Settings and use its pages

**Entry and requirements.** Press **Super+,** or choose **Configurações** in Quick Settings. Settings is a searchable Adwaita application window with a sidebar and content navigation stack, created lazily by the shell.

**Steps and result.** There are **21 independently navigable destinations**, grouped into **13 section indices**: Aparência; Barra e dock; Telas; Som; Mouse e touchpad; Conexões; Bloqueio e energia; Notificações; Captura e compartilhamento; Aplicativos; Tempo e concentração; Atalhos; Sistema e diagnóstico. Single-member sections open their module directly; multi-member sections show destination rows. Search includes destination titles, summaries and current native preference labels. **Voltar** returns to the originating section/search result and restores focus; compact layouts collapse the sidebar. Opening Settings closes Quick Settings; it cannot open while locked. Closing disposes the window, while reopening an existing window presents it.

### Current Settings pages

| Page title | What you can do | Empty, cancel, or unavailable state | Implementation trail |
|---|---|---|---|
| Appearance | Choose **Auto**, **Light**, or **Dark**; choose day/night wallpaper; set dynamic theming and night light. | Effective appearance and application failures are shown separately from the requested preference. Matugen regeneration reports busy/errors and retains the last valid palette on failure. | [Appearance](../packages/widgets/src/settings/appearance.tsx) |
| Displays | Arrange monitor rectangles; change resolution/refresh rate, scale, rotation, and display power; **Apply**, then **Keep Changes** or **Revert**; save, apply, or delete named layouts. | A preview reverts after 15 seconds unless kept; service errors are shown in the page. | [Displays](../packages/widgets/src/settings/displays.tsx), [layout service](../packages/services/src/display/layouts.ts) |
| Bar & Dock | Set bar position, visible modules, dock enabled state, dock icon size, and pinned app IDs. | **Add App** expects a desktop-file ID; an empty value is ignored. The **Auto Hide** control exists but no dock auto-hide effect is claimed. | [Bar & Dock](../packages/widgets/src/settings/bar.tsx) |
| Idle & Lock | Configure auto lock, dimming, display-off, and suspend timings; choose power-button and lid-close actions. | Power-button/lid selections use logind properties via `pkexec`; no success is promised if authorization or the backend request fails. | [Idle](../packages/widgets/src/settings/idle.tsx), [power actions](../packages/widgets/src/settings/power.tsx) |
| Notifications | Set popup progress, lock-screen notification content, history limit, ignored apps, and sound-alert options. | **Ignore App** is applied with the row's Apply action. Scheduled DND initializes off at 22:00-07:00 in component state; its schedule values are not persisted by that component. | [Notifications](../packages/widgets/src/settings/notifications.tsx), [Scheduled DND](../packages/widgets/src/settings/scheduledDND.tsx) |
| Screen Capture | Set recording backend/format/quality/audio, screenshot format, recording boundary, overlay area-selection mode, freeze/preview options, and virtual-monitor defaults. | These are preference controls; capture availability still depends on the selected target and installed tools. | [Screen Capture](../packages/widgets/src/settings/screenCapture.tsx) |
| Network | Toggle Wi-Fi; inspect saved networks and wired/connectivity state; edit/forget a saved network; connect to a hidden network; manage a hotspot when available. | Shows **No Wi-Fi adapter** and disables hidden-network entry if no Wi-Fi adapter is available. | [Network](../packages/widgets/src/settings/network.tsx), [connection editor](../packages/widgets/src/settings/connectionEditor.tsx), [hidden network dialog](../packages/widgets/src/settings/hiddenNetworkDialog.tsx) |
| Bluetooth | Toggle adapter power; scan, pair, connect/disconnect, or forget devices. | Missing adapters/empty device lists are explicit. Device operations show busy state and native completion errors, clearing stale feedback on a new attempt. **Forget** has **Cancel** and **Confirm**; failure keeps its confirmation available. | [Bluetooth](../packages/widgets/src/settings/bluetooth.tsx) |
| Clock & Weather | Add/remove timezones; watch live world clocks; configure coordinates or auto-location; request detection or a weather update. | Location/weather operations show busy state and errors; late responses cannot overwrite a newer request or disposed page. | [Clock](../packages/widgets/src/settings/clock.tsx), [Weather](../packages/widgets/src/settings/weather.tsx) |
| Timer | Edit Pomodoro durations; add a positive integer countdown preset; reset with Undo. | Invalid, duplicate, fractional, and out-of-range presets show validation feedback instead of silently changing the list. | [Timer](../packages/widgets/src/settings/timer.tsx) |
| Sound | Adjust current default output/input volume and independent mute state. | Missing endpoints show unavailable messages with no active slider. Endpoint replacement/removal updates the controls; zero volume is not treated as unavailable or muted. | [Sound](../packages/widgets/src/settings/sound.tsx) |
| Mouse & Touchpad | Change pointer sensitivity/acceleration, natural scrolling, handedness, and touchpad tap/drag/scroll options. | Changes are sent to Hyprland; command errors are not surfaced in a page-level error state. | [Mouse & Touchpad](../packages/widgets/src/settings/mouse.tsx) |
| Keyboard Shortcuts | View descriptive actions alongside literal compositor bindings; refresh; copy a binding; open configuration. | Shows **No active keybindings available** when no groups are returned. | [Keyboard Shortcuts](../packages/widgets/src/settings/shortcuts.tsx), [keybinding service](../packages/services/src/input/keybinds.ts) |
| Default Apps | Choose registered apps for concrete MIME categories, including media families. | Unset, mixed, and unread associations are explicit. Partial saves report failures and reconcile the selection with confirmed associations. | [Default Apps](../packages/widgets/src/settings/defaultApps.tsx) |
| Startup Apps | Enable/disable user autostart entries and refresh them. | Empty/unread directories and write failures are visible. Failed writes restore confirmed state and preserve unrelated desktop-file keys. | [Startup Apps](../packages/widgets/src/settings/startupApps.tsx) |
| About | Read system information or choose **Copy to Clipboard**. | Unavailable system details fall back to **Unknown** in the source. | [About](../packages/widgets/src/settings/about.tsx) |
| Debug | Enable debug logging; add, remove, or clear debug categories. | The Active Categories group is hidden when there are no categories. | [Debug](../packages/widgets/src/settings/debug.tsx) |

The table above describes feature capabilities using English translations. The authoritative destination labels and split modules are: **Aparência** (Appearance), **Barra e dock** (Bar & Dock), **Telas** (Displays), **Som** (Sound), **Mouse e touchpad**, **Conexões** (Network), **Bluetooth**, **Bloqueio e energia** (Idle & Lock), **Energia** (Power), **Notificações**, **Não perturbe** (Scheduled DND), **Captura de tela** (Screen Capture), **Compartilhamento de tela** (Screen Share), **Aplicativos padrão** (Default Apps), **Aplicativos ao entrar** (Startup Apps), **Relógio** (Clock), **Clima** (Weather), **Temporizador** (Timer), **Atalhos** (Keyboard Shortcuts), **Sobre o sistema** (About), and **Diagnóstico** (Debug). Power, Scheduled DND, Screen Share, Clock, and Weather are separate destinations. The 13 section indices are sidebar groupings, not the destination count. [Power](../packages/widgets/src/settings/power.tsx), [Scheduled DND](../packages/widgets/src/settings/scheduledDND.tsx), and [Screen Share](../packages/widgets/src/settings/screenShare.tsx) implement these split destinations.

**Implementation trail.** [Settings index](../packages/widgets/src/settings/index.tsx) defines the page titles and component grouping; [settingsOpen.ts](../packages/widgets/src/settings/settingsOpen.ts) owns the open/close lifecycle; [bootstrap](../packages/widgets/src/bootstrap.ts) registers Settings as a lazy widget.

## Capture screenshots or record the screen

**Entry and requirements.** The running Hyprland shell owns the capture overlay. Press **Print** to open it; separate default bindings and routed capture commands are direct actions, not proof of overlay review/consent. The Quick Settings capture tile provides additional actions. Relevant compositor and capture tools are required.

**Select → review → confirm.** Choose **Image** or **Recording**, then **Fullscreen**, **Area**, **Window**, or **Monitor**. Drag an area or click a window to select it; selection alone never starts capture. **Review target** (or Enter with a valid target) opens review showing target identity/geometry; expand **Full target details** to inspect the complete summary. **Change target** returns to selection; **Cancel** or Escape closes without capture. Only explicitly activating **Capture image** or **Start recording** consents. Enter is intercepted before focused controls: it reviews on the selection page and does nothing on review; it never implicitly confirms capture. Sub-5-pixel selections are discarded.

**Results and retry.** Capture exposes busy state and a separate result/error surface in the [recording bar](../packages/widgets/src/recording-bar/index.tsx). Image success includes a preview and saved path; completed recordings show their path. **Abrir arquivo**, **Abrir pasta**, and **Fechar** act on a result. Errors show **Falha na captura/gravação** with the backend message and **Fechar**; dismiss the error and reopen capture to retry selection/review/confirmation. There is no automatic retry or implied successful file on error. Active recording shows elapsed time and Stop; stopping must complete before a saved result is available.

**Unavailable states.** Missing compositor/tools or canceled external selection cannot establish success. Overlay widgets require Hyprland. Direct/routed capture entry points are distinct from the overlay's consent steps; a shortcut is not evidence that overlay confirmation occurred.

The Quick Settings capture tile has independent actions: fullscreen and area screenshot commands, fullscreen recording toggle, and area/output/window recording selectors. These are direct service flows, not the overlay's select-review-confirm UI. The tile also exposes recording audio/format controls and a virtual-monitor control.

**Implementation trail.** [Capture overlay](../packages/widgets/src/screenshot-ui/index.tsx) handles target selection and key controls; [control panel](../packages/widgets/src/screenshot-ui/controlPanel.tsx) defines modes, review and explicit confirmation; [capture service](../packages/services/src/capture/screenshot.ts), [capture flow](../packages/services/src/capture/captureFlow.ts), and [registered capture actions](../packages/services/src/capture/commands.ts) route operations; [recording bar](../packages/widgets/src/recording-bar/index.tsx) reports result/error and recording lifecycle.

## Choose a screen or window in the share picker

**Entry and requirements.** A screen/window-sharing request from an application must reach the XDPH/xdg-desktop-portal flow. The picker is a separate program, not a Settings page or a shell overlay. No Shade keyboard shortcut for it is defined here.

**Steps and result.** Choose **Screens**, **Windows**, or **All**; selecting a source opens its review but does not send a selection. Review the target and exposure summary, then use **Back** or **Choose another source** to return, **Cancel** to exit, or explicitly activate **Share** to submit the current live source. Tab changes do not select a source. Preview loading/failure does not itself authorize sharing.

**Cancel and empty states.** **Cancel** or closing the picker exits without selecting or starting a stream. Absent, empty, or malformed source data produces an explicit unavailable/empty state. Cards distinguish loading from unavailable previews. The headless portal workflow exercises real screen/window selection, cancellation, and session teardown; this does not certify every consuming application's capture pipeline.

**Implementation trail.** [Picker entry](../apps/share-picker/src/main.ts) builds the selection response and quits on selection/cancel; [picker UI](../apps/share-picker/src/ui.ts) defines tabs, cards, preview labels, and empty states. The separate Settings **Screen Share** page is implemented by [screenShare.tsx](../packages/widgets/src/settings/screenShare.tsx); its source list is queried asynchronously, and its current selection is component-local. Its **Remember Choice** switch has no change handler, so no persistent default-source behavior is claimed.

## Notifications, lock/unlock, and power actions

### Notifications

**Entry and requirements.** Toast notifications appear when the notification service is available and the shell is not in DND or locked. Open **Notificações** from Quick Settings Home to launch the independent Notification Center window.

**Steps and result.** Click a toast's default action or dismiss it. At most three toasts appear; critical toasts do not auto-expire. Ordinary popup expiry and hover timers belong to the toast UI and do not dismiss the daemon's active notification or history entry. Same-ID updates replace the toast and history item. The Notification Center exposes current/history views, saved-entry deletion, DND, and clearing notifications.

**Empty and unavailable states.** The Notification Center provides explicit empty states. Toasts are suppressed while locked or DND is enabled; suppression by a foreign notification daemon is not guaranteed.

**Implementation trail.** [Notification widget](../packages/widgets/src/notifications/index.tsx) limits and displays toast items; [notification card](../packages/widgets/src/common/notification.tsx) supplies actions/dismissal; [Notification Center](../packages/widgets/src/notification-center/index.tsx) and [list](../packages/widgets/src/notification-center/list.tsx) provide current/history views; [history service](../packages/services/src/notifications/history.ts) stores history; [DND service](../packages/services/src/notifications/dnd.ts) synchronizes DND when AstalNotifd is available.

### Lock and unlock

**Entry and requirements.** In Quick Settings choose **Lock screen** or **Power options → Lock**. A routed `shade-shell lockscreen` request also maps to the registered `lockscreen` action when the shell is already running. Unlocking requires the account authentication service; fingerprint is available only when configured and exposed.

**Steps and result.** Enter the account password and press Enter. Fingerprint starts when available, independently of password authentication. Only successful authentication releases the compositor's session lock.

**Cancel and unavailable states.** Wrong passwords and bounded authentication timeouts leave the session locked and allow a fresh attempt. Restarting or killing the shell does not unlock the compositor; a new shell must reclaim the lock and authenticate. Disposable-VM checks cover a held PAM backend, timeout/retry, stale-response rejection, service restart, and process death. Physical fingerprint hardware and overnight suspend/resume are not certified by those checks.

**Implementation trail.** [Lockscreen](../packages/widgets/src/lockscreen/index.tsx), [authentication panel](../packages/widgets/src/lockscreen/authPanel.tsx), [AuthSession](../packages/services/src/session/authSession.ts), and [ShellState](../packages/services/src/state/shellState.ts) implement the lock request and authentication UI.

### Suspend, log out, restart, or power off

**Entry and requirements.** Open Quick Settings → **Power options**. Actual destructive power operations are not exercised by the headless review workflow.

**Steps and result.** **Suspend** and **Lock** dispatch immediately. **Log Out**, **Restart**, and **Power Off** open a native confirmation dialog explaining the consequence. **Cancel** is the default response; only the explicit destructive response dispatches the request, at most once.

**Cancel and unavailable states.** Cancel, Escape, or closing the native dialog dismisses it without dispatch. Hiding or destroying its parent invalidates the pending request. Keyboard traversal stays inside the dialog and dismissal returns focus to the originating control when still visible. Backend errors are handled by the session service; presenting the dialog does not prove a successful power operation.

**Implementation trail.** [PowerMenu](../packages/widgets/src/common/powerMenu.tsx) uses the shared [native confirmation lifecycle](../packages/widgets/src/common/powerConfirmation.tsx); [SessionControl](../packages/services/src/power/sessionControl.ts) handles logind/current-session requests. The same confirmation helper is used by the greeter.

## On-screen display (OSD)

**Entry and requirements.** The OSD is automatic feedback, not a separate menu. It is shown when the audio, brightness, or touchpad service reports a change. Default hardware bindings include volume up/down/mute, microphone mute, and screen-brightness up/down; the commands are defined in [`binds.nix`](../nix/hyprland/binds.nix).

**Steps and result.** Change an audio or brightness level, or toggle touchpad state through Quick Settings, to produce the corresponding source-defined overlay when its service reports state. The OSD displays speaker/microphone or screen/keyboard brightness levels, or touchpad state.

**Unavailable state.** A corresponding OSD is not shown without a service state change; this source trace does not promise device-specific feedback when no device is available.

**Implementation trail.** [OSD widget](../packages/widgets/src/osd/index.tsx) composes the overlay from [audio](../packages/services/src/audio/audioController.ts), [brightness](../packages/services/src/display/brightness.ts), and [touchpad](../packages/services/src/input/touchpad.ts) state; default key commands are in [binds.nix](../nix/hyprland/binds.nix).

## Routed shell commands

The root CLI is `shade-shell`. The app registers actions in [ShadeShell](../apps/shell/src/App.tsx), while [requestHandler](../packages/services/src/state/requestHandler.ts) parses and dispatches remote command-line requests. These examples are source-checked routes, not runtime-tested outcomes. They require a running Shade Shell application to receive the remote request; a local first invocation boots the UI instead of dispatching through the remote handler.

| Example | Source-checked route |
|---|---|
| `shade-shell toggle applauncher` | Prefixes the argument to `toggle-` and reaches the registered `toggle-applauncher` action. `shade-shell toggle launcher` is listed in help but does **not** match the registered action name. |
| `shade-shell toggle quicksettings`, `shade-shell toggle settings`, `shade-shell toggle bar`, `shade-shell toggle windowswitcher`, `shade-shell toggle touchpad` | Each becomes a registered `toggle-*` action. |
| `shade-shell clipboard` or `shade-shell open-clipboard` | Dispatches `toggle-clipboard` or `open-clipboard`, respectively. |
| `shade-shell screenshot`, `shade-shell screenshot-area`, `shade-shell screenshot-overlay` | Dispatches the registered screenshot action. |
| `shade-shell record`, `shade-shell record-area`, `shade-shell record-window`, `shade-shell record-output` | Dispatches the matching registered recording action. |
| `shade-shell record-window-address ADDRESS` | Dispatches `record-window-address` with its string address argument. |
| `shade-shell lockscreen`, `shade-shell toggle-dnd`, `shade-shell display-next`, `shade-shell touchpad` | Dispatches the lock action, emits the DND toggle event, activates the display action, or activates `toggle-touchpad`, respectively. |

## Isolated-VM observations

The following observations are **historical pilot evidence**, retained at the scope observed in those runs; they are not an inventory of current coverage or current defects. A temporary QEMU guest and harness used loopback-only SSH/VNC and did not change host displays/radios. The [VM testing guide](vm-radio-testing.md) documents current evidence collection; this paragraph does not update or certify that evidence.

- The completed pilot recorded successful full-composite and area-cropped screenshots and fullscreen recordings on both guest outputs. These are historical observations for those runs, not claims about current capture paths or overall review coverage.
- **Verified limitation (pilot):** area recording produced a full-output opaque white surface with the red boundary rather than the selected crop. This remains a report of that specific VM run, not the intended source behavior or a current rerun.
- Window-target capture was not verified in that pilot. Its Bluetooth pairing, live share-picker selection, lock/unlock, notifications/DND, display changes, and power-action observations remain scoped to that run; consult current per-run artifacts before claiming coverage.
