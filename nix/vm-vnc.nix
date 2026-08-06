{ config, lib, pkgs, inputs, ... }:

let
  cfg = config.programs.shade;
in
{
  imports = [
    inputs.hyprland.nixosModules.default
    inputs.self.nixosModules.default
  ];

  # === VM hardware ===
  virtualisation = {
    memorySize = 4096;
    cores = 4;
    qemu = {
      graphics = true;
      videoDriver = "virtio-vga";
      display = "gtk";
      options = [
        # VNC server on port 5900
        "-vnc :0"
        # virtio GPU with virgl for 3D acceleration (needed by Hyprland)
        "-device virtio-vga-gl"
        "-display gtk,gl=on"
        # USB tablet for proper cursor tracking
        "-usb"
        "-device usb-tablet"
        # Audio
        "-audiodev pa,id=pa0"
        "-device intel-hda"
        "-device hda-duplex,audiodev=pa0"
      ];
    };
  };

  # === SSH for headless test commands ===
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = true;
      PermitRootLogin = "no";
      UsePAM = false;
    };
  };

  # === Networking ===
  networking = {
    hostName = "shade-vm";
    networkmanager.enable = true;
    firewall.enable = false;
  };

  # === Test user ===
  users.users.tester = {
    isNormalUser = true;
    password = "test";
    description = "Shade VM test user";
    extraGroups = [ "networkmanager" "video" "input" ];
    shell = pkgs.bash;
  };

  # Ensure the greeter user exists (greetd needs it)
  users.users.greeter = {
    isNormalUser = true;
    description = "greetd greeter user";
    group = "greeter";
  };
  users.groups.greeter = {};

  # === Shade shell ===
  programs.shade = {
    enable = true;
    shell = {
      enable = true;
      blur.enable = false; # disable blur in VM for performance
    };
    desktop = {
      enable = true;
      hyprland.enable = true;
      hyprland.binds.enable = true;
      hyprland.settings = {
        # VM-friendly Hyprland settings
        monitor = [
          "Virtual-1, preferred, auto, 1"
        ];
        decoration = {
          blur.enabled = false;
          shadow.enabled = false;
        };
        animations.enabled = false;
        misc = {
          disable_hyprland_logo = true;
          disable_splash_rendering = true;
          vrr = 0;
        };
        env = [
          "AQ_DRM_DEVICES,/dev/dri/renderD128"
        ];
      };
    };
    greeter.enable = true;
  };

  # === needed services ===
  services.greetd = {
    enable = true;
    settings.default_session = {
      command = "${pkgs.cage}/bin/cage -s -- ${cfg.package}/bin/shade-shell-greet";
      user = "greeter";
    };
  };

  # === extra packages for testing ===
  environment.systemPackages = with pkgs; [
    # Screenshot/capture tools available inside the VM
    grim
    slurp
    imagemagick
    wl-clipboard
    # For debugging
    d-spy
    gtk4
    libadwaita
    # Network tools
    curl
    jq
  ];

  # === systemd target for graphical-session ===
  systemd.targets.graphical-session = {
    enable = true;
    wants = [ "graphical-session-pre.target" ];
  };

  # === Sound ===
  security.rtkit.enable = true;
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = true;
  };

  # === Timezone for reproducible screenshots ===
  time.timeZone = "UTC";

  # === Fonts ===
  fonts.packages = with pkgs; [
    adwaita-fonts
    google-fonts
    noto-fonts
    noto-fonts-emoji
  ];

  # === Nix settings ===
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    accept-flake-config = true;
  };

  system.stateVersion = "24.11";
}