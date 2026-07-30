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

    # glib-networking's GIO module dir is not propagated into the dev shell
    # environment, which leaves libsoup without a TLS backend and breaks
    # HTTPS requests (e.g. GWeather's met.no provider) in dev mode.
    shellHook = ''
      export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules''${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}"
    '';

    packages =
      nativeBuildInputs
      ++ buildInputs
      ++ wrapperPackages
      ++ (with pkgs; [
        libnotify
        pnpm_10
        nixd
        nixfmt-rfc-style
        nix-output-monitor
        d-spy
        graphviz          # dot, for scripts/deps-graph.sh rendering
        python3
        python3Packages.vncdo
        python3Packages.mcp
        openssh # ssh client for VM D-Bus testing
        sshpass # password auth for local VM SSH
        adwaita-icon-theme
      ]);
  };
}
