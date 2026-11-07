# Shade

Shade is a GTK4/libadwaita desktop shell for Hyprland, with a greetd sign-in application and an XDPH screen-share picker. Its shell provides panels, application and window navigation, Quick Settings, Settings, notifications, capture controls, and lock/power surfaces. The guides distinguish source-traced behavior from runtime-verified behavior.

## Documentation

- [User workflows](docs/workflows.md): entry points, steps, visible outcomes, and implementation trails.
- [Architecture and visual design](docs/design.md): boot flow, shell surfaces, and current styling conventions.
- [GTK4/libadwaita style guide](docs/STYLEGUIDE.md): native CSS variables and widget classes.
- [Feature specifications](docs/specs/): source-linked references; older specifications may not match the current implementation.
- [VM radio testing](docs/vm-radio-testing.md): isolated guest Wi-Fi and Bluetooth test setup.

## Dependency updates

Run `nix flake update` to update Astal, Hyprland and nixpkgs. Keep Hyprland's
transitive library revisions coordinated with its own lockfile rather than
updating them independently. The shell wrapper and patched screen-share portal
use the dedicated Hyprland input, matching the compositor selected by Shade.

Hyprland 0.57 removed the legacy `hyprland.conf` format. Shade installs a Lua
configuration; updating only the compositor while retaining an older Shade
module can make Hyprland generate its default configuration instead. Update the
Shade input in each consuming host and rebuild that host before starting a new
session.

The optional hyprtasking overview integration was removed because its current
upstream source does not build against Hyprland 0.57. Remove any
`programs.shade.desktop.hyprland.overview` assignments from consuming hosts;
SUPER+grave no longer opens the plugin overview.

The generated configuration is `/etc/xdg/hypr/hyprland.lua`. The UWSM launcher
selects it explicitly, so an old user configuration cannot shadow the system
configuration. Add native extensions with
`programs.shade.desktop.hyprland.extraLuaConfig`; legacy `extraConfig` and bind
strings must be rewritten as Lua (`hl.bind` and `hl.dsp`).

Upstream references: [Hyprland 0.57 release notes](https://github.com/hyprwm/Hyprland/releases/tag/v0.57.0)
and [removal of legacy configuration support](https://github.com/hyprwm/Hyprland/pull/15539).
