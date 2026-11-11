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

Nix writes the versioned seed to `/etc/xdg/shade/compositor-seed.json`. The UWSM
launcher runs `shade-shell compositor render` before Hyprland and selects the
rendered Lua from `$XDG_RUNTIME_DIR/shade/hyprland.lua`; user overrides live in
`$XDG_CONFIG_HOME/shade/compositor.json`. Add native extensions with
`programs.shade.desktop.hyprland.extraLuaConfig`; legacy `extraConfig` and bind
strings must be rewritten as Lua (`hl.bind` and `hl.dsp`).

Settings → Atalhos permite remapear/restaurar atalhos do compositor, criar
atalhos de aplicativos e mostrar os atalhos correspondentes no lançador. O
overlay global de teclas é opcional e desativado por padrão: ao ativá-lo,
Hyprland envia eventos XKB efêmeros ao shell; o overlay não intercepta entrada,
não grava histórico e pausa com a sessão bloqueada. Ele pode expor texto
digitado em gravações de tela.

Upstream references: [Hyprland 0.57 release notes](https://github.com/hyprwm/Hyprland/releases/tag/v0.57.0)
and [removal of legacy configuration support](https://github.com/hyprwm/Hyprland/pull/15539).
