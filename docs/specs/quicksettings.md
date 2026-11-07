# Quick Settings

Source-linked behavior: [`index.tsx`](../../packages/widgets/src/quicksettings/index.tsx), [`button-grid/index.tsx`](../../packages/widgets/src/quicksettings/button-grid/index.tsx), service implementations under `../../packages/services/src/`.

## Routes and lifecycle

The panel is an on-demand-keyboard `Astal.Window`, controlled by `ShellState.qsOpen`, attached to the focused monitor and positioned beside the bar. Its 420 logical-pixel width is a maximum, clamped to available monitor width after 4-pixel outer margins and vertical-bar reserve; content scrolls within available height. Escape navigates Back on detail pages and closes Home. Hiding resets route and history. Back restores the previous route and focus origin. Leaving Displays first requests layout rollback; failure keeps the user on the page with an error.

The layer window is not user-resizable: it follows the active page's natural content height, so the empty mixer does not retain the taller device-page viewport.

Home contains Wi-Fi and Bluetooth tiles; one bounded audio/display group with brightness, output and microphone rows; Other controls; Data and weather; and a Notifications button. Each row shows its heading above a native slider, its live percentage and a separate detail arrow; the summary has no mute or brightness-preset icon actions. The output and microphone headings identify their default endpoint. Output and microphone details provide native endpoint selection, one volume slider for the current default and an explicit mute switch; selecting another endpoint changes the default, and volume/mute apply only to that default. Output details link to the separate Mixer de aplicativos route, which retains per-application volume and output routing and states when there are no active streams. Notifications opens the separate notification center; there is no notification list embedded in this panel. Wi-Fi, Bluetooth, audio, microphone and displays have detail routes with links into the corresponding Settings destinations. Other includes power profile, conservation, appearance, capture, keep-awake, timer, night light and touchpad; its details are owned by the specific controls. The Data route contains calendar, weather and world clock.

Wi-Fi rows retain their widget parents across signal-strength updates and AP reordering, preserving an open password draft and its focus. The password entry uses GTK's native activation signal for Enter. Device identity uses NetworkManager's D-Bus object path, not the nullable hardware path.

## Manual verification

On a suitable session, open/close via shell action, test Escape and Back focus restoration, traverse each route, and open each Settings link. With a vertical bar, inspect width and launcher interaction. Exercise a Displays preview, navigate Back/close, and observe rollback; inspect its failure state only using a real backend failure. Verify the Notifications button opens the independent center. These are proposed checks, not VM results.

Corrective VM smoke exercised real guest-only PipeWire endpoints: home output volume, default-output selection, output/input mute and input volume, mixer empty/live playback states, and Back from mixer to output and Home. Light and dark GTK surfaces were visually checked against the saved approved Quick Settings design; cards and boxed groups were flat, and the empty mixer shrank to its natural height. No host audio or host-shell restart was used.
