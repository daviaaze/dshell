# Spec: LockScreen

> Full-screen session lock with PAM and fingerprint authentication, clock, and media controls.

## Overview

- **Source**: `src/widget/lockscreen/` (entry: `index.tsx`, `notifications.tsx`, `widgets.tsx`)
- **Dependencies**: `AstalAuth`, `SessionLock` (`Gtk4SessionLock`), `FingerprintAuth`, `ShellState`, `Brightness`
- **Type**: One `Astal.Window` per monitor, all edges anchored, `EXCLUSIVE` keymode; created dynamically when `ShellState.screenlocked` becomes true

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Locked | `ShellState.screenlocked` = true | `createRoot` creates lockscreens for all monitors; `SessionLock.Instance` locks the session; brightness saved and might be dimmed |
| F2 | Unlocked | PAM or fingerprint success | Session unlocks, all lock windows destroyed, `ShellState.screenlocked` = false, brightness restored |
| F3 | Idle | No input | Time spinner updates every second; date shown; password entry focused |
| F4 | Authenticating | User enters password and presses Enter | `Pam.start_authenticate` called; status shows "Authenticating..."; 10s timeout |
| F5 | Authentication failed | PAM returns fail/error | Status shows error message; password entry cleared |
| F6 | Authentication timeout | No PAM response within PAM_TIMEOUT_MS (10s) | Status shows "Authentication timed out"; pamActive reset |
| F7 | Fingerprint available | Fingerprint device detected and ready | Fingerprint sensor initialized in parallel; `verified` signal triggers unlock |
| F8 | Fingerprint scanning | `fingerprint.start()` called | Spinner shown while state is "verifying" or "initializing" |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Enter password + press Enter | PAM authentication started |
| I2 | Password peek icon | Shows/hides password text (`showPeekIcon`) |
| I3 | Fingerprint scan | Automatic — no user action beyond touching sensor |
| I4 | Retry on fingerprint error | Click the error/retry button → `fingerprint.retry()` |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | No PAM module configured | PAM `auth-error` signal fires with "Service not configured" — shown as error |
| E2 | SessionLock unavailable (Wayland compositor doesn't support ext-session-lock) | `SessionLock.Instance.new()` fails — widget still shown but can't actually lock screen |
| E3 | Monitor hotplug while locked | Existing lockscreens remain; new lockscreen for added monitor not created (static `For each={monitors}` captured at lock time) |
| E4 | Fingerprint unavailable / no device | `FingerprintAuth` init resolves; `available` = false; spinner and retry never shown |
| E5 | Brightness save/restore fails | Brightness saved/restored in try-catch; logged as warning; no visible user impact |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window background | No explicit CSS | Uses Gtk theme defaults |
| Clock | `title-1` `numeric` | Regular font size for date |
| Time | `title-1` `numeric` with inline `font-size: 4em` | **Violation** — font-size hardcoded in inline css |
| Avatar | `Adw.Avatar` | Standard Adw component |
| Login card | `card` | Adw class; inline `padding:8px` |
| Password entry | `Gtk.PasswordEntry` with `showPeekIcon` | Standard GTK |
| Status message | `caption` | Adw style class |
| Spinner | `Gtk.Spinner` | Standard GTK |

### Adwaita checklist

- [x] Uses `card` class for auth form
- [x] Uses `title-1`, `numeric`, `title-3`, `caption` label classes
- [ ] `font-size: 4em` should use theme typography
- [x] Avatar shows user initials
- [x] Verified in light and dark

## Test plan

- **Unit**: extract and test PAM authentication state machine, fingerprint lifecycle, brightness save/restore logic
- **Compliance linter**: inline css with font-size; polling timer (1s clock); console in widgets.tsx
- **Visual/manual**: screenshots locked/unlocked/failed/timeout states; test fingerprint retry flow
