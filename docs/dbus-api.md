# Shade Shell — D-Bus API Reference

> **Bus**: Session | **Destination**: `com.caioasmuniz.shade_shell`
> **Object Path**: `/com/caioasmuniz/shade_shell` | **Interface**: `org.gtk.Actions`

Shade Shell exposes remote commands via D-Bus using GLib's `GActionGroup` interface. All commands are invoked through the standard `org.gtk.Actions.Activate` method.

---

## Invocation Methods

### 1. gdbus (Recommended — ~7ms)

```bash
gdbus call --session \
  --dest com.caioasmuniz.shade_shell \
  --object-path /com/caioasmuniz/shade_shell \
  --method org.gtk.Actions.Activate \
  '<action-name>' '[]' '{}'
```

This is the method used in Hyprland keybindings and `hypridle.conf`. It bypasses GJS startup entirely, making it ~100x faster than spawning `shade-shell`. The `shade-shell` binary itself also resolves to the same D-Bus call via `Gio.SimpleAction` internally.

### 2. shade-shell CLI (~1s)

```bash
shade-shell <command> [subcommand]
```

Useful for scripting and manual invocation. Internally uses `Gio.SimpleAction.activate()` which calls the same D-Bus method but incurs GJS startup overhead.

---

## Action Reference

### Shell Controls

| Action | CLI | Keybinding | Description |
|--------|-----|-----------|-------------|
| `toggle-applauncher` | `shade-shell toggle applauncher` | `SUPER+Space` | Open/close the app launcher |
| `toggle-quicksettings` | `shade-shell toggle quicksettings` | `SUPER+N` | Open/close quick settings panel |
| `toggle-bar` | `shade-shell toggle bar` | `SUPER+W` | Show/hide the top bar |
| `toggle-windowswitcher` | `shade-shell toggle windowswitcher` | `SUPER+Tab` | Open/close the Alt-Tab window switcher |
| `toggle-settings` | `shade-shell toggle settings` | — | Open the settings window |
| `lockscreen` | `shade-shell lockscreen` | — | Lock the screen immediately |

### Clipboard

| Action | CLI | Keybinding | Description |
|--------|-----|-----------|-------------|
| `toggle-clipboard` | `shade-shell clipboard` | `SUPER+SHIFT+V` | Open/close clipboard in launcher (prefix `>`) |
| `open-clipboard` | — | — | Open clipboard directly |

### Screenshots & Recording

| Action | CLI | Keybinding | Description |
|--------|-----|-----------|-------------|
| `screenshot` | `shade-shell screenshot` | — | Full-screen screenshot (saved to disk) |
| `screenshot-area` | `shade-shell screenshot-area` | `SUPER+SHIFT+S` | Area selection screenshot |
| `record` | `shade-shell record` | `SUPER+ALT+R` | Toggle full-screen recording (wf-recorder) |
| `record-area` | `shade-shell record-area` | — | Record a selected area |
| `record-window` | `shade-shell record-window` | — | Record a specific window |
| `record-output` | `shade-shell record-output` | — | Record a specific monitor/output |

### Device Controls

| Action | CLI | Keybinding | Description |
|--------|-----|-----------|-------------|
| `toggle-touchpad` | `shade-shell touchpad` | `XF86TouchpadToggle` | Enable/disable touchpad |

---

## Internal Architecture

Commands flow through this pipeline:

```
gdbus / shade-shell CLI
    │
    ▼
requestHandler.ts  ── parses args, maps to action name
    │
    ▼
GAction.activate() ── GLib action dispatch
    │
    ▼
ShellState / WindowManager / Screenshot / Touchpad
```

### Adding a New Action

1. Add the handler function to the `actions` map in `src/lib/requestHandler.ts`:

```typescript
const actions: Record<string, () => void> = {
  // ...
  "my-new-action": () => { /* handler logic */ },
}
```

2. Add CLI routing in `requestHandler()`:

```typescript
else if (args[1] === "my-command") activate("my-new-action")
```

3. Add a keybinding in `nix/hyprland/binds.nix`:

```nix
"SUPER,X,exec,${shade-action "my-new-action"}"
```

---

## D-Bus Details

| Property | Value |
|----------|-------|
| Bus type | Session (`--session`) |
| Destination | `com.caioasmuniz.shade_shell` |
| Object path | `/com/caioasmuniz/shade_shell` |
| Interface | `org.gtk.Actions` |
| Method | `Activate(String action_name, Array<GLib.Variant> parameter, GLib.Variant platform_data)` |

The `parameter` is always `[]` (empty array) and `platform_data` is always `{}` (empty dictionary) since all actions are parameterless triggers.
