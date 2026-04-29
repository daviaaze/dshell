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
  imports = [
    inputs.hyprland.nixosModules.default
    ./hyprland
  ];

  options.programs.shade = {
    enable = lib.mkEnableOption "Enables the shade desktop environment";
    package = lib.mkOption {
      type = lib.types.package;
      default = inputs.self.packages.${pkgs.system}.default;
      description = "The shade-shell package to use";
    };
    shell = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable shade shell";
      };
      blur.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Enable layer rules to blur the widget's background in hyprland.
        '';
      };
    };
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
      (lib.mkIf cfg.shell.blur.enable {
        programs.hyprland.extraConfig = ''
          layerrule = blur, gtk4-layer-shell
          layerrule = ignorealpha 0, gtk4-layer-shell
        '';
      })
    ]
  );
}
