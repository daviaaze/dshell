# Shade workflows

This guide describes the workflows implemented by the current source tree. The paths and visible labels below are source-derived; they are not claims that a live desktop, login, capture, or portal dialog was exercised. The default shortcuts refer to the bindings in [`nix/hyprland/binds.nix`](../nix/hyprland/binds.nix); a local Hyprland configuration may override them.

## Journeys at a glance

| Journey | Entry point | Source-defined outcome | Current implementation trail |
|---|---|---|---|
| Sign in | The separate greetd greeter | Authenticate, choose a session, and start it; return to username entry on Back/Escape | [Greeter UI](../apps/greeter/src/greeter-ui/index.tsx), [greetd session](../apps/greeter/src/greeter-ui/GreetSession.ts), [session discovery](../apps/greeter/src/greeter-ui/sessions.ts) |
| Orient on the desktop | Shade shell after login | Per-monitor bar, workspace/window indicators, wallpaper, and dock | [Shell registrations](../packages/widgets/src/bootstrap.ts), [bar](../packages/widgets/src/bar/index.tsx), [workspaces](../packages/widgets/src/bar/workspaces.tsx), [dock](../packages/widgets/src/dock/index.tsx), [wallpaper](../packages/widgets/src/wallpaper/index.tsx) |
| Find or launch an app; use clipboard history | `Super+Space`, bar launcher, or `Super+Shift+V` | Search apps or switch the launcher to clipboard history; launch/copy a selected result | [Launcher](../packages/widgets/src/applauncher/index.tsx), [search modes](../packages/services/src/search/launcher.ts), [shell actions](../packages/services/src/state/shellState.ts) |
| Switch windows | `Super+Tab` | Focus the selected open window or close the switcher without changing focus | [Window switcher](../packages/widgets/src/windowswitcher/index.tsx), [Hyprland bindings](../nix/hyprland/binds.nix) |
| Use Quick Settings | `Super+N` or click the bar's system-indicator group | Control radios, sound, displays, timer, notifications, power, and capture | [Quick Settings](../packages/widgets/src/quicksettings/index.tsx), [button grid](../packages/widgets/src/quicksettings/button-grid/index.tsx), [shell actions](../packages/services/src/state/shellState.ts) |
| Change preferences | `Super+,` or the Quick Settings Settings button | Search and navigate the 17 current Settings pages | [Settings window](../packages/widgets/src/settings/index.tsx), [open/close behavior](../packages/widgets/src/settings/settingsOpen.ts) |
| Capture a screenshot or recording | `Print`, Quick Settings capture button, or a routed shell command | Save/copy screenshots; record and stop a video | [Capture overlay](../packages/widgets/src/screenshot-ui/index.tsx), [capture service](../packages/services/src/capture/screenshot.ts), [recorder](../packages/services/src/capture/recorder.ts) |
| Choose a portal share source | An app's screen-sharing request opens the separate XDPH picker | Select a screen/window, or cancel without a selection | [Picker entry](../apps/share-picker/src/main.ts), [picker UI](../apps/share-picker/src/ui.ts) |
| Review notifications, lock, or power off | Toasts; Quick Settings notifications and tray | Dismiss/read history, lock/unlock, or confirm a session/power action | [Notification toasts](../packages/widgets/src/notifications/index.tsx), [Quick Settings list](../packages/widgets/src/quicksettings/notificationList.tsx), [lockscreen](../packages/widgets/src/lockscreen/index.tsx), [power menu](../packages/widgets/src/common/powerMenu.tsx) |

## Sign in at the greeter

**Prerequisites and entry.** This is the separate greetd sign-in program, not a page in Shade Settings. It is shown by the login flow before the shell starts. A normal user account is needed; if session discovery is empty, the greeter provides a fallback session. Fingerprint feedback appears only when the PAM flow requests it and fingerprint support is available.

**Steps and result.** Select an account avatar, or enter a username if the account picker has no users. Choose the desired item in **Session** before submitting. Press **Continue** or Enter to begin authentication; enter the requested password/PAM response and press **Log In** or Enter when the greeter is waiting for input. PAM prompts and errors are shown inline; when its current information message mentions fingerprint/biometrics, the greeter can show fingerprint feedback. On authentication success, the selected session command is started and the greeter quits after the session-start callback succeeds.

