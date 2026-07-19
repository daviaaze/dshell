# Spec: Greeter

> Login greeter for greetd — username/password authentication before session start.

## Overview

- **Source**: `src/widget/greeter/` (entry: `index.tsx`, `GreetSession.ts`), `src/apps/greeter/main.ts`
- **Dependencies**: `GreetSession` (custom AstalGreet wrapper), `Astal`, `Gio.Application` (standalone Gtk app: `com.caioasmuniz.shade_shell.greeter`)
- **Type**: Standalone Gtk application (not part of the main shell). Runs as a layer-shell window covering the entire screen.

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Initial / Username prompt | App starts | Shows username entry with pre-filled `$USER`; avatar with initials; "Continue" button |
| F2 | Password prompt | User enters username and clicks Continue (or presses Enter) | `GreetSession.start()` called with username; password entry shown; button text changes to "Log In" |
| F3 | Authenticating | User submits password | `GreetSession.postAuth(pw)` called; spinner shown; button disabled during `authenticating`/`creating-session` states |
| F4 | Authentication error | PAM/greetd auth fails | Error message shown in `caption` + `error` styled label |
| F5 | Authenticated | greetd confirms success | `GreetSession.startSession(['Hyprland'])` called → session launched; greeter quits |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Enter username, press Enter | Moves to password step |
| I2 | Enter password, press Enter | Submits for authentication |
| I3 | Click "Continue" / "Log In" button | Same as Enter |
| I4 | Password peek icon | Shows/hides password |
| I5 | Escape | Not handled — greeter is EXCLUSIVE keymode |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | greetd daemon unreachable | GreetSession state transitions to error with descriptive message |
| E2 | Username not in system | greetd returns failure after password step — error shown |
| E3 | Empty password | Button still submits; greetd handles (likely fail) |
| E4 | Session launch fails (Hyprland not found) | Session creation error caught and displayed |

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

- **Unit**: extract and test GreetSession state machine transitions, reactive visibility logic for form fields
- **Compliance linter**: no expected violations
- **Visual/manual**: screenshot of username step, password step, authenticating spinner, error state
