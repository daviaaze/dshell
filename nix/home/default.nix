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
      grim
      libcanberra-gtk3
      qalculate-gtk
      wf-recorder
      wl-screenrec
      brightnessctl
      playerctl
      libnotify
    ];

    services = {
      ssh-agent.enable = true;
      polkit-gnome.enable = true;
    };

    # KDE Connect needs a Qt platform plugin on non-KDE desktops.
    # Without this, kdeconnect-indicator may fail to initialize on Wayland.
    home.sessionVariables = {
      QT_QPA_PLATFORM = "wayland;xcb";
    };

    # Configure XDPH to use our custom share picker
    # The shade-shell-share-picker binary is installed by the shade desktop module
    xdg.configFile."hypr/xdph.conf" = {
      text = ''
        screencopy {
            custom_picker_binary = shade-shell-share-picker
        }
      '';
    };

    # Ensure GNOME Keyring default collection points to 'login', which is
    # automatically unlocked by greetd PAM (pam_gnome_keyring).
    xdg.dataFile."keyrings/default".text = "login";

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

  };
}
