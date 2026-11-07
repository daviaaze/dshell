# Dock

Sources: [`index.tsx`](../../packages/widgets/src/dock/index.tsx), [`item.tsx`](../../packages/widgets/src/dock/item.tsx), bar settings schema and app-resolution helpers.

The single bottom-anchored `Astal.Window` follows `bar.dockEnabled`, registers with `WindowManager`, and has 4px bottom margin. Items combine configured pinned desktop files and running Hyprland clients not already represented by a pin. Pinned items remain visible while stopped; running clients show running/focused status. Left click focuses a running client or launches a stopped pinned app. Right-click offers Focus/Close for running items and Pin/Unpin; Close kills the item's clients, while pin changes update the dock-pinned-apps setting. When empty, the dock offers a Configure dock route to Settings `bar`.

Manual: pin/unpin an installed application, launch/focus it, inspect running/focused status, use Close only in a disposable session, and verify the setting after restart. Check the empty state with no pins or supported running clients. Proposed checks only; no new VM results.
