{
  config,
  lib,
  pkgs,
  inputs,
  ...
}:

let
  cfg = config.programs.shade;
  bluezTesting = pkgs.bluez.overrideAttrs (old: {
    configureFlags = (old.configureFlags or [ ]) ++ [ "--enable-testing" ];
    postInstall = (old.postInstall or "") + ''
      install -Dm755 emulator/btvirt "$out/bin/btvirt"
    '';
  });
  networkmanagerForVm = pkgs.networkmanager.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [ ./patches/networkmanager-nix-store-plugins.patch ];
  });
in

{
  boot.kernelModules = [
    "mac80211_hwsim"
    "hci_vhci"
  ];
  boot.extraModprobeConfig = "options mac80211_hwsim radios=2";
  # qemu-vm disables wireless by default; this guest provides virtual radios.
  networking.wireless.enable = lib.mkOverride 5 true;
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
      # Plain virtio VGA keeps the VM compatible with QEMU's VNC display backend.
      "-device virtio-vga"
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
    };
  };

  # === Networking ===
  networking = {
    hostName = "shade-vm";
    networkmanager.enable = true;
    firewall.enable = false;
  };

  # Test-only radios remain inside this guest; no host device passthrough.
  networking.networkmanager.unmanaged = [ "interface-name:wlan1" ];
  networking.networkmanager.settings.device-hwsim = {
    "match-device" = "interface-name:wlan0";
    managed = true;
  };
  systemd.services.NetworkManager.path = [ pkgs.wpa_supplicant ];
  networking.networkmanager.logLevel = "WARN";
  networking.networkmanager.package = networkmanagerForVm;
  hardware.bluetooth = {
    enable = true;
    package = bluezTesting;
    powerOnBoot = true;
  };

  environment.etc."hostapd-shade-vm.conf".text = ''
    interface=wlan1
    driver=nl80211
    ssid=Shade-Test
    hw_mode=g
    channel=6
    wpa=2
    wpa_key_mgmt=WPA-PSK
    rsn_pairwise=CCMP
    wpa_passphrase=shade-test
  '';

  systemd.services.shade-vm-wifi-ap = {
    description = "Isolated Wi-Fi access point for Shade VM testing";
    wantedBy = [ "multi-user.target" ];
    after = [
      "systemd-modules-load.service"
      "NetworkManager.service"
    ];
    serviceConfig = {
      Type = "simple";
      ExecStartPre = pkgs.writeShellScript "shade-vm-wifi-ap-prepare" ''
        ${pkgs.iproute2}/bin/ip link set dev wlan1 up
        ${pkgs.iproute2}/bin/ip address replace 10.42.0.1/24 dev wlan1
      '';
      ExecStart = "${pkgs.hostapd}/bin/hostapd /etc/hostapd-shade-vm.conf";
      Restart = "on-failure";
    };
  };

  systemd.services.shade-vm-wifi-dhcp = {
    description = "DHCP for the isolated Shade VM test access point";
    wantedBy = [ "multi-user.target" ];
    requires = [ "shade-vm-wifi-ap.service" ];
    after = [ "shade-vm-wifi-ap.service" ];
    serviceConfig = {
      Type = "simple";
      ExecStart = "${pkgs.dnsmasq}/bin/dnsmasq --keep-in-foreground --bind-interfaces --interface=wlan1 --no-resolv --port=0 --dhcp-range=10.42.0.10,10.42.0.100,12h";
      Restart = "on-failure";
    };
  };

  systemd.services.shade-vm-btvirt = {
    description = "Virtual Bluetooth controllers for Shade VM testing";
    wantedBy = [ "multi-user.target" ];
    before = [ "bluetooth.service" ];
    after = [ "systemd-modules-load.service" ];
    serviceConfig = {
      Type = "simple";
      ExecStart = "${bluezTesting}/bin/btvirt -l2";
      Restart = "on-failure";
    };
  };

  # === Test user ===
  users.users.tester = {
    isNormalUser = true;
    password = "test";
    description = "Shade VM test user";
    extraGroups = [
      "networkmanager"
      "video"
      "input"
    ];
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

  # Enable guest-side accessibility APIs for semantic UI automation.
  services.gnome.at-spi2-core.enable = true;

  environment.systemPackages = with pkgs; [
    # Screenshot/capture tools available inside the VM
    grim
    slurp
    imagemagick
    wf-recorder
    wl-clipboard
    glib
    libnotify
    # For debugging
    d-spy
    gtk4
    libadwaita
    python3
    # Network tools
    curl
    jq
    iw
    wpa_supplicant
    bluezTesting
    hostapd
    dnsmasq
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
    experimental-features = [
      "nix-command"
      "flakes"
    ];
    accept-flake-config = true;
  };

  system.stateVersion = "24.11";
}