**Back, errors, and unavailable choices.** **Back** or Escape from the password step resets the in-progress authentication and returns to the username step while keeping the username. An authentication/session error is displayed and the form is shaken; use Back/Escape to restart from username entry. If AccountsService supplies no selectable users, a manual username field is rendered. Session discovery reads installed Wayland/X sessions; the source adds a default session from `SHADE_SESSION_COMMAND` when present and has a last-resort `Hyprland` entry if discovery yields none.

**Under the hood.** [Greeter UI](../apps/greeter/src/greeter-ui/index.tsx) owns the user/password/session controls and handoff; [GreetSession](../apps/greeter/src/greeter-ui/GreetSession.ts) handles greetd/PAM prompts, errors, reset, and session start; [sessions.ts](../apps/greeter/src/greeter-ui/sessions.ts) discovers session entries; [users.ts](../apps/greeter/src/greeter-ui/users.ts) supplies selectable accounts and the manual-entry fallback.

## Entering and controlling the running shell

**Entry.** The normal desktop flow starts Shade Shell after the greeter starts the selected session. A local Shade Shell command-line invocation boots the UI; a remote invocation is routed to its CLI handler. That handler can only invoke actions registered by the application and its services.

**Default keyboard controls.**

| Default key | Source-defined action |
|---|---|
| `Super+Space` | Toggle app launcher (`toggle-applauncher`) |
| `Super+N` | Toggle Quick Settings (`toggle-quicksettings`) |
| `Super+W` | Toggle bar (`toggle-bar`) |
| `Super+Tab` | Toggle window switcher (`toggle-windowswitcher`) |
| `Super+,` | Open/present Settings (`toggle-settings`) |
| `Super+Shift+V` | Toggle clipboard mode (`toggle-clipboard`) |
| `Print` | Open/close capture overlay (`screenshot-overlay`) |
| `Super+Shift+S` | Full screenshot (`screenshot`) |
| `Super+Shift+R` | Toggle fullscreen recording (`record`) |
| `Super+Shift+P` | Start area recording (`record-area`) |
| `Super+Alt+Left/Right` | Hyprland relative-workspace dispatchers |

**CLI caveat and real routes.** The CLI root is `shade-shell`. Its `toggle` dispatcher constructs `toggle-<word>`; compatible values must match registered GActions. In particular, the help text says `launcher`, but `shade-shell toggle launcher` would request `toggle-launcher`, which the shell does not register. The registered app-launcher action is `toggle-applauncher`; use **Super+Space** or `shade-shell toggle applauncher`. Other CLI subcommands routed by the current request handler are `screenshot`, `screenshot-area`, `screenshot-overlay`, `record`, `record-area`, `record-window`, `record-window-address ADDRESS`, `record-output`, `lockscreen`, `clipboard`, `open-clipboard`, `toggle-dnd`, `display-next`, and `touchpad`. `toggle-dnd` emits a service event; the other routes activate their registered action. No raw D-Bus commands are needed for these user-facing paths.

**Under the hood.** [ShadeShell](../apps/shell/src/App.tsx) boots the UI for a local invocation and routes remote command-line invocations to [requestHandler](../packages/services/src/state/requestHandler.ts). It registers shell, capture, display, and touchpad actions; [ShellState](../packages/services/src/state/shellState.ts) defines shell-state actions; [binds.nix](../nix/hyprland/binds.nix) defines the default Hyprland shortcuts.

## Orient on the desktop: bar, workspaces, wallpaper, and dock

**Prerequisites and entry.** After login, the shell mounts a bar and wallpaper window for every detected monitor. The bar adapts its contents to its configured edge: left/right placement is vertical; top/bottom is horizontal. The dock is a separate bottom-anchored surface and can be disabled in **Bar & Dock**.

**Steps and result.** Use the bar's launcher button or the launcher shortcut to find applications; use the centered workspace/window groups to see windows associated with each workspace and focus a shown window icon. The bar's end group holds indicators, clock, optional weather, and recording status; clicking the system-indicator group opens Quick Settings. In the dock, click a running app to focus it or a pinned, non-running app to launch it. Right-click a dock item for **Focus**, **Close**, and **Pin/Unpin** actions as applicable. Wallpapers follow the configured day/night wallpaper and Auto/Light/Dark color scheme.

