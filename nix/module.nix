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
        services.geoclue2.enable = lib.mkDefault true;

        environment.systemPackages = [
          cfg.package
          pkgs.adwaita-icon-theme
          pkgs.brightnessctl
          pkgs.hyprshot
          pkgs.playerctl
          pkgs.pwvucontrol
        ];
        security.pam.services.astal-auth = {};
        # Start shade-shell as a systemd user service with auto-restart on failure
        systemd.user.services.shade-shell = {
          description = "Shade — Hyprland Adwaita Desktop Environment";
          after = [ "graphical-session.target" ];
          partOf = [ "graphical-session.target" ];
          wantedBy = [ "graphical-session.target" ];
          serviceConfig = {
            ExecStart = "${pkgs.writeShellScript "shade-shell-launch" ''
              if [ -f /etc/set-environment ]; then
                . /etc/set-environment
              fi
              exec ${cfg.package}/bin/shade-shell
            ''}";
            Restart = "on-failure";
            RestartSec = "3";
            Type = "exec";
          };
        };
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
