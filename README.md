# Shade — Skill's Hyprland Adwaita Desktop Environment

A personal desktop shell for [Hyprland](https://hyprland.org/) on Linux, written in TypeScript and rendered with [GTK 4](https://gtk.org/) / [Libadwaita](https://gnome.pages.gitlab.gnome.org/libadwaita/) via [GJS](https://gjs.guide/).

Built with [Astal](https://aylur.github.io/astal/) (AyLur's toolkit) and [Gnim](https://github.com/aylur/gnim) (a React-like framework for GTK/GJS with JSX, signals, and state management).

## Features

- **Status Bar** — per-monitor bar with workspaces, system usage, clock, weather, system indicators, keyboard layout, window title, and dock
- **App Launcher** — fuzzy-searchable application grid + clipboard history prefix mode
- **Quick Settings** — control center with Bluetooth, WiFi, Night Light, Caffeinated, Power Profiles, audio/mic/brightness sliders, system tray, per-app volume mixer, media player, notifications, and battery/calendar/weather/world clock expanders
- **Notification Popups** — transient floating toasts with hover-pause and progress bar countdown
- **Notification History** — persistent history with per-app ignore list and history UI
- **OSD** — volume and brightness on-screen display popups
- **Lock Screen** — PAM-based multi-monitor lock screen with fingerprint support
- **Window Switcher** — Alt-Tab replacement with MRU sorting
- **Dock** — bottom taskbar with pinned and running apps
- **Wallpaper** — per-monitor background with automatic day/night switching
- **Dynamic Theming** — Material You color extraction from wallpaper via `matugen`
- **Recording** — screen, region, and window recording with `wf-recorder`
- **Auto Idle** — configurable idle timeout with screen dim and auto-lock via `hypridle`
- **Night Light** — blue light filter with temperature slider and auto-schedule
- **System Updates** — automatic update checking for NixOS/Arch/Fedora

## Quick Start

### NixOS

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    shade-shell.url = "github:caioasmuniz/shade";
  };

  outputs = { self, nixpkgs, shade-shell, ... }: {
    nixosConfigurations.my-machine = nixpkgs.lib.nixosSystem {
      modules = [
        shade-shell.nixosModules.default
        {
          programs.shade = {
            enable = true;
            desktop.enable = true;  # includes Hyprland config + keybinds
          };
        }
      ];
    };
  };
}
```

### Build from source

```bash
git clone https://github.com/caioasmuniz/shade
cd shade
nix build
```

### Run

```bash
nix run
# Or install and start as a user service:
systemctl --user enable --now shade-shell
```

## Architecture

```
src/
├── main.ts            # GJS entry point
├── App.tsx            # Adw.Application subclass
├── lib/               # Core services and utilities
│   ├── keybinds.ts    # Dynamic Hyprland keybinding registration
│   ├── logger.ts      # Shared logging with timestamps
│   ├── shellState.ts  # Reactive state singleton (launcher, QS, lock)
│   ├── monitors.ts    # Gdk monitor tracking + Hyprland mapping
│   └── ...            # Brightness, weather, fingerprint, theming, etc.
├── widget/            # UI widgets
│   ├── bar/           # Status bar and sub-widgets
│   ├── applauncher/   # Application launcher
│   ├── quicksettings/ # Quick settings panel
│   ├── notifications/ # Notification popups
│   ├── lockscreen/    # Lock screen
│   ├── dock/          # Taskbar dock
│   ├── windowswitcher/# Alt-Tab switcher
│   ├── wallpaper/     # Background window
│   ├── osd/           # Volume/brightness popups
│   └── settings/      # Preferences window
└── shade.css          # Global styles
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | GJS (GNOME JavaScript / SpiderMonkey) |
| UI | GTK 4 + Libadwaita |
| Windowing | `gtk4-layer-shell` + Astal |
| Reactive Framework | Gnim (JSX for GTK4) |
| GObject Bindings | `gnim/gobject` (`@register`, `@getter`, `@setter`) |
| Build | Meson + esbuild + Nix Flake |

## Keybindings

| Key | Action |
|-----|--------|
| `Super+Space` | App launcher |
| `Super+N` | Quick settings |
| `Super+W` | Toggle bar visibility |
| `Super+Tab` | Window switcher |
| 3-finger swipe right | App launcher |
| 3-finger swipe left | Quick settings |

Keybindings are registered dynamically by Shade at startup via `hyprctl keyword`.

## Debugging

```bash
# Query logs
journalctl --user _COMM=shade-shell --boot 0 -n 200 --no-pager

# Follow logs in real-time
journalctl --user _COMM=shade-shell --boot 0 -f
```

## License

GPL-3.0-only