**Unavailable states and caveats.** Bar modules can be hidden in **Bar & Dock**. The dock is visible only when enabled and its entries are derived from pinned and running desktop apps. Although Settings currently shows an **Auto Hide** switch, the dock widget source reads the dock-enabled state, pinned apps, running clients, and icon size, but no `dockAutoHide` reference was found in the repository source; this guide therefore does not claim an auto-hide effect.

**Under the hood.** [Bootstrap](../packages/widgets/src/bootstrap.ts) registers bar, dock, wallpaper, and the other shell widgets. [Bar](../packages/widgets/src/bar/index.tsx) creates one window per monitor and changes orientation with bar position; [workspaces](../packages/widgets/src/bar/workspaces.tsx) renders workspaces for that monitor; [dock](../packages/widgets/src/dock/index.tsx) combines pinned and running apps; [dock item](../packages/widgets/src/dock/item.tsx) defines its launch/focus/context actions; [wallpaper](../packages/widgets/src/wallpaper/index.tsx) selects the day/night image. The default Hyprland bindings also map `Super+Alt+Left/Right` to relative workspace dispatchers.

## Search for an app or use clipboard history

**Prerequisites and entry.** Press **Super+Space** or click the bar launcher to open app search. Press **Super+Shift+V** to open/toggle clipboard mode. The registered shell actions are `toggle-applauncher`, `toggle-clipboard`, and `open-clipboard` (the last opens clipboard mode directly).

**Steps and result.** In app mode, type to fuzzy-search installed applications; click an app or press Enter to launch the top result. An empty query uses the app list ranked by usage when usage data is available. In clipboard mode, type `>` followed by an optional search term; `>` alone searches the full clipboard history. Click an entry to copy it to the clipboard and close the launcher.

**Cancel and empty results.** Escape closes the launcher. The app and clipboard modes each have an explicit empty result message. The launcher is reset to app mode when it closes. Pressing Enter in clipboard mode only closes the window; selecting a clipboard row is the code-defined copy action.

**CLI/action naming.** The request handler's root command is `shade-shell`. Its `toggle` dispatcher prefixes the supplied word with `toggle-`. The shell registers `toggle-applauncher`, not `toggle-launcher`: the help text says `launcher`, but `shade-shell toggle launcher` expands to an action that is not registered by this source. The code-defined CLI spelling that reaches the launcher action is `shade-shell toggle applauncher`; the keyboard route is **Super+Space**. `shade-shell clipboard` routes to `toggle-clipboard`, and `shade-shell open-clipboard` routes to `open-clipboard`. This guide does not use raw D-Bus invocation examples.

**Under the hood.** [Launcher UI](../packages/widgets/src/applauncher/index.tsx) handles focus, keyboard activation, empty states, and mode display; [launcherSearch](../packages/services/src/search/launcher.ts) routes `>` queries to clipboard search; [clipboard result button](../packages/widgets/src/applauncher/clipboardButton.tsx) copies the chosen item; [ShellState](../packages/services/src/state/shellState.ts) registers the shell GActions. [ShadeShell](../apps/shell/src/App.tsx) registers shell/capture/display/touchpad commands and routes remote CLI requests to [requestHandler](../packages/services/src/state/requestHandler.ts); [bootstrap](../packages/widgets/src/bootstrap.ts) wires widget callbacks.

## Switch between open windows

**Prerequisites and entry.** Press **Super+Tab** to open the switcher on the focused monitor. It presents current open windows in most-recently-used order and initially selects the next item when there is more than one.

**Steps and result.** While holding Super, press Tab/Right to move forward or Shift+Tab/Left to move backward. Release Super to focus the selected window. Enter also focuses the selected window and closes the switcher.

**Cancel and empty state.** Escape closes the switcher without selecting another window. If there are no open windows, the switcher shows **No Open Windows** and releasing Super closes it. **Q** kills the currently selected window; this is a destructive action, not a navigation key.

**Under the hood.** [Window switcher](../packages/widgets/src/windowswitcher/index.tsx) owns its selection and Super-key release behavior; the binding is in [binds.nix](../nix/hyprland/binds.nix). ShellState's registered `toggle-windowswitcher` action is wired to the widget by [bootstrap](../packages/widgets/src/bootstrap.ts).

