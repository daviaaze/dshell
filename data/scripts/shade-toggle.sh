#!/bin/sh
# Lightweight D-Bus command dispatcher for shade-shell
# Usage: shade-toggle applauncher|quicksettings|bar|windowswitcher|settings

# Resolve gdbus path — try common locations
for gdbus in \
  /nix/store/*glib*/bin/gdbus \
  /usr/bin/gdbus \
  /usr/local/bin/gdbus; do
  if [ -x "$gdbus" ]; then
    exec "$gdbus" call --session \
      --dest com.caioasmuniz.shade_shell \
      --object-path /com/caioasmuniz/shade_shell \
      --method org.gtk.Application.CommandLine \
      /com/caioasmuniz/shade_shell \
      "[b'shade-shell', b'toggle', b'$1']" \
      "{}" >/dev/null 2>&1
  fi
done

# Fallback: try PATH
exec gdbus call --session \
  --dest com.caioasmuniz.shade_shell \
  --object-path /com/caioasmuniz/shade_shell \
  --method org.gtk.Application.CommandLine \
  /com/caioasmuniz/shade_shell \
  "[b'shade-shell', b'toggle', b'$1']" \
  "{}" >/dev/null 2>&1
