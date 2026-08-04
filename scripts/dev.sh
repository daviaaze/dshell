#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$PWD/node_modules/.bin:$PATH"

DOMAIN="com.caioasmuniz.shade_shell"
NAME="shade-shell"
VERSION="0.2.1"
DATADIR="$PWD/data"
BINDIR="/usr/local/bin"

if [[ -n "${IN_NIX_SHELL:-}" ]]; then
    echo "[dev] Already in nix shell, skipping nested nix develop"
    NIX_CMD=("${@}")
else
    NIX_CMD=(nix develop --impure -c "$@")
fi

# Generate required gschema.xml files before running dev server
"${NIX_CMD[@]}" bash -c "
  mkdir -p data/glib-2.0/schemas
  export XDG_DATA_DIRS=\"\$PWD/data:\$XDG_DATA_DIRS\"
  for dir in packages/core/src/settings packages/services/src/settings \
           packages/services/src/location packages/services/src/time; do
    node_modules/.bin/gnim schemas \"\$dir\" -o data/glib-2.0/schemas \\
      -d \"import.meta.domain=\\\"\$DOMAIN\\\"\" \\
      -d \"import.meta.datadir=\\\"\$DATADIR\\\"\" \\
      -d \"import.meta.bindir=\\\"\$BINDIR\\\"\"
  done
  glib-compile-schemas data/glib-2.0/schemas
"

"${NIX_CMD[@]}" bash -c "
  export XDG_DATA_DIRS=\"\$PWD/data:\$XDG_DATA_DIRS\"
  export GDK_BACKEND=\"${GDK_BACKEND:-wayland}\"
  node_modules/.bin/gnim dev apps/shell/src/main.ts \\
    -d \"import.meta.domain=\\\"\$DOMAIN\\\"\" \\
    -d \"import.meta.name=\\\"\$NAME\\\"\" \\
    -d \"import.meta.version=\\\"\$VERSION\\\"\" \\
    -d \"import.meta.datadir=\\\"\$DATADIR\\\"\" \\
    -d \"import.meta.bindir=\\\"\$BINDIR\\\"\"
"
