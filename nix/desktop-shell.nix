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

  # pkexec helper script for battery conservation (polkit privilege escalation)
  conservationToggle = pkgs.writeShellScript "shade-conservation-toggle" ''
    PATH="${pkgs.coreutils}/bin:/bin:/usr/bin"
    if [ -z "$1" ] || [ "$1" != "0" ] && [ "$1" != "1" ]; then
      echo "Usage: $0 <0|1>" >&2
      exit 1
    fi
    SYSFS="/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode"
    if [ ! -f "$SYSFS" ]; then
      echo "conservation mode sysfs file not found: $SYSFS" >&2
      exit 1
    fi
    printf '%s' "$1" > "$SYSFS"
    echo "$1"
  '';

  # Polkit action definition for battery conservation
  # @helperPath@ is substituted during postInstall
  polkitAction = pkgs.writeText "org.shade-shell.policy" ''
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE policyconfig PUBLIC
     "-//freedesktop//DTD PolicyKit Policy Configuration 1//EN"
     "http://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
    <policyconfig>
      <vendor>Shade Shell</vendor>
      <vendor_url>https://github.com/caioasmuniz/shade</vendor_url>
      <action id="org.shade-shell.battery-conservation">
        <_description>Toggle battery conservation mode</_description>
        <_message>Authentication is required to toggle battery conservation mode (write to sysfs).</_message>
        <defaults>
          <allow_any>auth_admin</allow_any>
          <allow_inactive>auth_admin</allow_inactive>
          <allow_active>auth_admin</allow_active>
        </defaults>
        <annotate key="org.freedesktop.policykit.exec.path">@helperPath@</annotate>
      </action>
    </policyconfig>
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
      hash = "sha256-1Rzb3A0JzbceD8ly8hUojMJc/kk/nb7tIK4ynDW9fvQ=";
    };

    installPhase = ''
      mkdir -p $out
      cp -r . $out
    '';
  };

  postInstall = ''
    # Install pkexec helper script for battery conservation
    install -Dm755 ${conservationToggle} $out/bin/shade-conservation-toggle

    # Install polkit action definition with correct helper path
    mkdir -p $out/share/polkit-1/actions
    cp ${polkitAction} $out/share/polkit-1/actions/org.shade-shell.policy
    substituteInPlace $out/share/polkit-1/actions/org.shade-shell.policy \
      --subst-var-by helperPath $out/bin/shade-conservation-toggle
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