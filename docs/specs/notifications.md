# Spec: Notifications

> Popup notification list with auto-dismiss, DND, and progress bar support.

## Overview

- **Source**: `src/widget/notifications/` (entry: `index.tsx`)
- **Settings group**: `generalSchema` — `notificationShowProgress`, `notificationHistoryLimit`, `notificationIgnoredApps`
- **Dependencies**: `AstalNotifd`, `DndService`, `ShellState`, `PopupWindow` (shared wrapper)
- **Type**: `PopupWindow` (Astal.Window), anchored to the notification area; visible when notifications exist, DND is off, and screen is unlocked

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Empty | No notification received | Window hidden; `notificationCount = 0` |
| F2 | Notification arrives | `notifd` emits `notified` signal | Notification added to top of list; auto-dismiss timer starts (expire_timeout or default 5000ms) |
| F3 | DND active | `dnd.dnd` = true | Window hidden regardless of pending notifications |
| F4 | Screen locked | `ShellState.screenlocked` = true | Window hidden |
| F5 | Notification dismissed | Timer expires or user dismisses via indicator close | Notification removed from list; timeout canceled; count decremented |
| F6 | Hover on notification | User hovers over a notification | Auto-dismiss timer paused (`pauseDismiss`); resumed on hover leave |
| F7 | Progress bar | `notificationShowProgress` = true + notification with progress data | Progress bar shown per `Notification` component |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click notification action buttons | Standard action invocation via `Notifd.Notification` |
| I2 | Dismiss button | Removes notification from list immediately (calls `closeAction`) |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Notifd unavailable (another daemon running) | Async init times out after 15s; warning logged; widget stays hidden |
| E2 | Notification rate burst | Each notification independently added; individual dismiss timers |
| E3 | expire_timeout = 0 | Uses notifd.default_timeout; if also 0, falls back to 5000ms |
| E4 | DND toggled while notifications visible | Window hides immediately; count preserved but no display |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Popup window | `PopupWindow` wrapper | Shared styling |
| Notification card | `Notification` component | See `src/widget/common/notification.tsx` |
| Progress bar | `showProgress` toggle | Progress bar styling from Adw/GTK defaults |

### Adwaita checklist

- [x] Uses `PopupWindow` shared wrapper (consistent margin/anchor)
- [ ] DND state icon reflects `DndService`
- [x] Verified in light and dark
- [x] Icons are symbolic

## Test plan

- **Unit**: extract and test notification count logic, auto-dismiss timer management, DND+screenlocked gating
- **Compliance linter**: timer in widget layer (GLib.timeout_add) — the 15s guard timer; consider if legit (one-off guard, not polling)
- **Visual/manual**: screenshots with 1 notification, stacked notifications, empty state, DND active, screen locked
