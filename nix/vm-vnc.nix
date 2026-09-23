{ config, lib, pkgs, inputs, ... }:

let
  cfg = config.programs.shade;
in
{
  imports = [
    # inputs.self.nixosModules.default already imports the hyprland nixos
    # module (via ./module.nix), so importing it again here double-declares
    # every programs.hyprland.* option.
    inputs.self.nixosModules.default
    # nixpkgs >= 25.05 stopped importing qemu-vm.nix by default (it now only
    # appears in documentation.extraModules); import it explicitly or every
    # virtualisation.* VM option is undefined.
    "${inputs.nixpkgs}/nixos/modules/virtualisation/qemu-vm.nix"
  ];

  # === VM hardware ===
  virtualisation = {
    memorySize = 4096;
    cores = 4;
    graphics = true;
    qemu.options = [
      # virtio GPU with virgl; requires a GL display backend (egl-headless
      # in the headless run)
      "-device virtio-vga-gl"
      # USB tablet for proper cursor tracking
      "-usb"
      "-device usb-tablet"
      # Audio
      "-audiodev pa,id=pa0"
      "-device intel-hda"
      "-device hda-duplex,audiodev=pa0"
    ];
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
  # The greetd NixOS module already defines users.users.greeter
  # (isSystemUser) — do not redeclare it here.
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
          "AQ_DRM_DEVICES,/dev/dri/card0"
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
    noto-fonts-color-emoji
  ];

  # === Nix settings ===
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    accept-flake-config = true;
  };

  system.stateVersion = "24.11";
}