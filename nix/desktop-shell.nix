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
  version = (lib.importJSON ../package.json).version;
  domain = "com.caioasmuniz.shade_shell";
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

  # Entry points: <attr> = { entry, extra esbuild args }
  apps = {
    "shade-shell" = "src/apps/shell/main.ts";
    "shade-shell-greet" = "src/apps/greeter/main.ts";
    "shade-shell-share-picker" = "src/apps/share-picker/main.ts";
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
      pnpm_10
    ];

    CI = "true";

    pnpmDeps = fetchPnpmDeps {
      inherit pname version src;
      pnpm = pkgs.pnpm_10;
      fetcherVersion = 4;
      hash = "sha256-1Rzb3A0JzbceD8ly8hUojMJc/kk/nb7tIK4ynDW9fvQ=";
    };

    installPhase = ''
      mkdir -p $out
      cp -r . $out
    '';
  };

  buildPhase = ''
    runHook preBuild

    commonArgs=(
      --source-root "$PWD"
      --external 'gi://*'
      --external 'resource://*'
      --external system
      --external gettext
      --format esm
      --loader .css=text
      --banner '#!${pkgs.gjs}/bin/gjs -m'
      --define import.meta.version '${version}'
      --define import.meta.domain '${domain}'
      --define import.meta.datadir "$out/share"
      --define import.meta.bindir "$out/bin"
    )

    ${lib.concatStringsSep "\n" (lib.mapAttrsToList (name: entry: ''
      node tools/build.mjs ${entry} ${name} \
        --define import.meta.name '${name}' \
        "''${commonArgs[@]}"
    '') apps)}

    # GSettings schema (gnim-schemas cli bundles the .ts with esbuild and
    # validates with xmllint — esbuild/libxml2 are in nativeBuildInputs)
    mkdir schema-out
    sed -e 's|@domain@|${domain}|g' \
        -e "s|@datadir@|$out/share|g" \
        src/lib/settings/schema.ts > schema-out/${domain}.gschema.ts
    gjs -m node_modules/gnim-schemas/lib/cli.js schema-out --targetdir schema-out

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/share/applications $out/share/systemd/user \
      $out/share/polkit-1/actions $out/share/glib-2.0/schemas \
      $out/share/shade-shell

    # App binaries
    ${lib.concatStringsSep "\n" (lib.mapAttrsToList (name: _: ''
      install -Dm755 ${name} $out/bin/${name}
    '') apps)}

    # GSettings schema
    install -Dm644 schema-out/${domain}.gschema.xml \
      $out/share/glib-2.0/schemas/${domain}.gschema.xml
    glib-compile-schemas $out/share/glib-2.0/schemas

    # Desktop entry (opens shade settings)
    substitute data/desktop.in.desktop $out/share/applications/${domain}.desktop \
      --replace-fail '@name@' '${pname}settings' \
      --replace-fail '@comment@' 'open shade settings' \
      --replace-fail '@exe@' "$out/bin/${pname} toggle settings"

    # Wallpapers
    install -Dm644 data/wp-day.jpg data/wp-night.jpg \
      -t $out/share/shade-shell

    # systemd user service for non-NixOS users (NixOS module uses its own)
    substitute data/shade-shell.service.in $out/share/systemd/user/shade-shell.service \
      --replace-fail '@wrapper_bin@' "$out/bin"

    # pkexec helper + polkit action for battery conservation.
    # patchShebangs (fixup) rewrites the helper's /usr/bin/env shebang.
    install -Dm755 data/shade-conservation-toggle \
      $out/bin/shade-conservation-toggle

    substitute data/org.shade-shell.policy.in \
      $out/share/polkit-1/actions/org.shade-shell.policy \
      --subst-var-by bindir $out/bin

    runHook postInstall
  '';

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
