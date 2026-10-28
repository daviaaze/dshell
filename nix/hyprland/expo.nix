{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.shade.desktop.hyprland;
  ocfg = cfg.overview;

  # Plugins must match the compositor ABI exactly. Rebuilding the plugin set
  # against programs.hyprland.package keeps them in lockstep even if the
  # package option is overridden (a per-plugin .override has no hyprland arg).
  hyprtasking =
    (pkgs.hyprlandPlugins.override { hyprland = config.programs.hyprland.package; }).hyprtasking;
  hyprctl = lib.getExe' config.programs.hyprland.package "hyprctl";
in
{
  options.programs.shade.desktop.hyprland.overview = {
    enable = lib.mkEnableOption ''
      the hyprtasking workspace overview (SUPER+grave). hyprexpo is no longer
      shipped for Hyprland 0.56, so hyprtasking is used instead. The plugin is
      loaded with `hyprctl plugin load` after startup, so a broken plugin only
      shows an error notification and never blocks login
    '';
    gesture = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Open the overview with a 4-finger swipe up (handled by the plugin).
        Disabled by default because the base config uses that gesture for the
        scratchpad.
      '';
    };
  };

  config = lib.mkIf (cfg.enable && ocfg.enable) {
    programs.hyprland.plugins = [ hyprtasking ];

    programs.hyprland.settings = {
      plugin.hyprtasking = {
        layout = "grid";
        # Matches general:gaps_out and the Adwaita palette in default.nix.
        gap_size = 4;
        bg_color = "0xff242424";
        border_size = 2;
        exit_on_hovered = 1;
        close_overview_on_reload = true;
        grid = {
          rows = 3;
          cols = 3;
          gaps_use_aspect_ratio = true;
        };
        gestures = {
          enabled = ocfg.gesture;
          open_fingers = 4;
          open_positive = true;
        };
      };

      # The plugin is loaded by exec-once *after* the config is parsed, so binding
      # its dispatchers directly would raise "Invalid dispatcher" config errors
      # (red overlay) on every login. Going through `exec hyprctl dispatch` is
      # always valid at parse time. Escape stays non-consuming (bindn).
      bindd = [
        "SUPER,grave,Workspace overview,exec,${hyprctl} dispatch hyprtasking:toggle cursor"
      ];
      bindn = [
        ",escape,exec,${hyprctl} dispatch hyprtasking:if_active 'hyprtasking:toggle cursor'"
      ];
    };
  };
}
