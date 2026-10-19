# Spec: Notifications (Redesign)

> One page. This document is the contract: functional tests verify the
> **Functional** section; the theme linter and visual checklist verify the
> **Visual** section. Keep both testable — no vague requirements.
>
> **Status**: implemented (see git history). See **Migration** at the bottom for
> what changed relative to the previous implementation.

## Overview

Four surfaces, one shared card component:

- **Popup** (`packages/widgets/src/notifications/index.tsx`) — transient toasts, top of screen
- **List** (`packages/widgets/src/quicksettings/notificationList.tsx`) — active notifications inside quicksettings
- **History** (same file, toggled view) — persisted log backed by `NotificationHistory`
- **Lockscreen** (`packages/widgets/src/lockscreen/notifications.tsx`) — read-mostly view while locked

- **Shared component**: `packages/widgets/src/common/notification.tsx`
- **Settings group**: `generalSchema` — `notificationShowProgress`, `notificationHistoryLimit`, `notificationIgnoredApps`
- **Dependencies**: `AstalNotifd`, `DndService`, `NotificationHistory`, `ShellState`, `PopupWindow`

## Design decisions (rationale)

| Decision | Rationale |
|----------|-----------|
| Drop the deck/`Gtk.Fixed` stacking | Manual `deck.move()` on idle is fragile, overlaps hide content, and no GNOME surface stacks toasts this way. Plain vertical list. |
| Click card body → invoke default action | GNOME toast behavior; currently only explicit action buttons work. |
| Urgency styling | Critical must be visually distinct (accent/error left border), not just a red close button. Low urgency dimmed. |
| Progress bar off by default | A countdown bar is not an Adwaita pattern; keep as opt-in setting. |
| Group headers become ExpanderRow-style | ToggleButton + icon + chevron is clunky; section-header affordance is clearer. |
| History = `boxed-list` of `Adw.ActionRow` | Custom cards duplicate list styling Adwaita already provides; removes the nested-toolbar anti-pattern. |
| Correct empty-state icons | `user-offline-symbolic` means "user offline"; use `notification-symbolic`. |
| Lockscreen hides action buttons | Security: no app actions reachable while locked (fixes code/comment mismatch — actions currently render). |

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Empty popup | No pending notifications | Window hidden; `notificationCount = 0` |
| F2 | Notification arrives | `notifd` emits `notified` | Card appended to popup list; visibility recomputes from daemon availability, pending count, DND, and lock state; auto-dismiss timer starts (expire_timeout → notifd default → 5000ms fallback) |
| F3 | DND active | `dnd.dnd` = true | Popup hidden; list still shows notifications (DND suppresses popups, not the list) |
| F4 | Screen locked | `ShellState.screenlocked` = true | Popup hidden; lockscreen view shows notifications |
| F5 | Auto-dismiss | Local toast timer expires | Card removed; timer canceled; count decremented. Daemon timeouts are disabled at initialization, so active notifications and history remain until explicitly dismissed/deleted |
| F6 | Hover | Pointer enters/leaves card | Timer paused / resumed |
| F7 | Popup overflow | > 3 simultaneous notifications | Only newest 3 shown; older ones go straight to the quicksettings list |
| F8 | History toggle | History button clicked in list header | List swaps to history view; button icon becomes back arrow |
| F9 | Urgency | `notification.urgency` | CRITICAL: error styling, no auto-dismiss or countdown, including after hover leave or replacement; LOW: dimmed card |
| F10 | Same-ID update | Native fields change | Summary, body, image, urgency and actions refresh even when the native object is reused |
| F11 | Resolution | `notifd` emits `resolved` | Local toast and its timer are removed |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click card body | Invoke notification default action and remove only the local toast |
| I2 | Close notification toast | Remove only the local toast; retain the daemon's active notification and history |
| I3 | Click popup action | Invoke the action, then remove only the local toast |
| I4 | Dismiss all active notifications | Dismiss active notifications via idle callback; retain history |
| I5 | DND toggle | Suppress ordinary and critical popups; native checked state and distinct icon show DND, while active/history data remain |
| I6 | Group header click | Expand/collapse older notifications of that app (Revealer) |
| I7 | Group dismiss button | Dismiss all notifications of that app |
| I9 | Delete history entry | Per-row delete button removes entry |
| I10 | Lockscreen close button | Dismiss notification locally + via notifd |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Notifd unavailable | Async init times out; warning logged; all surfaces hidden/empty |
| E2 | Notification burst | Popup caps at 3; remainder appear only in list; each has independent dismiss timer |
| E3 | `expire_timeout = 0` | Fall back to notifd default → 5000ms; CRITICAL never auto-dismisses |
| E4 | DND toggled while popups visible | Popup hides immediately; state preserved |
| E5 | History empty | `Adw.StatusPage` with `notification-symbolic`, title "No History" |
| E6 | Active list empty | `Adw.StatusPage` with `notification-symbolic`, title "No New Notifications" |
| E7 | History over visible count | Footer row: "Showing 20 of N" |
| E8 | Lockscreen | Content off: generic presence and Dismiss only; content on: sender/details but no actions/default click. The preference subtitle matches the current privacy state |
| E9 | Card has image | Image left of body, 48px, rounded; body `maxWidthChars` reduced |
| E10 | `notified` fires for existing id | Update in place, don't duplicate (lockscreen already does this; popup must too) |

## Visual (Adwaita alignment)

All colors from the theme (`--shade-*`) or libadwaita named colors/style
classes. No hardcoded hex/rgb or ad-hoc inline `css`.

### Popup layout (mockup)

