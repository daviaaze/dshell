{
  description = "Shade - Skill's Hyprland Adwaita Desktop Environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    astal = {
      url = "github:aylur/astal";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    hyprland = {
      url = "github:hyprwm/Hyprland";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      astal,
      ...
    }@inputs:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      astalPackages = with astal.packages.${system}; [
        apps
        auth
        battery
        bluetooth
        astal.packages.${system}.hyprland
        mpris
        network
        (notifd.overrideAttrs (old: {
          postPatch = (old.postPatch or "") + ''
            sed -i 's/, -1,/, 1000,/' src/proxy.vala
            sed -i '/proxy = Bus.get_proxy_sync/,/);/{
              /);/a\        proxy.g_default_timeout = 1000;
            }' src/proxy.vala
          '';
        }))
        powerprofiles
        tray
        wireplumber
        astal4
      ];

      nativeBuildInputs = with pkgs; [
        wrapGAppsHook4
        gobject-introspection
        meson
        pkg-config
        ninja
        desktop-file-utils
        libxml2
        esbuild
        nodejs
      ];

      buildInputs =
        with pkgs;
        [
          gsettings-desktop-schemas
          glib
          libadwaita
          libgtop
          libgweather
          libglycin-gtk4
          glycin-loaders
          glib-networking
          gtk4
          gtk4-layer-shell
          gjs
        ]
        ++ astalPackages;

      wrapperPackages = with pkgs; [
        hyprland
        brightnessctl
        bash
        curl
        grim
        wl-screenrec
        wf-recorder
        wayfreeze
        wl-clipboard
        cliphist
        hyprsunset
        hypridle
        matugen
        glib.bin
        uwsm
        pipewire
      ];
    in
    {
      packages.${system} = {
        default = import ./nix/desktop-shell.nix {
          inherit
            pkgs
            buildInputs
            nativeBuildInputs
            wrapperPackages
            ;
          inherit (pkgs) pnpmConfigHook fetchPnpmDeps;
          lib = pkgs.lib;
        };
      };

      nixosModules.default = import ./nix/module.nix inputs;
      homeManagerModules.default = import ./nix/home inputs;

      devShells.${system} = import ./nix/devshell.nix {
        inherit
          pkgs
          buildInputs
          nativeBuildInputs
          wrapperPackages
          ;
      };
      nixosConfigurations.vm = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          self.nixosModules.default
        ];
      };

      nixosConfigurations.vm-vnc = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          self.nixosModules.default
        ];
      };
    };
}
