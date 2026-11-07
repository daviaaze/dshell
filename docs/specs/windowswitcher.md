# Window switcher

Sources: [`index.tsx`](../../packages/widgets/src/windowswitcher/index.tsx), [`item.tsx`](../../packages/widgets/src/windowswitcher/item.tsx), widget action [`widget.ts`](../../packages/widgets/src/windowswitcher/widget.ts).

The hidden full-edge focused-monitor `Astal.Window` uses `OVERLAY` and exclusive keyboard mode. It orders current Hyprland clients by an in-memory most-recently-used list, selects index 1 initially when more than one client exists, and clamps selection when clients disappear. Tab/Right and Shift-Tab/Left cycle; Return focuses; Escape closes; Q kills the selected client. Releasing Super/Meta focuses the selected client after hiding/flushing the layer grab. Opening focuses the selection container. This MRU state is not a persistence promise.

Manual: use the configured switcher action with multiple disposable windows; test forward/reverse selection, Return, Super release, Escape, Q only with a disposable target, and client disappearance. Verify focus returns to the intended client. Proposed checks, not new VM results.
