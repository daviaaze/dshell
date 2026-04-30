{ pkgs, lib, config, ... }:
{
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  users.users.test = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
    initialPassword = "test";
  };

  programs.regreet.enable = true;
  services.greetd = {
    enable = true;
    settings = {
      initial_session = {
        command = "${lib.getExe pkgs.uwsm} start hyprland-uwsm.desktop";
        user = "test";
      };
    };
  };
  services.qemuGuest.enable = true;
  services.spice-vdagentd.enable = true;

  virtualisation.vmVariant.virtualisation = {
    memorySize = 2048;
    cores = 3;
  };

  programs.shade = {
    enable = true;
    desktop = {
      enable = true;
      defaultBrowser = "firefox";
      defaultTerminal = "com.mitchellh.ghostty";
    };
  };

  environment.systemPackages = with pkgs;[
    firefox
    moonlight-qt
    ghostty
    btop
  ];

  programs.shade.desktop.hyprland.settings = {
    bind = [
      "SUPERSHIFT,Return,exec,${lib.getExe pkgs.uwsm} app -- ${config.programs.shade.desktop.defaultTerminal}"
      "SUPERSHIFT,B,exec,${lib.getExe pkgs.uwsm} app -- ${config.programs.shade.desktop.defaultBrowser}"
    ];
  };

  system.stateVersion = "25.05";
}