## Use Quick Settings

**Prerequisites and entry.** Press **Super+N** or click the bar's system-indicator group. The panel follows the focused monitor. It contains the radio/button grid, display and brightness controls, speaker and microphone controls, tray buttons, an expandable media/calendar/battery/weather/world-clock area, and notification list. Use the panel's scrollbar if the content does not fit.

### Wi-Fi and Bluetooth

**Steps and result.** The Wi-Fi tile's main button toggles Wi-Fi; its split-button menu provides **Scan** and the access-point list. Select an access point to connect, or select the active row to disconnect. If a secure network has no saved connection, the row reveals a password entry; submit the password with Enter or the adjacent button. Connection activity is shown with a spinner, and the active network gets a check mark. The Bluetooth tile toggles adapter power; its menu lists known devices, which can be connected/disconnected by selecting the row. For discovery and pairing, open **Settings → Bluetooth**, turn Bluetooth on, press **Scan for Devices**, then **Pair** on an available device. **Stop Scan** stops discovery.

**Cancel and unavailable states.** The Quick Settings Wi-Fi button is only included once the network service reports a ready Wi-Fi device. Its access-point list has no special “no networks” row in the current source. Settings shows **No Wi-Fi adapter** if none is available; its hidden-network action is unavailable in that state. The Quick Settings Bluetooth tile is hidden when no adapter exists; Settings instead shows **Bluetooth unavailable** / **No Bluetooth adapter**. The Bluetooth Settings page shows **No paired devices** or **No devices found** where appropriate; discovery can be stopped, and **Forget** can be backed out with **Cancel** before **Confirm**.

**Under the hood.** [Wi-Fi tile](../packages/widgets/src/quicksettings/network/index.tsx), [access-point popover](../packages/widgets/src/quicksettings/network/wifiPopover.tsx), and [AP rows](../packages/widgets/src/quicksettings/network/apRow.tsx) define connect/disconnect/password feedback. [Bluetooth Quick Settings](../packages/widgets/src/quicksettings/button-grid/bluetooth.tsx) toggles power and known device connections; [Bluetooth Settings](../packages/widgets/src/settings/bluetooth.tsx) owns scanning, pairing, and forget confirmation; [Network Settings](../packages/widgets/src/settings/network.tsx) renders adapter/known-network states; services are [NetworkService](../packages/services/src/network/networkService.ts) and [BluetoothService](../packages/services/src/bluetooth/bluetoothService.ts).

### Displays, brightness, sound, and timer

**Steps and result.** In **Display**, choose a saved layout to preview it or toggle a connected monitor when more than one is attached. A pending layout preview offers **Keep Changes** and **Revert**. Drag monitor rectangles and edit resolution/refresh rate, scale, rotation, and enabled state in **Settings → Displays** for a fuller layout workflow. Adjust the screen-brightness slider; clicking its icon cycles brightness presets. Adjust speaker or microphone volume with the corresponding slider, use the icon to mute/unmute, and expand the controls to choose an endpoint. Speaker controls also offer an **Applications** tab for the app mixer. The bar's system-indicator button can also change volume with its scroll wheel. Volume/brightness changes can show an OSD; the default bindings include `XF86AudioRaiseVolume`, `XF86AudioLowerVolume`, `XF86AudioMute`, `XF86AudioMicMute`, and `XF86MonBrightnessUp/Down`.

Open the timer tile's menu to select a countdown preset, enter a custom duration, or choose **Pomodoro**. While running, the timer shows remaining time and offers Pause/Resume and Stop. Clicking the timer tile itself while a timer is active cancels it.

**Unavailable states.** The display section is hidden when there are no attached monitors and no saved layout names. The monitor rows appear only when multiple monitors are attached; brightness/audio/microphone controls are only rendered when their service exposes a current level or devices.

