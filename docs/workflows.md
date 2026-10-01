# Shade workflows

This guide separates **source-defined** paths from **observed in the isolated VM**. Unless a step is explicitly marked as observed, it is traced from the current Shade source and is not a claim that the live GUI, service, device, portal, or action was exercised. The shortcuts below are the defaults in [`binds.nix`](../nix/hyprland/binds.nix); a local Hyprland configuration can override them.

## Coverage

| Journey | Entry point | Visible outcome | Implementation trail |
|---|---|---|---|
| Sign in | Separate greetd greeter | Authenticate, choose a session, start it, or return to username entry | [Greeter UI](../apps/greeter/src/greeter-ui/index.tsx), [GreetSession](../apps/greeter/src/greeter-ui/GreetSession.ts) |
| Orient on the desktop | After the selected session starts | Use bar, workspaces, indicators, wallpaper, and dock | [Bar](../packages/widgets/src/bar/index.tsx), [dock](../packages/widgets/src/dock/index.tsx), [wallpaper](../packages/widgets/src/wallpaper/index.tsx) |
| Find an app or clipboard item | `Super+Space`, bar launcher, or `Super+Shift+V` | Launch an app or copy a selected clipboard item | [Launcher](../packages/widgets/src/applauncher/index.tsx), [search](../packages/services/src/search/launcher.ts) |
| Switch windows | `Super+Tab` | Focus the selected open window or cancel | [Window switcher](../packages/widgets/src/windowswitcher/index.tsx), [default bindings](../nix/hyprland/binds.nix) |
| Use Quick Settings | `Super+N` or the bar's system-indicator button | Control radios, displays, audio, timer, notifications, power, and capture | [Quick Settings](../packages/widgets/src/quicksettings/index.tsx), [button grid](../packages/widgets/src/quicksettings/button-grid/index.tsx) |
| Navigate Settings and use all 17 pages | `Super+,` or Quick Settings → Settings | Search preferences and use the current page controls | [Settings page registry](../packages/widgets/src/settings/index.tsx), [open lifecycle](../packages/widgets/src/settings/settingsOpen.ts), [page guide](#current-settings-pages) |
| Capture screenshots or record | `Print`, capture tile, or a routed shell command | Save a screenshot or start/stop a recording | [Capture overlay](../packages/widgets/src/screenshot-ui/index.tsx), [capture service](../packages/services/src/capture/screenshot.ts) |
| Choose a screen-sharing source | A separate app launched by the XDPH/portal flow | Select a screen/window or cancel the picker | [Picker entry](../apps/share-picker/src/main.ts), [picker UI](../apps/share-picker/src/ui.ts) |
| Review notifications, lock, or request power action | Notification toast, Quick Settings, or a routed shell command | Dismiss/read, authenticate to unlock, or confirm an action | [Notification toasts](../packages/widgets/src/notifications/index.tsx), [lockscreen](../packages/widgets/src/lockscreen/index.tsx), [power menu](../packages/widgets/src/common/powerMenu.tsx) |
| See an OSD | Change audio, brightness, or touchpad state | Show a short level/state overlay | [OSD](../packages/widgets/src/osd/index.tsx), [default bindings](../nix/hyprland/binds.nix) |

## Sign in at the greeter

**Entry and requirements.** The greeter is a separate login program, not a Shade Shell window or Settings page. It appears before the selected user session. Authentication requires an available account and a working greetd/PAM configuration.

**Steps and result.** Choose an account if the account picker is available, or enter a username in the **Username** field. Choose an item in **Session**. Press **Continue**; when entering a username manually, Enter also submits that field. When the greeter requests a password, enter it and press **Log In** or Enter. Successful authentication starts the selected session; the greeter exits after the session start succeeds. PAM information and error messages appear in the login form. When the greeter detects a fingerprint/biometric prompt, it can show fingerprint feedback.

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

**Entry and requirements.** Press **Super+N** or click the bar's system-indicator button. The panel is attached to the focused monitor and follows the bar edge; scroll within it if needed. Pressing **Super+N** again or clicking the system-indicator button toggles it closed. The panel requires Hyprland.
**Other controls.** The button grid also offers power-profile and conservation, color-scheme, keep-awake, night-light, and touchpad tiles. Its expander reveals media, battery, calendar, weather, and world-clock sections.

### Wi-Fi and Bluetooth

**Steps and result.** The Wi-Fi tile's main button toggles Wi-Fi. Open its popover to press **Scan**, toggle **On**/**Off**, and choose an access point. Selecting an active access-point row disconnects; selecting another row connects. If a secure network has no saved credentials, its row reveals a **Password** field; press Enter or the adjacent button to submit. Connection activity is indicated by a spinner and the active row by a check mark. The Bluetooth tile toggles adapter power; its popover lists known devices that can be connected or disconnected by selecting the row. For discovery and pairing, open **Settings → Bluetooth**, enable Bluetooth, press **Scan for Devices**, then **Pair** on a listed device. **Stop Scan** ends discovery; a scan also stops automatically after 30 seconds.

**Cancel and unavailable states.** The Wi-Fi tile is hidden until a ready Wi-Fi device is reported. If the popover has no access-point rows, the current source provides no separate empty-list message. Settings shows **No Wi-Fi adapter** when no adapter is available; **Connect to Hidden Network…** is disabled in that state. The Bluetooth tile is hidden when there is no adapter. Bluetooth Settings instead shows **Bluetooth unavailable** / **No Bluetooth adapter**, **No paired devices**, or **No devices found** as appropriate. Scanning can be stopped; **Forget** can be canceled before **Confirm**.

**Implementation trail.** [Wi-Fi tile](../packages/widgets/src/quicksettings/network/index.tsx), [Wi-Fi popover](../packages/widgets/src/quicksettings/network/wifiPopover.tsx), and [access-point rows](../packages/widgets/src/quicksettings/network/apRow.tsx) define the Wi-Fi controls; [Bluetooth tile](../packages/widgets/src/quicksettings/button-grid/bluetooth.tsx), [Bluetooth Settings](../packages/widgets/src/settings/bluetooth.tsx), and [Network Settings](../packages/widgets/src/settings/network.tsx) define the other paths. The [button grid](../packages/widgets/src/quicksettings/button-grid/index.tsx) and [expander](../packages/widgets/src/quicksettings/expander/index.tsx) compose the remaining controls. The backing services are [NetworkService](../packages/services/src/network/networkService.ts) and [BluetoothService](../packages/services/src/bluetooth/bluetoothService.ts).

### Displays, brightness, sound, and timer

**Steps and result.** In **Display**, choose a saved layout to preview it or toggle a connected monitor. A pending layout offers **Keep Changes** and **Revert**. In **Settings → Displays**, arrange monitor rectangles and edit resolution/refresh rate, scale, rotation, or display power; press **Apply** to preview, then keep or revert. A preview reverts after 15 seconds if it is not confirmed. Adjust screen brightness with its slider; clicking its icon cycles brightness presets. Adjust speaker or microphone level with its slider, mute/unmute with its control, and expand audio controls to choose an endpoint; the speaker controls also expose an **Applications** mixer. The bar's system-indicator button also adjusts output volume by scrolling. Default hardware bindings include `XF86AudioRaiseVolume`, `XF86AudioLowerVolume`, `XF86AudioMute`, `XF86AudioMicMute`, and `XF86MonBrightnessUp/Down`.

Open the timer tile's popover to choose a countdown preset, enter a custom duration, or select **Pomodoro**. While a timer is active, it displays remaining time and offers Pause/Resume and Stop. Clicking the timer tile itself cancels the active timer.

**Unavailable states.** The Quick Settings display section is hidden when there are no attached monitors and no saved layouts; monitor controls correspond to attached outputs, while the **Monitors** heading is shown only when more than one output is attached. Brightness and audio controls depend on the related service/device exposing a value or endpoint.

**Implementation trail.** [Quick Settings](../packages/widgets/src/quicksettings/index.tsx) composes [display controls](../packages/widgets/src/quicksettings/display.tsx), [brightness/audio/microphone controls](../packages/widgets/src/quicksettings/sliders.tsx), and [timer controls](../packages/widgets/src/quicksettings/timer/TimerSection.tsx). [Display layouts](../packages/services/src/display/layouts.ts), [audio controls](../packages/widgets/src/common/audioControl.tsx), [TimerService](../packages/services/src/time/timerService.ts), and [OSD](../packages/widgets/src/osd/index.tsx) implement the related behavior.

### Notifications, DND, power, and capture buttons

**Steps and result.** In the notification list, use the DND button to turn Do Not Disturb on/off, the history button to switch between current notifications and history, and **Clear all notifications** to dismiss active items. In History, delete a saved entry with its delete button. The tray provides **Lock screen**, **Power options**, and **Settings**. The capture tile offers **Fullscreen** and **Area** screenshots; **Fullscreen**, **Area**, **Output**, and **Window** recordings; recording audio/format controls; and a virtual-monitor control. Area/Output/Window selectors open after the popover is dismissed.

**Cancel and empty states.** The active list shows **No new notifications** when empty and history shows **No history**. DND state can still toggle in the UI if AstalNotifd is unavailable, but source notes that a foreign notification daemon may not suppress notifications. This document makes no promise about behavior with another daemon. The capture buttons require the relevant capture tools and compositor path; see [Capture screenshots or record](#capture-screenshots-or-record-the-screen).

**Implementation trail.** [Notification list](../packages/widgets/src/quicksettings/notificationList.tsx) wires DND, history, and dismissal; [tray](../packages/widgets/src/quicksettings/tray.tsx) opens lock, power, and Settings; [power menu](../packages/widgets/src/common/powerMenu.tsx) defines confirmations; [capture tile](../packages/widgets/src/quicksettings/button-grid/screenshot.tsx) launches capture actions; [DND service](../packages/services/src/notifications/dnd.ts) owns DND state.

## Navigate Settings and use its pages

**Entry and requirements.** Press **Super+,** or open Quick Settings and choose **Settings**. Settings is an Adwaita Preferences window with search. It requires the shell; source marks its widget lazy, so it is created when opened.

**Steps and result.** Select one of the 17 current page titles below or use the window's search to find preferences. Reopening a visible window presents it; closing it disposes that window, and a later open creates a new instance. Controls below describe what the current component exposes, not a uniform save contract. Some controls change state immediately, while others have explicit Apply/Confirm steps.

### Current Settings pages

| Page title | What you can do | Empty, cancel, or unavailable state | Implementation trail |
|---|---|---|---|
| Appearance | Choose **Auto**, **Light**, or **Dark**; choose day/night wallpaper; set dynamic theming and night light. | Canceling a wallpaper chooser leaves that selection unchanged. If Matugen is unavailable, the page shows **Install matugen to enable**. | [Appearance](../packages/widgets/src/settings/appearance.tsx) |
| Displays | Arrange monitor rectangles; change resolution/refresh rate, scale, rotation, and display power; **Apply**, then **Keep Changes** or **Revert**; save, apply, or delete named layouts. | A preview reverts after 15 seconds unless kept; service errors are shown in the page. | [Displays](../packages/widgets/src/settings/displays.tsx), [layout service](../packages/services/src/display/layouts.ts) |
| Bar & Dock | Set bar position, visible modules, dock enabled state, dock icon size, and pinned app IDs. | **Add App** expects a desktop-file ID; an empty value is ignored. The **Auto Hide** control exists but no dock auto-hide effect is claimed. | [Bar & Dock](../packages/widgets/src/settings/bar.tsx) |
| Idle & Lock | Configure auto lock, dimming, display-off, and suspend timings; choose power-button and lid-close actions. | Power-button/lid selections use logind properties via `pkexec`; no success is promised if authorization or the backend request fails. | [Idle](../packages/widgets/src/settings/idle.tsx), [power actions](../packages/widgets/src/settings/power.tsx) |
| Notifications | Set popup progress, lock-screen notification content, history limit, ignored apps, and sound-alert options. | **Ignore App** is applied with the row's Apply action. Scheduled DND initializes off at 22:00-07:00 in component state; its schedule values are not persisted by that component. | [Notifications](../packages/widgets/src/settings/notifications.tsx), [Scheduled DND](../packages/widgets/src/settings/scheduledDND.tsx) |
| Screen Capture | Set recording backend/format/quality/audio, screenshot format, recording boundary, overlay area-selection mode, freeze/preview options, and virtual-monitor defaults. | These are preference controls; capture availability still depends on the selected target and installed tools. | [Screen Capture](../packages/widgets/src/settings/screenCapture.tsx) |
| Network | Toggle Wi-Fi; inspect saved networks and wired/connectivity state; edit/forget a saved network; connect to a hidden network; manage a hotspot when available. | Shows **No Wi-Fi adapter** and disables hidden-network entry if no Wi-Fi adapter is available. | [Network](../packages/widgets/src/settings/network.tsx), [connection editor](../packages/widgets/src/settings/connectionEditor.tsx), [hidden network dialog](../packages/widgets/src/settings/hiddenNetworkDialog.tsx) |
| Bluetooth | Toggle adapter power; scan, pair, connect/disconnect, or forget devices. | Shows **No Bluetooth adapter**, **No paired devices**, or **No devices found**. **Forget** has **Cancel** and **Confirm**. | [Bluetooth](../packages/widgets/src/settings/bluetooth.tsx) |
| Clock & Weather | Add/remove world-clock timezones; set weather auto-location or coordinates; request location detection or a weather update. | The page source defines no separate cancel flow or explicit empty state for these actions. | [Clock](../packages/widgets/src/settings/clock.tsx), [Weather](../packages/widgets/src/settings/weather.tsx) |
| Timer | Edit Pomodoro durations; add a positive countdown preset or reset presets to defaults. | Invalid or non-positive preset input is ignored. | [Timer](../packages/widgets/src/settings/timer.tsx) |
| Sound | Adjust default output/input volume and mute state. | The page controls the default endpoints; if none are exposed, the source has no separate unavailable-device message. | [Sound](../packages/widgets/src/settings/sound.tsx) |
| Mouse & Touchpad | Change pointer sensitivity/acceleration, natural scrolling, handedness, and touchpad tap/drag/scroll options. | Changes are sent to Hyprland; command errors are not surfaced in a page-level error state. | [Mouse & Touchpad](../packages/widgets/src/settings/mouse.tsx) |
| Keyboard Shortcuts | View active keybindings, refresh them, or open the Hyprland configuration. | Shows **No active keybindings available** when refresh returns no groups. | [Keyboard Shortcuts](../packages/widgets/src/settings/shortcuts.tsx), [keybinding service](../packages/services/src/input/keybinds.ts) |
| Default Apps | Choose an available app for each listed common category. | Choices are populated from apps registered for each category; no custom empty-state message is defined. | [Default Apps](../packages/widgets/src/settings/defaultApps.tsx) |
| Startup Apps | Enable/disable entries found in the user's autostart directory. | If no `.desktop` entries are found, the page has no custom empty-state message or add-entry control. | [Startup Apps](../packages/widgets/src/settings/startupApps.tsx) |
| About | Read system information or choose **Copy to Clipboard**. | Unavailable system details fall back to **Unknown** in the source. | [About](../packages/widgets/src/settings/about.tsx) |
| Debug | Enable debug logging; add, remove, or clear debug categories. | The Active Categories group is hidden when there are no categories. | [Debug](../packages/widgets/src/settings/debug.tsx) |

**Implementation trail.** [Settings index](../packages/widgets/src/settings/index.tsx) defines the page titles and component grouping; [settingsOpen.ts](../packages/widgets/src/settings/settingsOpen.ts) owns the open/close lifecycle; [bootstrap](../packages/widgets/src/bootstrap.ts) registers Settings as a lazy widget.

## Capture screenshots or record the screen

**Entry and requirements.** The capture surface requires the running Hyprland shell. Press **Print** to open the capture overlay. Default bindings **Super+Shift+S**, **Super+Shift+R**, and **Super+Shift+P** route to fullscreen screenshot, fullscreen-recording toggle, and area recording. The Quick Settings capture tile exposes additional capture actions. Capture commands need their relevant compositor and tools.

**Steps and result.** In the overlay, choose **Screenshot** or **Record**, then **Fullscreen**, **Area**, **Window**, or **Monitor**. Drag to select an area; clicking a window selects its rectangle in Area mode or selects that window in Window mode. Monitor uses the focused monitor. Press **Take Screenshot** / **Start Recording**, or Enter. On successful capture, the helper writes a timestamped file under `~/Pictures/Screenshots` (the source falls back to `/tmp` if it cannot create that directory), invokes its clipboard-copy helper, and requests a **Screenshot saved** notification. For recording, the overlay closes before capture begins; the recording bar shows elapsed time and a Stop button. Stopping requests a **Recording stopped** notification with duration and path; output filenames are placed under `~/Videos` with the selected MP4/WebM format.

The Quick Settings capture tile also offers fullscreen/area screenshots and fullscreen/area/output/window recordings. The recording button toggles start/stop. It dismisses the popover before opening the Area, Output, or Window selection flow. **Window-target capture is not runtime-verified in the evidence below.**

**Cancel and unavailable states.** Escape cancels the overlay. Enter does nothing until Area or Window has a valid selection; selections smaller than 5 pixels are discarded. If the configured area selector uses `slurp`, canceling its selection returns without starting capture. The overlay and other Hyprland-dependent widgets do not mount when Hyprland is unavailable. Errors such as a missing selector or failed capture are handled by capture failure notifications in the service; no successful result is promised when a required tool is missing.

**Implementation trail.** [Capture overlay](../packages/widgets/src/screenshot-ui/index.tsx) handles target selection and key controls; [control panel](../packages/widgets/src/screenshot-ui/controlPanel.tsx) defines modes/targets; [capture service](../packages/services/src/capture/screenshot.ts), [capture flow](../packages/services/src/capture/captureFlow.ts), and [registered capture actions](../packages/services/src/capture/commands.ts) route operations; [capture utilities](../packages/services/src/capture/utils.ts) define image save/copy/notification behavior; [recorder](../packages/services/src/capture/recorder.ts) and [recording bar](../packages/widgets/src/recording-bar/index.tsx) handle recording lifecycle; [recording boundary](../packages/widgets/src/recording-boundary/index.tsx) draws the configured outline.

## Choose a screen or window in the share picker

**Entry and requirements.** A screen/window-sharing request from an application must reach the XDPH/xdg-desktop-portal flow. The picker is a separate program, not a Settings page or a shell overlay. No Shade keyboard shortcut for it is defined here.

**Steps and result.** Choose the **Screens**, **Windows**, or **All** tab. Select a screen or window card to send that source selection through the picker protocol; the picker then closes. Cards identify the source and show resolution when available. Window cards can show **No preview** or **No preview (hidden or off-screen)**.

**Cancel and empty states.** Select **Cancel** or close the picker to exit without a selection. The Screens and Windows tabs show **No monitors found** and **No windows available** when their lists are empty. The All tab has no separate empty-state message. This describes picker source behavior only; it is not a claim that a live share was approved or started.

**Implementation trail.** [Picker entry](../apps/share-picker/src/main.ts) builds the selection response and quits on selection/cancel; [picker UI](../apps/share-picker/src/ui.ts) defines tabs, cards, preview labels, and empty states. The separate Settings **Screen Share** page is implemented by [screenShare.tsx](../packages/widgets/src/settings/screenShare.tsx); its source list is queried asynchronously, and its current selection is component-local. Its **Remember Choice** switch has no change handler, so no persistent default-source behavior is claimed.

## Notifications, lock/unlock, and power actions

### Notifications

**Entry and requirements.** Toast notifications appear when the notification service is available and the shell is not in DND or locked. Open Quick Settings for current notifications or History.

**Steps and result.** Click a toast's default action to invoke it, or dismiss the toast. At most three toasts are shown at once; critical notifications do not auto-dismiss. In Quick Settings, review active items, switch to History, remove a saved history item, or use **Clear all notifications** to dismiss active notifications. The history view shows up to 20 items.

**Empty and unavailable states.** Quick Settings shows **No new notifications** or **No history** for empty lists. Toasts are not shown when the notification daemon is unavailable, DND is enabled, or the screen is locked. DND can still toggle locally if AstalNotifd is unavailable, but suppression by a foreign notification daemon is not guaranteed by the source.

**Implementation trail.** [Notification widget](../packages/widgets/src/notifications/index.tsx) limits and displays toast items; [notification card](../packages/widgets/src/common/notification.tsx) supplies actions and dismissal; [Quick Settings list](../packages/widgets/src/quicksettings/notificationList.tsx) separates active notifications from history; [history service](../packages/services/src/notifications/history.ts) stores history; [DND service](../packages/services/src/notifications/dnd.ts) synchronizes DND when AstalNotifd is available.

### Lock and unlock

**Entry and requirements.** In Quick Settings choose **Lock screen** or **Power options → Lock**. A routed `shade-shell lockscreen` request also maps to the registered `lockscreen` action when the shell is already running. Unlocking requires the account authentication service; fingerprint is available only when configured and exposed.

**Steps and result.** Enter the account password in the lockscreen password field and press Enter. Successful authentication hides the lockscreen. Fingerprint status, retry, and errors are shown when that service is available.

**Cancel and unavailable states.** A failed password or fingerprint attempt leaves the session locked and shows authentication status. The source does not expose a password-cancel action on this panel. This lock/unlock flow is source-traced, not runtime-tested in the VM evidence below.

**Implementation trail.** [Lockscreen](../packages/widgets/src/lockscreen/index.tsx), [authentication panel](../packages/widgets/src/lockscreen/authPanel.tsx), [AuthSession](../packages/services/src/session/authSession.ts), and [ShellState](../packages/services/src/state/shellState.ts) implement the lock request and authentication UI.

### Suspend, log out, restart, or power off

**Entry and requirements.** Open Quick Settings → **Power options**. These are session/system actions and are not described as runtime-tested here.

**Steps and result.** **Suspend** and **Lock** dispatch immediately. The first click on **Log Out**, **Reboot**, or **Power Off** changes its label to a confirmation prompt. Click the same action again within three seconds to confirm. A successful request is handled by the session-control service.

**Cancel and unavailable states.** Let the three-second prompt expire without a second click to cancel. Systemd-logind/session errors are handled by the service; no successful power action is promised by the UI path alone.

**Implementation trail.** [PowerMenu](../packages/widgets/src/common/powerMenu.tsx) implements the confirmation prompt; [SessionControl](../packages/services/src/power/sessionControl.ts) handles logind and current-session requests; the entry point is [Quick Settings tray](../packages/widgets/src/quicksettings/tray.tsx).

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

The following are the only runtime observations claimed here. A temporary QEMU guest and harness used loopback-only SSH/VNC; they did not change the host display or host radios. The [VM radio-testing guide](vm-radio-testing.md) describes the isolated setup and pilot limits.

- The guest greeter login, app launcher, Quick Settings, Wi-Fi radio toggling, and screenshot capture were exercised successfully in the completed pilot runs. The Wi-Fi check covered radio toggling and access-point visibility, not entering credentials or connecting to `Shade-Test`.
- Capture checks succeeded for a full-composite screenshot, an area-cropped screenshot, and screenshot captures of both guest monitor targets. Fullscreen recording succeeded on both the primary and secondary guest outputs.
- **Verified limitation:** area recording produced a full-output opaque white surface with the red boundary rather than the selected crop. This is a failure observed in that VM run, not the intended area-recording result described by the source path above.
- Window-target capture was not verified. Bluetooth pairing, live share-picker selection, lock/unlock, notifications/DND, display changes, and power actions are not claimed as runtime-tested here.
