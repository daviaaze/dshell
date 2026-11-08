# Notifications

Sources: toast surface [`notifications/index.tsx`](../../packages/widgets/src/notifications/index.tsx), center [`notification-center/index.tsx`](../../packages/widgets/src/notification-center/index.tsx), list/history [`notification-center/list.tsx`](../../packages/widgets/src/notification-center/list.tsx), shared card [`common/notification.tsx`](../../packages/widgets/src/common/notification.tsx).

## Toasts and center are separate surfaces

Toasts use the notification daemon through `useNotifd`, corner anchoring and passive `Keymode.NONE`; they do not take keyboard focus. They are visible only with an available daemon and toast count, while DND is off and the session is unlocked. At most three newest toasts are shown. Noncritical expiry is timer-managed and pauses/resumes with interaction; critical notifications do not auto-dismiss. Invoking an action or dismissing a toast removes it from the toast stack, not from history.

The toast layer is anchored to the upper-right corner of the focused monitor, regardless of bar position, with a 4px outer margin. Keep the corner anchor: adding both horizontal anchors would create an invisible full-width input surface.

Toast cards use a compact body in the toast surface while the notification center retains the full body. Their scrolled viewport is bounded from the focused monitor's logical height; visibility also yields while the center is open so the toast layer cannot cover its controls.

The notification center is independently routed by `ShellState.notificationsOpen` and opened from the bar/Quick Settings. It is on-demand keyboard, monitor/bar-space constrained, and offers active notifications, DND toggle, scheduled-DND Settings route, dismiss-all, and a history view. History clear requires explicit confirmation and does not change DND. Closing or losing center focus closes it, except while its modal confirmation child is active.

## Manual verification

On a suitable session, submit notifications of different urgency, observe the three-toast cap, pause/resume expiry and invoke/dismiss actions. Toggle DND and lock state; verify toast visibility changes without asserting daemon-side retention. Open the separate center, switch to history, dismiss all live notifications, and test clear/cancel confirmation. These are proposed checks, not new VM results.