**Under the hood.** [Quick Settings](../packages/widgets/src/quicksettings/index.tsx) composes [display controls](../packages/widgets/src/quicksettings/display.tsx), [brightness/audio/mic sliders](../packages/widgets/src/quicksettings/sliders.tsx), and [timer controls](../packages/widgets/src/quicksettings/timer/TimerSection.tsx). [The OSD surface](../packages/widgets/src/osd/index.tsx) reflects speaker/mic, screen/keyboard brightness, and touchpad service state; default volume/brightness key bindings are in [binds.nix](../nix/hyprland/binds.nix). The shared audio device and mute controls are in [audioControl](../packages/widgets/src/common/audioControl.tsx); timer commands are handled by [TimerService](../packages/services/src/time/timerService.ts). The layout service implements preview/confirmation/revert and timeout behavior in [layouts.ts](../packages/services/src/display/layouts.ts).

### Notifications, DND, power, and capture buttons

**Steps and result.** At the bottom of Quick Settings, switch **Do Not Disturb** on or off and use **View history** to change between current notifications and history. **Clear all notifications** dismisses current notifications; in History, delete an individual entry with its delete button. The tray has **Lock screen**, **Power options**, and **Settings** buttons. The capture tile's popover has screenshot buttons (**Fullscreen**, **Area**) and recording buttons (**Fullscreen**, **Area**, **Output**, **Window**); it also exposes audio/format options and a virtual-monitor button.

**Cancel and empty states.** The current-notification list says **No new notifications** when empty; the history view says **No history** when empty. DND is local UI state even if AstalNotifd is unavailable; the DND service source explicitly notes that with a foreign notification daemon the UI state still toggles but notifications might not actually be suppressed. Area/Output/Window capture controls launch their selection flows after the popover is dismissed; fullscreen recording toggles directly.

**Under the hood.** [Quick Settings notification list](../packages/widgets/src/quicksettings/notificationList.tsx) wires DND/history/clear actions; [tray](../packages/widgets/src/quicksettings/tray.tsx) owns lock, power, and Settings entry points; [power menu](../packages/widgets/src/common/powerMenu.tsx) defines confirmation behavior; [capture tile](../packages/widgets/src/quicksettings/button-grid/screenshot.tsx) dismisses before starting selectors; [DND service](../packages/services/src/notifications/dnd.ts) documents the external-daemon limitation.

## Navigate and search Settings

**Prerequisites and entry.** Press **Super+,** or open Quick Settings and click **Settings**. Settings is an `Adw.PreferencesWindow` with built-in search. Reinvoking the open action presents an already-visible window; closing it disposes the current instance, and a later open creates a new one.

**Steps and result.** Navigate by the page names below, or use the PreferencesWindow search to find settings. The list reflects the current page titles and grouping in [`settings/index.tsx`](../packages/widgets/src/settings/index.tsx), not the older page inventory in feature specs.

| Current page (exact title) | Component(s) included by the current Settings source |
|---|---|
| Appearance | [`Appearance`](../packages/widgets/src/settings/appearance.tsx) |
| Displays | [`Displays`](../packages/widgets/src/settings/displays.tsx) |
| Bar & Dock | [`Bar`](../packages/widgets/src/settings/bar.tsx) |
| Idle & Lock | [`Idle`](../packages/widgets/src/settings/idle.tsx), [`Power`](../packages/widgets/src/settings/power.tsx) |
| Notifications | [`Notifications`](../packages/widgets/src/settings/notifications.tsx), [`ScheduledDND`](../packages/widgets/src/settings/scheduledDND.tsx) |
| Screen Capture | [`ScreenCapture`](../packages/widgets/src/settings/screenCapture.tsx), [`ScreenShare`](../packages/widgets/src/settings/screenShare.tsx) |
| Network | [`Network`](../packages/widgets/src/settings/network.tsx) |
| Bluetooth | [`Bluetooth`](../packages/widgets/src/settings/bluetooth.tsx) |
| Clock & Weather | [`Clock`](../packages/widgets/src/settings/clock.tsx), [`Weather`](../packages/widgets/src/settings/weather.tsx) |
| Timer | [`Timer`](../packages/widgets/src/settings/timer.tsx) |
| Sound | [`Sound`](../packages/widgets/src/settings/sound.tsx) |
| Mouse & Touchpad | [`Mouse`](../packages/widgets/src/settings/mouse.tsx) |
| Keyboard Shortcuts | [`Shortcuts`](../packages/widgets/src/settings/shortcuts.tsx) |
| Default Apps | [`DefaultApps`](../packages/widgets/src/settings/defaultApps.tsx) |
| Startup Apps | [`StartupApps`](../packages/widgets/src/settings/startupApps.tsx) |
| About | [`About`](../packages/widgets/src/settings/about.tsx) |
| Debug | [`Debug`](../packages/widgets/src/settings/debug.tsx) |

