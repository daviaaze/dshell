{
  lib,
  pkgs,
  buildInputs,
  nativeBuildInputs,
  wrapperPackages,
  pnpmConfigHook,
  fetchPnpmDeps,
  ...
}:
let
  pname = "shade-shell";
  version = "0.2.1";
  src = lib.cleanSourceWith {
    filter = path: type:
      let
        base = baseNameOf path;
      in
        ! (
          lib.hasSuffix "~" base
          || lib.hasSuffix ".o" base
          || lib.hasSuffix ".so" base
          || lib.hasSuffix ".qcow2" base
          || base == ".git"
          || base == "CVS"
          || base == ".svn"
          || base == ".hg"
          || base == ".DS_Store"
          || base == "__pycache__"
          || base == "node_modules"
          || base == "build"
          || base == "dist"
          || base == "@girs"
          || base == ".direnv"
          || base == "test-output"
          || base == "result"
          || lib.hasPrefix "result-" base
        );
    src = ../.;
  };
in
pkgs.stdenv.mkDerivation {
  inherit
    pname
    version
    buildInputs
    nativeBuildInputs
    ;
  src = pkgs.stdenv.mkDerivation {
    inherit src pname version;
    nativeBuildInputs = with pkgs; [
      pnpmConfigHook
      pnpm
    ];

    CI = "true";

    pnpmDeps = fetchPnpmDeps {
      inherit pname version src;
      fetcherVersion = 3;
      hash = "sha256-w3aLd1rXhp3sJnuEVLEMlIe9eltOsFzMCbk2NrF/ijE=";
    };

    installPhase = ''
      mkdir -p $out
      cp -r . $out
    '';
  };

  preFixup = ''
    gappsWrapperArgs+=(
      --prefix XDG_DATA_DIRS : "${pkgs.glycin-loaders}/share"
      --prefix PATH : ${pkgs.lib.makeBinPath wrapperPackages}
      --prefix LD_PRELOAD : 
      "${pkgs.gtk4-layer-shell}/lib/libgtk4-layer-shell.so"
      )'';

  meta = {
    mainProgram = pname;
    description = "Shade — Skill's Hyprland Adwaita Desktop Environment";
    homepage = "https://github.com/caioasmuniz/shade";
    license = lib.licenses.gpl3Only;
    platforms = lib.platforms.linux;
    maintainers = [ ];
  };
}
