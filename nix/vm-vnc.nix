{
  config,
  lib,
  pkgs,
  inputs,
  ...
}:

let
  cfg = config.programs.shade;
  bluetoothPeerStart = pkgs.writeShellScript "shade-vm-bluetooth-peer-start" ''
    set -euo pipefail
    bluetoothctl=${bluezTesting}/bin/bluetoothctl
    controllers=()
    for _ in {1..30}; do
      mapfile -t controllers < <("$bluetoothctl" list | ${pkgs.gawk}/bin/awk '$1 == "Controller" { print $2 }')
      if [ "''${#controllers[@]}" -ge 2 ]; then
        break
      fi
      ${pkgs.coreutils}/bin/sleep 1
    done
    if [ "''${#controllers[@]}" -lt 2 ]; then
      echo "Expected two guest-local btvirt controllers" >&2
      exit 1
    fi

    peer="''${controllers[1]}"
    "$bluetoothctl" <<EOF
    select $peer
    power on
    system-alias ShadeVM-Peer
    pairable-timeout 0
    discoverable-timeout 0
    agent NoInputNoOutput
    default-agent
    pairable on
    discoverable on
    advertise peripheral
    EOF
  '';
  bluetoothPeerStop = pkgs.writeShellScript "shade-vm-bluetooth-peer-stop" ''
    set -u
    bluetoothctl=${bluezTesting}/bin/bluetoothctl
    controllers=()
    mapfile -t controllers < <("$bluetoothctl" list | ${pkgs.gawk}/bin/awk '$1 == "Controller" { print $2 }')

    for controller in "''${controllers[@]}"; do
      "$bluetoothctl" <<EOF || true
    select $controller
    scan off
    advertise off
    discoverable off
    pairable off
    EOF
    done

    for controller in "''${controllers[@]}"; do
      paired_devices=$("$bluetoothctl" <<EOF
    select $controller
    devices Paired
    EOF
    )
      while read -r kind address _; do
        if [ "$kind" = "Device" ] && [ -n "$address" ]; then
          "$bluetoothctl" <<EOF || true
    select $controller
    remove $address
    EOF
        fi
      done <<< "$paired_devices"
    done
    peer="''${controllers[1]:-}"
    if [ -n "$peer" ]; then
      "$bluetoothctl" <<EOF || true
    select $peer
    reset-alias
    EOF
    fi

    for controller in "''${controllers[@]}"; do
      "$bluetoothctl" <<EOF || true
    select $controller
    power off
    EOF
    done
  '';
  # The null sink exposes a guest-only .monitor source for generated signal capture; it is not a microphone.
  audioFixtureStart = pkgs.writeShellScript "shade-vm-audio-fixture-start" ''
    set -euo pipefail
    pactl=${pkgs.pulseaudio}/bin/pactl
    state="$XDG_RUNTIME_DIR/shade-vm-audio-fixture/module-id"
    module_id=
    cleanup() {
      if [ -n "$module_id" ]; then
        "$pactl" unload-module "$module_id" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup ERR
    module_id="$("$pactl" load-module module-null-sink sink_name=shade_vm_test_output rate=48000 channels=2)"
    if [[ ! "$module_id" =~ ^[0-9]+$ ]]; then
      echo "PipeWire did not return a null-sink module ID" >&2
      exit 1
    fi
    printf '%s\n' "$module_id" > "$state"
    trap - ERR
  '';
  audioFixtureStop = pkgs.writeShellScript "shade-vm-audio-fixture-stop" ''
    set -euo pipefail
    pactl=${pkgs.pulseaudio}/bin/pactl
    state="$XDG_RUNTIME_DIR/shade-vm-audio-fixture/module-id"
    if [ -s "$state" ]; then
      module_id="$(${pkgs.coreutils}/bin/cat "$state")"
      if [[ "$module_id" =~ ^[0-9]+$ ]]; then
        "$pactl" unload-module "$module_id" || true
      fi
      ${pkgs.coreutils}/bin/rm -f "$state"
    fi
  '';
  portalRequesterStop = pkgs.writeShellScript "shade-vm-portal-requester-stop" ''
    ${pkgs.systemd}/bin/systemctl --user stop \
      xdg-desktop-portal.service \
      xdg-desktop-portal-gtk.service || true
  '';
  secondaryDisplayStop = pkgs.writeShellScript "shade-vm-secondary-display-stop" ''
    ${pkgs.hyprland}/bin/hyprctl keyword monitor "Virtual-2, disable" || true
  '';
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
      # Keep the existing primary output as the sole active desktop until a test enables head 1.
      "-device virtio-vga,max_outputs=2"
      # USB tablet for proper cursor tracking
      "-usb"
      "-device usb-tablet"
      # QEMU's null backend provides a guest HDA input/output frontend without host audio I/O.
      "-audiodev none,id=guest-null"
      "-device intel-hda"
      "-device hda-duplex,audiodev=guest-null"
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
    before = [ "bluetooth.service" ];
    after = [ "systemd-modules-load.service" ];
    partOf = [ "shade-vm-bluetooth-fixture.target" ];
    serviceConfig = {
      Type = "simple";
      ExecStart = "${bluezTesting}/bin/btvirt -l2";
      Restart = "on-failure";
    };
  };

  systemd.services.shade-vm-bluetooth-peer = {
    description = "Guest-local pairable Bluetooth peer for Shade VM testing";
    requires = [
      "bluetooth.service"
      "shade-vm-btvirt.service"
    ];
    after = [
      "bluetooth.service"
      "shade-vm-btvirt.service"
    ];
    partOf = [ "shade-vm-bluetooth-fixture.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = bluetoothPeerStart;
      ExecStopPost = bluetoothPeerStop;
    };
  };

  systemd.targets.shade-vm-bluetooth-fixture = {
    description = "On-demand guest-local Bluetooth fixture";
    requires = [
      "shade-vm-btvirt.service"
      "shade-vm-bluetooth-peer.service"
    ];
    after = [
      "shade-vm-btvirt.service"
      "shade-vm-bluetooth-peer.service"
    ];
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
          "Virtual-2, disable"
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

  xdg.portal = {
    enable = true;
    extraPortals = [ pkgs.xdg-desktop-portal-gtk ];
    config.common.default = [ "gtk" ];
  };

  systemd.user.services.shade-vm-secondary-display = {
    description = "Enable the guest-only secondary display for a Shade workflow";
    after = [ "graphical-session.target" ];
    partOf = [ "graphical-session.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = "${pkgs.hyprland}/bin/hyprctl keyword monitor 'Virtual-2, preferred, auto, 1'";
      ExecStopPost = secondaryDisplayStop;
    };
  };

  # gtk4-demo's file chooser demo is the real GTK portal requester; tests invoke it through guest UI.
  systemd.user.services.shade-vm-portal-requester = {
    description = "GTK portal requester for Shade VM workflow testing";
    after = [
      "xdg-desktop-portal.service"
      "xdg-desktop-portal-gtk.service"
    ];
    partOf = [ "shade-vm-portal-fixture.target" ];
    serviceConfig = {
      Type = "simple";
      Environment = "GDK_DEBUG=portals";
      ExecStart = "${lib.getBin pkgs.gtk4}/bin/gtk4-demo";
      ExecStopPost = portalRequesterStop;
    };
  };

  systemd.user.targets.shade-vm-portal-fixture = {
    description = "On-demand guest portal and GTK requester fixture";
    requires = [
      "xdg-desktop-portal.service"
      "xdg-desktop-portal-gtk.service"
      "shade-vm-portal-requester.service"
    ];
    after = [
      "xdg-desktop-portal.service"
      "xdg-desktop-portal-gtk.service"
      "shade-vm-portal-requester.service"
    ];
  };

  systemd.user.services.shade-vm-audio-fixture = {
    description = "Guest-local PipeWire null output and monitor input fixture";
    requires = [ "pipewire-pulse.service" ];
    after = [ "pipewire-pulse.service" ];
    partOf = [ "graphical-session.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      RuntimeDirectory = "shade-vm-audio-fixture";
      RuntimeDirectoryMode = "0700";
      ExecStart = audioFixtureStart;
      ExecStopPost = audioFixtureStop;
    };
  };

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
    pulseaudio
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