### Common setting journeys and when changes are saved

The source does **not** support a blanket claim that every Settings control behaves alike. Use the page-specific behavior below.

- **Theme and wallpaper:** choose **Auto**, **Light**, or **Dark**. Activate **Wallpaper Day** or **Wallpaper Night** to open an image-filtered file chooser; choosing a file calls the corresponding settings setter, while cancelling leaves the setting unchanged. **Enable Dynamic Theming** calls its settings setter; when Matugen is unavailable the page displays **Install matugen to enable**. **Regenerate from Wallpaper** invokes the palette service. These controls have no page-wide Apply button ([`appearance.tsx`](../packages/widgets/src/settings/appearance.tsx), [general settings schema](../packages/core/src/settings/general.gschema.ts), [palette service](../packages/style/src/palette.ts)).
- **Bar and dock:** choosing Top/Left/Right/Bottom calls the bar-position setter; module and dock switches, dock icon size, and pinned app entries also call their setting setters directly. **Add App** expects a desktop-file ID; an empty entry is ignored. These controls do not present a page-wide Save/Apply button ([`bar.tsx`](../packages/widgets/src/settings/bar.tsx), [bar settings schema](../packages/services/src/settings/bar.gschema.ts)). The Auto Hide switch is present, but its effect is not established by the current dock-widget references described above.
- **Display layout:** make arrangement or monitor edits and press **Apply** to preview. The service offers **Keep Changes** or **Revert**; a preview automatically reverts after 15 seconds if it is not confirmed. After keeping a draft, enter a name and press **Save layout** to add a named layout. Saved layouts can be applied or deleted. **Automatically apply matching layouts** controls automatic application on matching attached-monitor configurations. The layout service stores named layouts separately from ordinary UI switches ([`displays.tsx`](../packages/widgets/src/settings/displays.tsx), [layout service](../packages/services/src/display/layouts.ts), [monitor settings schema](../packages/services/src/settings/monitors.gschema.ts)).
- **Network and paired devices:** Wi-Fi enablement writes the adapter's enabled state; known-network rows open the connection editor, and **Forget Network** removes a saved connection. Hidden networks use **Connect to Hidden Network…**. Bluetooth adapter power and device connect/disconnect act through the adapter; forgetting a paired device requires **Confirm** (or **Cancel**) ([`network.tsx`](../packages/widgets/src/settings/network.tsx), [`bluetooth.tsx`](../packages/widgets/src/settings/bluetooth.tsx)).
- **Idle and notification settings:** Auto Lock, dimming, display-off, and suspend controls call the general settings setters from their change handlers; the page has no global Apply button. Notification preferences use the same direct settings pattern. By contrast, **Scheduled DND** initializes its enabled/start/end values in component state (off, 22:00, 07:00) and checks once per minute while enabled; this component does not write those schedule values to GSettings. Toggling the schedule or changing its hours immediately emits DND state when the schedule is enabled ([`idle.tsx`](../packages/widgets/src/settings/idle.tsx), [`notifications.tsx`](../packages/widgets/src/settings/notifications.tsx), [`scheduledDND.tsx`](../packages/widgets/src/settings/scheduledDND.tsx), [general settings schema](../packages/core/src/settings/general.gschema.ts)).
- **Capture and share preferences:** recording backend/container/quality/audio, screenshot format, recording boundary, overlay preview, and virtual-monitor settings are exposed on **Screen Capture**. Their capture-setting controls call settings setters directly. The **Screen Share** source list is different: the current component holds the selected source in local component state only. Its **Remember Choice** row is rendered off and has no change handler, so the source does not establish a saved default-source preference ([`screenCapture.tsx`](../packages/widgets/src/settings/screenCapture.tsx), [`screenShare.tsx`](../packages/widgets/src/settings/screenShare.tsx), [screen-capture schema](../packages/services/src/settings/screenCapture.gschema.ts)).
- **Default and startup apps:** selecting an app in **Default Apps** calls `set_as_default_for_type` for the displayed category. **Startup Apps** lists `.desktop` files in the user's autostart directory; a switch immediately rewrites that file's `Hidden=true` state. The source has no add-entry control or explicit empty-state message for this list ([`defaultApps.tsx`](../packages/widgets/src/settings/defaultApps.tsx), [`startupApps.tsx`](../packages/widgets/src/settings/startupApps.tsx)).

