# Lock Screen Auth Fix — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Scope:** `src/widget/lockscreen/index.tsx`, `src/lib/fingerprint.ts`

## Problem

After sleep/wake, the lock screen has two auth failures:

1. **Password**: `AstalAuth.Pam.authenticate()` (static method) silently fails — the async callback never fires. The entry accepts input but pressing Enter does nothing.
2. **Fingerprint**: fprintd returns errors (e.g., `verify-unknown-error`) after wake. The current code only retries on `verify-no-match`, so other errors leave fingerprint permanently broken for the session.

## Solution

### 1. Password Auth — Instance-based PAM

Replace the static `AstalAuth.Pam.authenticate()` with the instance-based API. A fresh `AstalAuth.Pam` instance is created per lock session.

**Flow:**

1. On lock screen mount, create a new `AstalAuth.Pam` instance
2. Connect to signals: `auth-prompt-hidden`, `success`, `fail`, `auth-error`
3. User types password, presses Enter
4. Call `pam.start_authenticate()` — PAM begins the conversation
5. PAM emits `auth-prompt-hidden` → call `pam.supply_secret(password)`
6. PAM emits `success` → unlock
7. PAM emits `fail` → show error, clear field, user retries (call `start_authenticate()` again)
8. Safety timeout: if neither `success` nor `fail` fires within 10s, show "Authentication timed out" and allow retry

**Key benefit:** Fresh PAM handle per lock session eliminates staleness after wake. The timeout catches silent hangs.

**Implementation notes:**

- The `Pam` instance is created inside `createLocks()` and destroyed on cleanup
- The password entry's `onActivate` triggers `start_authenticate()` and stores the password text for the `supply_secret()` call
- The `auth-prompt-hidden` handler calls `supply_secret()` with the stored password
- The timeout is a `GLib.timeout_add` that fires once after 10s and is cancelled on `success`/`fail`

### 2. Fingerprint State Machine

Refactor `FingerprintAuth` to use an explicit state machine with better error recovery.

**States:**

| State | Description |
|-------|-------------|
| `idle` | Not verifying, device released |
| `initializing` | Probing device, claiming |
| `verifying` | `VerifyStart` called, waiting for swipe |
| `error` | Non-recoverable or repeated failure |

**Transitions:**

1. Lock screen mounts → `idle` → `initializing` → `verifying` (auto-start)
2. `verify-match` → emit `verified` → unlock
3. `verify-no-match` → auto-retry: `VerifyStop` → `Release` → `Claim` → `VerifyStart` (re-init cycle, max 3 consecutive retries)
4. `verify-retry` / `verify-swipe-too-short` → stay in `verifying`, show "Try again..."
5. Any other error (e.g., `verify-unknown-error` after wake) → `error` state, show error message + manual retry button
6. After 3 consecutive `verify-no-match` failures → `error` state, show "Too many attempts" + manual retry button
7. Manual retry button → `error` → `initializing` → `verifying` (full re-init)
8. Unlock / cleanup → `idle` (stop + release)

**New GObject properties on `FingerprintAuth`:**

- `state` (string): `"idle" | "initializing" | "verifying" | "error"` — drives UI visibility
- `errorMessage` (string): human-readable error for the `error` state

**UI changes in lockscreen:**

- Spinner visible when `state === "verifying"` or `state === "initializing"`
- Status label shows contextual messages based on state
- A "Retry fingerprint" button appears only when `state === "error"`

**Implementation notes:**

- `FingerprintAuth` gains a `#consecutiveFailures` counter, reset on success or manual retry
- The re-init cycle on `verify-no-match` does a full `VerifyStop` → `Release` → `Claim` → `VerifyStart` to handle stale device state after wake
- The `retry()` public method transitions from `error` → `initializing` and resets the failure counter
- The `verifying` getter is replaced by `state` (backward compat: `verifying` returns `state === "verifying"`)

### 3. Files Changed

| File | Change |
|------|--------|
| `src/lib/fingerprint.ts` | Add state machine, `state`/`errorMessage` properties, `retry()` method, re-init on failure |
| `src/widget/lockscreen/index.tsx` | Switch to instance-based PAM, add timeout, bind to fingerprint state, add retry button |

### 4. Not in Scope

- No changes to PAM service configuration (`nix/module.nix`)
- No changes to fprintd system service
- No changes to hypridle or sleep/wake triggers
- No new dependencies
