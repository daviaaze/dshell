inputs:
{ config, lib, pkgs, ... }:

let
  cfg = config.programs.shade.home;
in
{
  options.programs.shade.home = {
    enable = lib.mkEnableOption "Shade home-manager configuration";
  };

  config = lib.mkIf cfg.enable {
    home.packages = with pkgs; [
      hyprshot
      wl-clipboard
      qalculate-gtk
      wf-recorder
      wl-screenrec
      cliphist
      wl-clip-persist
      brightnessctl
      playerctl
      libnotify
    ];

    services = {
      ssh-agent.enable = true;
      udiskie.enable = true;
      polkit-gnome.enable = true;
      kdeconnect = {
        enable = true;
        indicator = true;
      };
      cliphist.enable = true;
    };

    # Fix cliphist and wl-clip-persist failing because WAYLAND_DISPLAY
    # is not passed to systemd user services by default.
    systemd.user.services.cliphist = {
      Service = {
        PassEnvironment = [ "WAYLAND_DISPLAY" "XDG_RUNTIME_DIR" ];
      };
    };
    systemd.user.services.cliphist-images = {
      Service = {
        PassEnvironment = [ "WAYLAND_DISPLAY" "XDG_RUNTIME_DIR" ];
      };
    };

    # KDE Connect needs a Qt platform plugin on non-KDE desktops.
    # Without this, kdeconnect-indicator may fail to initialize on Wayland.
    home.sessionVariables = {
      QT_QPA_PLATFORM = "wayland;xcb";
    };

    programs.ssh = {
      enable = true;
      matchBlocks."*" = {
        addKeysToAgent = "yes";
      };
    };

    services.hypridle = {
      enable = true;
      settings = {
        general = {
          after_sleep_cmd = "hyprctl dispatch dpms on";
          ignore_dbus_inhibit = false;
          lock_cmd = "shade-shell lockscreen";
        };
        listener = [
          {
            timeout = 300;
            on-timeout = "shade-shell lockscreen";
          }
          {
            timeout = 380;
            on-timeout = "hyprctl dispatch dpms off";
            on-resume = "hyprctl dispatch dpms on";
          }
          {
            timeout = 900;
            on-timeout = "systemctl suspend";
          }
        ];
      };
    };

    # wl-clip-persist keeps clipboard content after the source app closes.
    # No Home Manager module exists for this, so we define the service manually.
    systemd.user.services.wl-clip-persist = {
      Unit = {
        Description = "Persist clipboard after app closes";
        PartOf = [ "graphical-session.target" ];
      };
      Service = {
        ExecStart = "${pkgs.wl-clip-persist}/bin/wl-clip-persist --clipboard regular";
        Restart = "on-failure";
        PassEnvironment = [ "WAYLAND_DISPLAY" "XDG_RUNTIME_DIR" ];
      };
      Install = {
        WantedBy = [ "graphical-session.target" ];
      };
    };
  };
}
