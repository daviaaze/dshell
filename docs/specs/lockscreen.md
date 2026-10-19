# Spec: Lock screen

> Compositor-owned session lock with PAM password authentication and optional fingerprint verification. A visible password window or `ShellState.screenlocked` alone is not proof that the session is locked.

## Implementation

- **Window lifecycle**: [`packages/widgets/src/lockscreen/index.tsx`](../../packages/widgets/src/lockscreen/index.tsx).
- **Password entry**: [`authPanel.tsx`](../../packages/widgets/src/lockscreen/authPanel.tsx).
- **Compositor protocol**: [`SessionLockService`](../../packages/services/src/session/sessionLockService.ts), backed by `Gtk4SessionLock`.
- **Authentication**: [`AuthSession`](../../packages/services/src/session/authSession.ts), [`PAM worker`](../../apps/shell/src/authWorker.ts), and [`FingerprintAuth`](../../packages/services/src/input/fingerprint.ts).
- **Restart recovery**: [`ShellState`](../../packages/services/src/state/shellState.ts) and the [Hyprland defaults](../../nix/hyprland/default.nix).

Each native session-lock `monitor` event creates an unrealized `Gtk.Window`. The native library assigns and maps that window after the protocol lock request. These are not ordinary Astal layer-shell overlays. Authentication starts only after the compositor confirms `locked`.

## Authentication

| State | Expected behavior |
|---|---|
| Password submitted before lock confirmation or while another attempt is pending | Not accepted; entered text is retained |
| Accepted password submission | Entry is cleared; one isolated PAM worker receives the password through stdin |
| Invalid password or helper failure | Session remains locked; a fresh password attempt is possible |
| PAM attempt takes longer than 10 seconds | Worker is terminated and its attempt generation retired; timeout is shown and retry is possible |
| Retired worker completes late | Its result cannot authenticate the current session |
| Valid password or active fingerprint verification succeeds | Authentication is cancelled/cleaned up, GTK lock surfaces are disposed while their native session exists, then the compositor lock is released |
| Fingerprint service unavailable or cleanup fails | Password authentication remains independent and available |
| Lock UI is disposed during shutdown | Active authentication is cancelled, but no compositor unlock is requested |
| Shell-owned normal GTK windows are open when locking | Launcher/Quick Settings/switcher close; normal GTK toplevels are suspended so they cannot retain same-process keyboard ownership. Surviving windows return only after authenticated unlock |

The packaged worker path is fixed to the shell's installation directory. Passwords are not passed through argv or logged; only a successful worker exit with the exact success result is accepted. `scripts/dev.sh` builds a temporary worker for development.

Fingerprint D-Bus calls are asynchronous and bounded. Claim/start calls use a two-second limit; stop/release cleanup uses a one-second limit per call. Device operations are serialized, including across singleton replacement. A retired verification handler is disconnected immediately, and rearming requires acknowledged `VerifyStop` and `Release` before a fresh claim. A timeout or other uncertain cleanup failure does not count as successful teardown.

Authentication does not succeed merely because a backend failed. Password success still requires PAM authentication; fingerprint uses the separate fprintd verification path. Bounded retries and password fallback are not a claim that hardware, PAM, or the operating system cannot fail.

## Restart and monitor behavior

| Event | Expected behavior |
|---|---|
| Shell starts while Hyprland reports `locked` | Lock UI is created immediately, without waiting for another lock command |
| Hyprland IPC adapter or lock-state reply is unavailable | Startup fails closed and requires authentication |
| Shell is stopped or killed while locked | The compositor retains the lock; its emergency lock screen may be visible until the replacement locker maps |
| Replacement shell starts | It reacquires the lock and provides a fresh authentication session |
| Compositor ends the native lock | Pending authentication and lock UI are disposed, and shell state is synchronized |
| Monitor is added or removed while locked | Native monitor events add lock surfaces; removal does not cancel authentication on remaining outputs |

Hyprland requires `misc.allow_session_lock_restore = true` to permit a replacement locker to acquire a retained lock. Shade's NixOS Hyprland defaults enable this. Custom compositor configurations must preserve that setting for restart recovery; restarting the shell is not an unlock mechanism.

## Presentation

The lock surface uses the native theme background and the existing `card`, `title-1`, `title-3`, `numeric`, and `caption` styles. The password field has an explicit accessible name and receives focus after mapping. Peek, clock, media, and notification controls retain their existing behavior. Notification content follows the separate lock-screen privacy preference.

Settings cannot be presented while the shell is locked. Window suspension is a
focus-ownership operation, not an unlock or disposal path: stopping the shell
discards the suspended-window list without presenting it. This covers the
reproduced case where an open PreferencesWindow prevented password keystrokes
from reaching a lock entry that nevertheless reported focused.

## Verification

The isolated VM exercised real PAM rejection followed by a correct password, a deliberately blocked 30-second PAM operation followed by the 10-second client timeout and a successful fresh password attempt, and a later lock held through the retired operation's completion window. It also exercised compositor lock retention across shell stop/start and `SIGKILL`, password recovery after each restart, a 65-second display-off interval, compositor-native headless monitor add/remove, and recovery with unavailable Hyprland IPC. Checks use `hyprctl -j locked`, not only screenshots or a shell boolean.

Regression modules:

- `packages/services/src/__tests__/authSession.test.ts`: activation, timeout/retry, stale results, disposal, and password fallback without fingerprint.
- `packages/services/src/__tests__/fingerprint.test.ts`: queued teardown/rearm, pending claims, early terminal status, retired handlers, cleanup failure, and disposal/replacement.
- `packages/services/src/__tests__/sessionLockService.test.ts`: no false lock confirmation, no pending-acquisition unlock, and rejected acquisition retry.

The disposable VM's private fprintd fixture exercised device discovery, claim, an active swipe warning, no-match, acknowledged stop/release, re-claim, and a mock match. The compositor reported a real lock before verification and a real unlock after the match, and the normal shell was restored afterward. This proves protocol/client behavior only; it is not evidence of a physical reader, enrollment, or biometric authentication. Shortened idle checks do not establish overnight reliability.
