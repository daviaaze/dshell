{
  pkgs,
  lib,
  config,
  ...
}:
{
  # Mount virtiofs shared directory from host /tmp/shade-test-output
  # to /mnt/test-output inside the VM for easy artifact exchange
  fileSystems."/mnt/test-output" = {
    device = "test-output";
    fsType = "9p";
    options = [
      "trans=virtio"
      "version=9p2000.L"
      "cache=loose"
    ];
    mountPoint = "/mnt/test-output";
  };

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
        command = "${pkgs.bash}/bin/bash -lc 'exec ${lib.getExe pkgs.uwsm} start hyprland-uwsm.desktop'";
        user = "test";
      };
    };
  };
  services.qemuGuest.enable = true;
  services.spice-vdagentd.enable = true;

  # Enable SSH for agent-driven D-Bus testing from host
  # Port forward: hostfwd=tcp::2222-:22 (see vm-vnc.nix)
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = true;
      PermitRootLogin = "no";
    };
  };

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

  environment.systemPackages = with pkgs; [
    firefox
    moonlight-qt
    ghostty
    btop
    # Test artifact tools
    grim # Wayland screenshots
    slurp # Region selection for screenshots
    wf-recorder # Wayland screen recording
  ];

  programs.shade.desktop.hyprland.settings = {
    bind = [
      "SUPERSHIFT,Return,exec,${lib.getExe pkgs.uwsm} app -- ${config.programs.shade.desktop.defaultTerminal}"
      "SUPERSHIFT,B,exec,${lib.getExe pkgs.uwsm} app -- ${config.programs.shade.desktop.defaultBrowser}"
    ];
  };

  system.stateVersion = "25.05";
}