```
┌─ PopupWindow (margin 12) ─────────────────────┐
│ ┌─ card ────────────────────────────────────┐ │
│ │ [icon] Summary (title-4)          2m  [✕] │ │
│ │        App Name (caption dim-label)       │ │
│ │ ┌────┐ Body text wraps here, up to        │ │
│ │ │img │ two-ish lines, body class          │ │
│ │ └────┘                                     │ │
│ │ [ Action 1 ] [ Action 2 ]  (flat)         │ │
│ │ ▔▔▔ progress (optional, off by default)   │ │
│ └───────────────────────────────────────────┘ │
│ ┌─ card ───────┐  ┌─ card ───────┐            │
│ │ older …      │  │ older …      │  ≤ 3 total │
│ └──────────────┘  └──────────────┘            │
└───────────────────────────────────────────────┘
```

### List header (mockup)

```
┌─ toolbar ────────────────────────────────────┐
│ Notifications (title-1)      [🕘] [🧹] [🔕]  │
│   icon-only flat buttons: history, clear,    │
│   DND toggle (warning style when active)     │
└───────────────────────────────────────────────┘
┌─ app group (ExpanderRow-style) ──────────────┐
│ ▸ [icon] App Name  (caption-heading)   [🧹]  │
│ └─ revealer: older cards of this app         │
└───────────────────────────────────────────────┘
```

### History view (mockup)

```
┌─ boxed-list ─────────────────────────────────┐
│ [icon] Summary (title)              HH:MM [🗑]│
│        App Name — body excerpt (subtitle)    │
├───────────────────────────────────────────────┤
│ [icon] Summary                      HH:MM [🗑]│
└───────────────────────────────────────────────┘
        Showing 20 of 57  (caption, dim-label)
```

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Card | `card`, `p-12` | Drop `frame` (double border); `Adw.Clamp` width 360 |
| Critical card | `error` accent via left border class | New `.critical-card` class in theme, `--shade-error` |
| Summary | `title-4` | Unchanged |
| App name / timestamp | `caption dim-label` / `caption numeric` | Unchanged |
| Body | `body` | Unchanged |
| Close button | `circular flat`, `window-close-symbolic` | Unchanged |
| Action buttons | `flat` | Drop `suggested-action` on every button (over-accents); primary/default action may keep it |
| Header buttons | `flat` icon-only | History: `document-open-recent-symbolic` / back: `go-previous-symbolic`; Clear: `edit-clear-all-symbolic`; DND: `notifications-disabled-symbolic` |
| Group header | `caption-heading` + chevron (`go-down`/`go-up-symbolic`) | Flat button, full-width |
| History rows | `Adw.ActionRow` inside `boxed-list` | Delete: `circular flat` + `user-trash-symbolic` |
| Empty states | `Adw.StatusPage` compact, `notification-symbolic` | Replaces `user-offline-symbolic` |
| Group expansion | `Gtk.Revealer` | Unchanged |
| Progress bar | GTK default | Visible only when `notificationShowProgress` = true (default false) |

### Timestamps (one convention)

| Surface | Format |
|---------|--------|
| Popup / active list | Relative (`relativeTime`) |
| History | `HH:MM` today, `EEE HH:MM` this week, else short date |
| Tooltip | Removed (redundant with visible timestamp) |

### Adwaita checklist

- [ ] No `Gtk.Fixed`; popup is a vertical `Gtk.Box` with slide-in/fade-out
- [ ] Single toolbar per view (no nested toolbars in history view)
- [ ] Icon-only buttons use symbolic icons (`-symbolic`)
- [ ] Urgency visually differentiated (critical border, low dimmed)
- [ ] Lockscreen: no action buttons, no default-action click
- [ ] Spacing uses the 6px grid as baseline where appropriate; this component
      also has source-declared 4/6/8/12 gaps. Review those in context rather
      than treating each non-grid value as an automatic failure. Any custom
      radius uses `var(--window-radius)`.
- [ ] Verified in light and dark
- [ ] Empty-state icons semantically correct
- [ ] Consistent capitalization: sentence case ("No new notifications")

## Test plan

- **Unit**: `groupByApp` (order preserved, newest-first), history truncation footer count, popup overflow cap, critical-no-dismiss timer logic, timestamp formatter.
- **Compliance linter**: idle-deferred dismissal is legitimate (mutation during signal emission); document `comply-allow` if flagged.
- **Visual/manual**: light/dark × {1 popup, 3+ popup overflow, critical, low urgency, image card, actions, list grouped/expanded, history populated/empty/truncated, lockscreen}.
- **Popup regression**: `scripts/vm-workflow-test.py` checks the actual toast surface and its content before opening Quick Settings, then verifies local toast expiry and retained notification delivery. The isolated stash reproduction also verified that enabled DND receives a new notification in the center without creating a toast surface.

## Migration (current → target)

1. **`common/notification.tsx`** → rename to `NotificationCard`; add props `variant: 'popup' | 'list' | 'lockscreen'`, `showActions` (default true, false on lockscreen), default-action click handler, urgency classes, remove tooltip.
2. **`notifications/index.tsx`** → delete `Gtk.Fixed` deck, `DismissTimers` repositioning; vertical `Box`; cap 3; dedup by id; skip timer for CRITICAL.
3. **`quicksettings/notificationList.tsx`** → header cleanup (3 icon-only flat buttons); group header → ExpanderRow-style; history → `Adw.ActionRow` `boxed-list` + truncation footer + remove inner toolbar; fix icons/capitalization.
4. **`lockscreen/notifications.tsx`** → pass `showActions={false}`; keep cap/seeding.
5. **Settings** → change `notificationShowProgress` default to false (schema).
6. **`history.ts`** → unchanged (already solid); keep storing `body` (now shown as row subtitle).
