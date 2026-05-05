{
  description = "Shade - Skill's Hyprland Adwaita Desktop Environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    astal.url = "github:aylur/astal";
    hyprland.url = "github:hyprwm/Hyprland";
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
        notifd
        powerprofiles
        tray
        wireplumber
        astal4
        cava
      ];

      nativeBuildInputs = with pkgs; [
        wrapGAppsHook4
        gobject-introspection
        meson
        pkg-config
        ninja
        desktop-file-utils
        libxml2
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
          esbuild
          nodejs
        ]
        ++ astalPackages;

      wrapperPackages = with pkgs; [
        hyprland
        brightnessctl
        bash
        curl
        grim
        slurp
        wf-recorder
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
          ./nix/vm.nix
          self.nixosModules.default
        ];
      };

      nixosConfigurations.vm-vnc = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          ./nix/vm-vnc.nix
          self.nixosModules.default
        ];
      };
    };
}
