{
  pkgs,
  buildInputs,
  nativeBuildInputs,
  wrapperPackages,
  ...
}:
{
  default = pkgs.mkShell {
    LD_PRELOAD = "${pkgs.gtk4-layer-shell}/lib/libgtk4-layer-shell.so";
    packages =
      nativeBuildInputs
      ++ buildInputs
      ++ wrapperPackages
      ++ (with pkgs; [
        libnotify
        pnpm
        nixd
        nixfmt-rfc-style
        nix-output-monitor
        d-spy
        python3
        python3Packages.vncdo
        python3Packages.mcp
        openssh # ssh client for VM D-Bus testing
        sshpass # password auth for local VM SSH
      ]);
  };
}
