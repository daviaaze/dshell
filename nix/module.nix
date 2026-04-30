inputs:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.shade;
in
{
  imports = lib.mkIf cfg.desktop.enable [
    inputs.hyprland.nixosModules.default
    ./hyprland
  ];

  options.programs.shade = {
    enable = lib.mkEnableOption "Shade shell";
    package = lib.mkOption {
      type = lib.types.package;
      default = inputs.self.packages.${pkgs.system}.default;
      description = "The shade-shell package to use";
    };

    shell = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable Shade shell components (bar, QS, launcher, notifications, etc.)";
      };
      blur.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Enable layer rules to blur the widget's background in Hyprland.
        '';
      };
    };

    desktop = {
      enable = lib.mkEnableOption "Shade desktop environment defaults (Hyprland config, keybinds, default apps)";
      defaultBrowser = lib.mkOption {
        type = lib.types.str;
        default = "firefox";
        description = "Desktop file name of the default web browser";
      };
      defaultFileManager = lib.mkOption {
        type = lib.types.str;
        default = "org.gnome.Nautilus";
        description = "Desktop file name of the default file manager";
      };
      defaultTerminal = lib.mkOption {
        type = lib.types.str;
        default = "com.mitchellh.ghostty";
        description = "Desktop file name of the default terminal emulator";
      };
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      (lib.mkIf cfg.shell.enable {
        environment.systemPackages = [
          cfg.package
          pkgs.adwaita-icon-theme
          pkgs.brightnessctl
          pkgs.hyprshot
          pkgs.playerctl
          pkgs.pwvucontrol
          pkgs.wvkbd
        ];
        security.pam.services.astal-auth = {};
        programs.hyprland.settings.exec-once = [ "uwsm-app -t service -- shade-shell" ];
      })
      (lib.mkIf (cfg.shell.enable && cfg.shell.blur.enable) {
        programs.hyprland.settings.layerrule = [
          "blur on, match:namespace gtk4-layer-shell"
          "ignore_alpha 0, match:namespace gtk4-layer-shell"
        ];
      })
    ]
  );
}