**Cancel/unavailable states.** Wallpaper chooser cancellation is caught without applying a path. Displays render a service error when one is set; while a preview is pending, the page offers **Revert**. Network/Bluetooth adapter availability is described in the Quick Settings section. The Screen Share selector is populated asynchronously from the portal source list, with current monitors used as a fallback if the command fails; the component has no dedicated empty-source message. These source-defined UI paths are not live-verified here.

**Under the hood.** [Settings index](../packages/widgets/src/settings/index.tsx) defines all page titles/composition and enables search; [settingsOpen.ts](../packages/widgets/src/settings/settingsOpen.ts) owns the current instance's open/close lifecycle. The settings directory above links each page implementation.

## Take screenshots and record the screen

**Prerequisites and entry.** These controls require a running Hyprland shell and working capture tools. Press **Print** to open the capture overlay. **Super+Shift+S** requests a full screenshot, **Super+Shift+R** toggles fullscreen recording, and **Super+Shift+P** starts area recording. Alternatively, open Quick Settings → capture tile. The overlay starts in Screenshot/Fullscreen mode in the service state.

**Steps and result.** In the overlay, choose **Screenshot** or **Record**, then choose **Fullscreen**, **Area**, **Window**, or **Monitor**. For Area, drag a rectangle; clicking a window selects its rectangle in Area mode. For Window, click the desired window. Monitor uses the currently focused monitor. Press **Take Screenshot**/**Start Recording** or Enter. Screenshot completion writes a timestamped image under `~/Pictures/Screenshots` (the helper falls back to `/tmp` if that directory cannot be created), copies it to the clipboard, and requests a **Screenshot saved** notification. For recording, the overlay closes before capture starts; the recording indicator shows elapsed time and a Stop button. Stopping saves a timestamped MP4/WEBM under `~/Videos` and requests a **Recording stopped** notification with the duration/path.

The Quick Settings popover offers quick **Fullscreen** and **Area** screenshots, and **Fullscreen**, **Area**, **Output**, and **Window** recordings. Its recording button toggles Start/Stop. The Area/Output/Window controls dismiss the popover before launching their selection flow; fullscreen recording toggles directly. The capture overlay can also enable audio and a recording boundary; when the boundary is enabled for a geometry recording, a colored edge outline is drawn around the captured area.

**Cancel and unavailable states.** Escape cancels the overlay; right-click is also a dismiss gesture. In the overlay, Enter does nothing until a valid Area/Window selection exists. A very small area is discarded. When area selection uses `slurp`, Escape/cancel returns without a screenshot/recording; if `slurp` is missing, screenshot source sends a failure notification. The Quick Settings area selector is opened after the popover is dismissed to avoid competing input grabs. A widget requiring Hyprland returns no UI when Hyprland is unavailable.

**Under the hood.** [Capture overlay](../packages/widgets/src/screenshot-ui/index.tsx) handles target selection, Enter/Escape, and capture confirmation; [control panel](../packages/widgets/src/screenshot-ui/controlPanel.tsx) defines mode/target/audio/boundary controls; [Screenshot service](../packages/services/src/capture/screenshot.ts) delegates to [captureFlow](../packages/services/src/capture/captureFlow.ts); [capture commands](../packages/services/src/capture/commands.ts) registers the CLI/GAction names. [Capture utils](../packages/services/src/capture/utils.ts) define screenshot path, clipboard copy, and notification; [recorder](../packages/services/src/capture/recorder.ts) defines video output and lifecycle; [recording bar](../packages/widgets/src/recording-bar/index.tsx) exposes Stop; [recording boundary](../packages/widgets/src/recording-boundary/index.tsx) draws the configured outline.

## Choose a screen or window in the share picker

**Prerequisites and entry.** An application must request screen/window sharing through the XDPH/xdg-desktop-portal flow. The share picker is a separate app, not a Settings page and has no shell keyboard shortcut documented here.

**Steps and result.** Choose the **Screens**, **Windows**, or **All** tab, then select the screen/window card to return that source to the portal. The picker closes after a selection. Cards show the source name and resolution when available; window cards can say **No preview** or **No preview (hidden or off-screen)**.

**Cancel and empty states.** Press **Cancel** or close the picker to exit without a source selection. The Screens and Windows tabs show **No monitors found** and **No windows available** when their corresponding lists are empty. The All tab renders its screen/window sections without a separate empty-state message.

**Under the hood.** [Picker main](../apps/share-picker/src/main.ts) builds the portal response and closes on selection/cancel; [picker UI](../apps/share-picker/src/ui.ts) defines tabs, cards, preview fallback labels, and empty states. This describes source behavior only; no live screen share or disclosure was performed to verify it.

## Notifications, lock/unlock, and power actions

**Notifications.** New desktop notifications appear as toast popups when a notification daemon is available and the shell is not in DND or locked. The popup stack caps at three; critical notifications do not auto-dismiss. Click a notification's default action to invoke it, or dismiss it. To see current items or history, open Quick Settings and use its notification list. History is limited to the first 20 rows in the view; delete an individual saved history row there. **Clear all notifications** dismisses current notifications—it is not a clear-history action.

**Lock and unlock.** Open Quick Settings and click **Lock screen** (or **Power options → Lock**). No dedicated lock key is present in the inspected default bind list. The lock surface is created for each monitor and asks for the account password; submit it with Enter. Fingerprint verification can also unlock when available. Successful authentication hides the lockscreen. Password failures and fingerprint retry/no-match feedback are shown in the auth status; failed authentication leaves the session locked.

**Suspend, log out, restart, and power off.** In Quick Settings, open **Power options**. **Suspend** and **Lock** dispatch immediately. The first click on **Log Out**, **Reboot**, or **Power Off** changes the label to a confirmation prompt; click the same action again within three seconds to confirm. To cancel, do not confirm before that prompt times out. The resulting session/power request is handled by the session-control service. The greeter also has separate Restart and Power Off buttons before login.

**Under the hood.** [Toast notifications](../packages/widgets/src/notifications/index.tsx) cap popups and apply DND/lock visibility; [history list](../packages/widgets/src/quicksettings/notificationList.tsx) separates active notifications from saved history; [history service](../packages/services/src/notifications/history.ts) stores history. [Lockscreen UI](../packages/widgets/src/lockscreen/index.tsx), [auth panel](../packages/widgets/src/lockscreen/authPanel.tsx), and [AuthSession](../packages/services/src/session/authSession.ts) implement lock/auth feedback. [PowerMenu](../packages/widgets/src/common/powerMenu.tsx) implements the confirmation prompt; [SessionControl](../packages/services/src/power/sessionControl.ts) handles logind/current-session requests; the lock action is wired through [ShellState](../packages/services/src/state/shellState.ts). Greeter power buttons use [greeter power.ts](../apps/greeter/src/greeter-ui/power.ts).

## Further references

The per-feature files in [`docs/specs/`](specs/) are historical/reference material, not a substitute for the current source links above. Their paths, labels, and behavior descriptions may lag the implementation; use the code cited in this guide when they disagree. Relevant references include [greeter](specs/greeter.md), [bar](specs/bar.md), [dock](specs/dock.md), [app launcher](specs/applauncher.md), [window switcher](specs/windowswitcher.md), [Quick Settings](specs/quicksettings.md), [Settings](specs/settings.md), [displays](specs/displays.md), [screenshot UI](specs/screenshot-ui.md), [share picker](specs/share-picker.md), [recording bar](specs/recording-bar.md), [recording boundary](specs/recording-boundary.md), [notifications](specs/notifications.md), [lockscreen](specs/lockscreen.md), [wallpaper](specs/wallpaper.md), and [OSD](specs/osd.md).

## Verification status

The claims in this guide were checked against the linked source files. Runtime GUI behavior was **not** exercised: no live shell, greetd login, Bluetooth/Wi-Fi device, screenshot/recording session, notification daemon, or XDPH share request was used. CLI source routing is not evidence of a working GUI or live-system result.
