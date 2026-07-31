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

  entries = {
    "shade-shell" = "apps/shell/src/main.ts";
    "shade-shell-greet" = "apps/greeter/src/main.ts";
    "shade-shell-share-picker" = "apps/share-picker/src/main.ts";
  };

  # Build a define-flag pair with a JS-string-literal value for rolldown.
  # Example: mkDefine "import.meta.name" "shade-shell"
  #   produces: -d "import.meta.name=\"shade-shell\""
  mkDefine = key: value:
    "-d " + ''"${key}=\"${value}\""'';

  # Each entry gets a name define plus the common defines.
  mkEntryCommands = name: entry:
    ''
      echo "building ${name} from ${entry}"
      node "$PWD/node_modules/gnim/dist/bin/gnim.js" bundle "${entry}" \
        --id "${domain}" \
        ${mkDefine "import.meta.name" name} \
        ${mkDefine "import.meta.version" version} \
        ${mkDefine "import.meta.domain" domain} \
        ${mkDefine "import.meta.datadir" "$out/share"} \
        ${mkDefine "import.meta.bindir" "$out/bin"} \
        -o "${name}.gresource"
      node "$PWD/node_modules/gnim/dist/bin/gnim.js" exe "$out/share/${domain}/${name}.gresource" \
        -o "${name}" \
        --id "${domain}" --prefix "$out" --datadir share --libdir lib
    '';

  # Install commands for each entry.
  mkInstallCommands = name: _:
    ''
      install -Dm755 ${name} $out/bin/${name}
      install -Dm644 ${name}.gresource $out/share/${domain}/${name}.gresource
    '';
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
      hash = "sha256-sKXtz7JpWwPql1KT4MJjJuYWUXAsBtsRRFl6WG5GUuk=";
    };

    installPhase = ''
      mkdir -p $out
      cp -r . $out
    '';
  };

  buildPhase = ''
    runHook preBuild

    ${lib.concatStringsSep "\n" (lib.mapAttrsToList mkEntryCommands entries)}

    for dir in packages/core/src/settings packages/services/src/settings \
             packages/services/src/location packages/services/src/time; do
      node "$PWD/node_modules/gnim/dist/bin/gnim.js" schemas "$dir" \
        -o schema-out \
        ${mkDefine "import.meta.domain" domain} \
        ${mkDefine "import.meta.datadir" "$out/share"} \
        ${mkDefine "import.meta.bindir" "$out/bin"}
    done

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/share/applications $out/share/systemd/user \
      $out/share/polkit-1/actions $out/share/glib-2.0/schemas \
      $out/share/shade-shell

    ${lib.concatStringsSep "\n" (lib.mapAttrsToList mkInstallCommands entries)}

    install -Dm644 schema-out/*.gschema.xml \
      -t $out/share/glib-2.0/schemas/
    glib-compile-schemas $out/share/glib-2.0/schemas

    substitute data/desktop.in.desktop $out/share/applications/${domain}.desktop \
      --replace-fail '@name@' '${pname}settings' \
      --replace-fail '@comment@' 'open shade settings' \
      --replace-fail '@exe@' "$out/bin/${pname} toggle settings"

    install -Dm644 data/shade-shell/wp-day.jpg data/shade-shell/wp-night.jpg \
      -t $out/share/shade-shell

    mkdir -p $out/share/shade-shell/icons
    install -Dm644 assets/icons/*.svg -t $out/share/shade-shell/icons

    substitute data/shade-shell.service.in $out/share/systemd/user/shade-shell.service \
      --replace-fail '@wrapper_bin@' "$out/bin"

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
    )
  '';

  meta = {
    mainProgram = pname;
    description = "Shade — Skill's Hyprland Adwaita Desktop Environment";
    homepage = "https://github.com/caioasmuniz/shade";
    license = lib.licenses.gpl3Only;
    platforms = lib.platforms.linux;
    maintainers = [ ];
  };
}
