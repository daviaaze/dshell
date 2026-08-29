#!/usr/bin/env bash
# Launch a shade shell instance with the GTK Inspector attached.
#
# GTK_DEBUG=interactive opens the GtkInspector window next to the app, giving
# live access to: the widget tree, CSS node styles (resolved values + which
# provider set them), CSS classes, and a live CSS editor. This is the fastest
# way to answer "why is this widget styled wrong" — no guessing.
#
# Usage:
#   scripts/ui-inspect.sh [app-entry]     # default: apps/shell/src/main.ts
#
# Notes:
# - Stops the installed shade-shell.service first (bus name conflict), and
#   restarts it on exit.
# - The inspector opens on the app; interact with it via mouse/keyboard.
set -uo pipefail
cd "$(dirname "$0")/.."

ENTRY="${1:-apps/shell/src/main.ts}"
SERVICE_WAS_ACTIVE=$(systemctl --user is-active shade-shell.service 2>/dev/null || true)

restore() {
  if [ "$SERVICE_WAS_ACTIVE" = "active" ]; then
    echo "[ui-inspect] restarting installed shade-shell.service"
    systemctl --user start shade-shell.service
  fi
}
trap restore EXIT

if [ "$SERVICE_WAS_ACTIVE" = "active" ]; then
  echo "[ui-inspect] stopping installed shade-shell.service"
  systemctl --user stop shade-shell.service
  sleep 1
fi

echo "[ui-inspect] launching $ENTRY with GTK_DEBUG=interactive"
echo "[ui-inspect] Ctrl+C in this terminal closes the app and restores the service."
if [ -n "${IN_NIX_SHELL:-}" ]; then
  GTK_DEBUG=interactive node_modules/.bin/gnim dev "$ENTRY" \
    -d "import.meta.domain=\"com.caioasmuniz.shade_shell\"" \
    -d "import.meta.name=\"shade-shell\"" \
    -d "import.meta.version=\"0.2.1\"" \
    -d "import.meta.datadir=\"$PWD/data\"" \
    -d "import.meta.bindir=\"/usr/local/bin\""
else
  GTK_DEBUG=interactive nix develop --impure -c bash -c '
    export PATH="$PWD/node_modules/.bin:$PATH"
    export XDG_DATA_DIRS="$PWD/data:${XDG_DATA_DIRS:-}"
    gnim dev "'"$ENTRY"'" \
      -d "import.meta.domain=\"com.caioasmuniz.shade_shell\"" \
      -d "import.meta.name=\"shade-shell\"" \
      -d "import.meta.version=\"0.2.1\"" \
      -d "import.meta.datadir=\"$PWD/data\"" \
      -d "import.meta.bindir=\"/usr/local/bin\""
  '
fi
