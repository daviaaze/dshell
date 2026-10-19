# Spec: Greeter

> Login greeter for greetd — username/password authentication before session start.

## Overview

- **Source**: [`index.tsx`](../../apps/greeter/src/greeter-ui/index.tsx), [`GreetSession.ts`](../../apps/greeter/src/greeter-ui/GreetSession.ts), and [`main.ts`](../../apps/greeter/src/main.ts)
- **Dependencies**: `GreetSession` (AstalGreet wrapper), `AccountsService` for known users, and `Gio.Application` (standalone Gtk app: `com.caioasmuniz.shade_shell.greeter`)
- **Type**: Standalone Gtk application launched by greetd. It authenticates through greetd/PAM before starting the selected session.

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Initial selected account | Greeter window is presented | Selects the last known AccountsService user, or the first eligible user, and starts that account's PAM conversation without Continue |
| F2 | Manual account | User chooses “Use another account” or AccountsService is unavailable | Username entry stays deliberate; Enter or Continue starts PAM for the entered username |
| F3 | PAM input/fingerprint wait | greetd returns PAM INFO or a visible/secret input request | Password entry remains editable during PAM INFO; Enter queues a password response until greetd requests input, and Log In is enabled only when PAM asks |
| F4 | Authentication error | PAM/greetd auth fails | Error appears in the styled label; Log In can retry the current account |
| F5 | Authenticated | greetd confirms authentication success | Requests the command selected in the Session picker; greeter quits after greetd accepts the session-start request, allowing the scheduled session to launch |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Select a known account | Starts authentication immediately for that account |
| I2 | Enter a manual username and press Enter / Continue | Starts authentication for the entered name |
| I3 | Enter a password and press Enter / Log In | Sends only when PAM requests input; an early Enter is held until that request |
| I4 | Password peek icon | Shows/hides the password |
| I5 | Back / Escape | Cancels the current PAM flow and returns to account selection; it does not auto-start again until the user explicitly selects an account or presses Continue |
| I6 | Restart / Power Off | Open a native confirmation dialog; Cancel, Escape and dismissal never call logind |
| I7 | Keyboard indicator | Show the first valid configured XKB entry, not an inferred active layout; switching limitations are secondary description/tooltip |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | greetd daemon unreachable | GreetSession state transitions to error with a descriptive message |
| E2 | Username not in system | greetd/PAM returns an error; the greeter shows it and permits a retry |
| E3 | Empty password | The greeter does not submit an empty field |
| E4 | Session launch fails | The session-start error is shown; Log In can start a fresh authentication attempt |
| E5 | Account switch or Back during authentication | greetd cancellation is acknowledged before another account starts; generation-bound late callbacks cannot authenticate or launch a session for the newly selected account |

## Authentication lifecycle and native constraints

- Initial auto-start and explicit account selection are wired in [`Greeter`](../../apps/greeter/src/greeter-ui/index.tsx); manual username entry starts only on Enter or Continue.
- [`GreetSession`](../../apps/greeter/src/greeter-ui/GreetSession.ts) uses explicit AstalGreet `CreateSession`, `PostAuthMessage`, `CancelSession`, and `StartSession` requests. It validates `Success` versus `Error` responses, sends `null` for PAM INFO/ERROR messages, and generation-ignores responses from a cancelled account. Switching waits for both cancellation acknowledgement and the retired auth request's completion/error. If an auth request was outstanding, it confirms cancellation again after that request drains, preventing a late CreateSession from surviving an earlier cancellation acknowledgement.
- Password fallback remains PAM-controlled: the greeter never talks to fprintd directly. The password field accepts typing during PAM INFO/fingerprint waits; pressing Enter early queues the submission, but it is sent only after greetd requests visible or secret input.
- greetd 0.10.3's `get_question` holds its session lock while waiting on PAM. [`nix/module.nix`](../../nix/module.nix) applies [`greetd-session-cancel.patch`](../../nix/patches/greetd-session-cancel.patch) to the default package when Shade's greeter is enabled; the patch allows worker cancellation to wake that wait, serializes create/cancel, and cancels the matching PAM worker when its greeter process exits. The daemon's worker socket is explicitly nonblocking before Tokio takes ownership; otherwise a pending receive can block the runtime thread and starve cancellation. The PAM worker's endpoint remains blocking. A custom `services.greetd.package` remains user-controlled.
- Native cancellation uses Linux pidfd syscalls, avoiding stale numeric-PID signals. Kernels without pidfd support return a greetd session-creation error rather than using an unsafe fallback.
- Standalone startup initializes Adwaita, the settings root and coordinated native color scheme under the greeter account only. It does not initialize shell services or copy another user's dconf.

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window background | No explicit CSS | Gtk theme default background |
| Avatar | `Adw.Avatar(size=96, showInitials)` | Standard Adw component |
| Username label | `title-1` | Large centered |
| Login form | `card` + inline `padding: 24px; min-width: 300px` | Layout-only padding |
| Button | `suggested-action` | Adw action class |
| Error label | `caption` + `error` | Adw classes |
| Spinner | `Adw.Spinner` | Adw component |

### Adwaita checklist

- [x] Uses `card`, `title-1`, `caption`, `suggested-action`
- [x] `suggested-action` button for primary action
- [x] Avatar with initials
- [x] Verified in light and dark

## Test plan

- **Unit**: `nix develop --impure -c env -u LD_PRELOAD -u LD_LIBRARY_PATH ./node_modules/.bin/gnim run apps/greeter/src/__tests__/greeter.test.ts` exercises duplicate starts, PAM INFO/ERROR replies, cancellation acknowledgement/request draining, stale success/password responses, Back suppression, transport errors, and retries. Clearing loader overrides avoids injecting the development shell's layer-shell library into host subprocesses.
- **Visual/manual**: in a disposable greetd VM, observe the PAM prompt/fixture marker before clicking Continue; use only the keyboard to reach password fallback. Exercise Back/Escape during a held PAM INFO wait, select a different known account, then try “Use another account.” Confirm no new PAM conversation occurs while merely typing a manual name, no restart follows Back alone, incorrect-password retry works, and the Session picker still launches the chosen command.
- **Native IPC**: build patched greetd with `doCheck = true` and `cargoTestFlags = [ "--package" "greetd" ]`. `pending_worker_receive_does_not_block_cancellation` exercises cancellation after an initial worker packet while the next receive is pending. In the disposable VM, Back terminated a PAM worker while its synthetic backend remained indefinitely held; selecting the second known account started a new conversation, Back stayed cancelled, and typing a manual name did not start PAM. An early password submission during held PAM INFO then authenticated through real `pam_unix` after release without another click.
- **Fingerprint limitation**: a controlled PAM INFO/hold fixture proves conversation timing and password fallback, not physical fingerprint enrollment, matching, or successful fingerprint authentication. Test those separately on an enrolled sensor.
