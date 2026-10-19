# Spec: Settings

> Source-linked reference to the current Settings implementation. Source descriptions are not claims of runtime verification.


## Overview

- **Source**: [`packages/widgets/src/settings/`](../../packages/widgets/src/settings/) (page composition: [`index.tsx`](../../packages/widgets/src/settings/index.tsx); lazy lifecycle: [`settingsOpen.ts`](../../packages/widgets/src/settings/settingsOpen.ts))
- **Settings groups**: settings components use the relevant schemas and services under [`packages/services/src/`](../../packages/services/src/).
- **Type**: nonmodal `Adw.PreferencesWindow`, rendered lazily when Settings is opened. Standalone Settings must not retain libadwaita's default application-modal grab and block shell-layer keyboard input.
- `openSettings()` releases Quick Settings' layer keyboard ownership before presenting the existing or newly rendered nonmodal window. An invisible existing instance is closed/disposed before replacement; close-request disposes the current rendered tree.

## Functional

### Pages

| Category | Feature groups in order |
|----------|-------------------------|
| Personalization | Appearance; Bar & Dock |
| Devices | Displays; Sound; Mouse & Touchpad |
| Connectivity | Network; Bluetooth |
| Privacy & Security | Idle & Lock; Notifications; Screen Capture |
| Applications | Default Apps; Startup Apps |
| System | Clock & Weather; Timer; Keyboard Shortcuts; About; Debug |

The six categories retain all 17 feature topics and native preferences search.
Displays contributes sibling preference groups, including Connected Displays and
Display Changes; an empty output list and a failed snapshot are separate states.
Display preview, confirmation and timed rollback remain owned by `LayoutService`.


### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Navigate via sidebar | `Adw.PreferencesWindow` provides page navigation |
| I2 | Search settings | `searchEnabled=true` enables built-in preferences search |

### Lifecycle notes

- Category titles and feature composition follow [`index.tsx`](../../packages/widgets/src/settings/index.tsx); Bluetooth contributes preference groups within Connectivity.
- Settings is a lazy widget; its open action calls `openSettings()` to render the window on demand. The lifecycle behavior above follows [`settingsOpen.ts`](../../packages/widgets/src/settings/settingsOpen.ts).
- This table identifies page composition, not per-control persistence or service behavior. Check the relevant page and service before describing those details.

### Application persistence

- Startup entries are parsed as keyfiles. Only `[Desktop Entry].Hidden` is
  changed; other groups, unknown keys, comments and translations are retained.
  Missing directories are not created by reads. Empty, partial-read and
  directory-failure states are distinct; failed writes reconcile the native
  switch and remain visible until another attempt or Retry read.
- Music, Video and Photo defaults cover registered concrete media formats.
  A selected application changes only its readable supported formats. Other
  defaults remain unchanged; every attempted write is reread and partial
  results show per-format failures without rollback.
- A whole-family app selection is shown only for a uniform confirmed default.
  This GTK/libadwaita version auto-selects the first populated item even when
  assigned `INVALID_LIST_POSITION`; mixed/unread/unset states therefore use an
  explicit non-app status item rather than falsely selecting an application.
  Writes/model reconciliation run after the native selection signal unwinds.

### Live data and countdowns

- Sound distinguishes no endpoint from actual zero volume and mute. Defaults
  resolve only to endpoint IDs present in the current speaker/microphone lists;
  removal cannot leave stale controls. Native endpoint description/name,
  volume and mute notifications update the rows. Desired changes use
  `AudioController` and reconcile to actual endpoint state.
  Mutable native default proxies report `notify::id`, not an Audio-level default
  pointer change; the controller forwards that event before resolving list membership.
- Countdown presets require whole signed-decimal input normalized to a safe
  integer in 1..2,147,483,647 minutes. Invalid/duplicate input is retained with
  guidance. Successful edits update Settings and Quick Settings reactively.
  Restore default presets has a page-local one-step Undo of the exact prior list.
- World clocks show location, timezone ID and time using the shared
  `Clock.wallTime` minute tick, with no per-row timer or navigation needed.

### Operation results

- Dynamic theming publishes busy/error state and resolves Regenerate only after
  valid palette application. Same-wallpaper work is coalesced; superseded work
  cannot replace newer colors or clear newer status. Failures retain the prior
  valid palette.
- Bluetooth connect/disconnect await native finish; device, scan and power
  failures are local and busy state settles. A failed Forget keeps its
  confirmation open rather than claiming the device was removed.
- Detect Location and Update Weather show adjacent busy/error feedback.
  Auto Location off means Detect persists coordinates only; Update is separate.
  Weather serializes native requests and matches each Promise to its completion.
  Disposal rejects pending work, aborts Info, and retires late detection results.

### Keyboard shortcut metadata

- Shade-owned defaults use Hyprland described bindings with
  `shade-action:<registered-id>`. One service formatter handles metadata and
  compositor meanings; unknown command text is never guessed into a Shade action.
- Native expander rows show the task and combo first; details expose a selectable
  exact command and Copy command. Authored descriptions render literally.
- Refresh occurs on entry into the selected visible System page or explicit
  Refresh, not on preference-group remapping while results/search rebuild.

### GTK/libadwaita compatibility

- Mouse and power `Gtk.DropDown` controls install their `Gtk.StringList` model before applying the selected index. Reassigning the model from a ref callback resets an existing selection.
- Sound page sections are sibling `Adw.PreferencesGroup` widgets, not a group nested inside another group.
- Hotspot validation errors are `Adw.ActionRow` children of their preferences group. A rejected activation restores the switch to the backend's unchanged state.
- Enum toggle choices are populated through native `Adw.ToggleGroup.add()` before
  applying the persisted selection and connecting change handlers. Native
  ownership/`remove_all()` handles teardown; the pinned renderer cannot remove
  declarative `Adw.Toggle` children. Opening or navigating Settings must preserve
  requested non-first selections.
- Shortcut labels escape markup from compositor-provided keybind descriptions, preserving literal characters such as `<A&B>`.
- Read GTK focus booleans through `hasFocus`/`isActive` properties. In the pinned
  GJS runtime, snake-case property aliases can shadow similarly named C methods;
  calling `has_focus()`/`is_active()` throws even when generated types list them.


## Visual (Adwaita alignment)

The window is an `Adw.PreferencesWindow` with the `background` CSS class. Its pages use `Adw.PreferencesPage` and symbolic icon names; built-in search is enabled. Individual page controls use their respective Adwaita widgets. See [`index.tsx`](../../packages/widgets/src/settings/index.tsx) and the [GTK4/libadwaita style guide](../STYLEGUIDE.md).

## Test plan

- **Functional/manual**: inspect navigation and search and compare page behavior with its current implementation. In the disposable Hyprland VM, Sound, Mouse, and Power pages rendered; power actions retained their configured selections; a synthetic `class:<A&B>` shortcut description rendered literally in search. Rejecting an empty hotspot password displayed the inline error, left the switch off, and did not change active NetworkManager connections. Closing Settings preserved the shell's MainPID. These observations do not cover every page or control.
- **Visual/manual**: inspect the preferences window in the supported color schemes; no screenshot baseline is asserted here.
