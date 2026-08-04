#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$PWD/node_modules/.bin:$PATH"
export XDG_DATA_DIRS="$PWD/data:${XDG_DATA_DIRS:-}"
export GDK_BACKEND="${GDK_BACKEND:-wayland}"

DOMAIN="com.caioasmuniz.shade_shell"
NAME="shade-shell"
VERSION="0.2.1"
DATADIR="$PWD/data"
BINDIR="/usr/local/bin"

if [[ -n "${IN_NIX_SHELL:-}" ]]; then
    echo "[dev] Running gnim dev directly (inside nix shell)"
else
    echo "[dev] Entering nix develop --impure for deps"
    exec nix develop --impure -c "$0" "$@"
fi

GNIM="node_modules/.bin/gnim"

# Generate required gschema.xml files before running dev server
mkdir -p data/glib-2.0/schemas
for dir in packages/core/src/settings packages/services/src/settings \
         packages/services/src/location packages/services/src/time; do
  $GNIM schemas "$dir" -o data/glib-2.0/schemas \
    -d "import.meta.domain=\"$DOMAIN\"" \
    -d "import.meta.datadir=\"$DATADIR\"" \
    -d "import.meta.bindir=\"$BINDIR\""
done
glib-compile-schemas data/glib-2.0/schemas

# Run gnim dev server (HMR enabled)
$GNIM dev apps/shell/src/main.ts \
  -d "import.meta.domain=\"$DOMAIN\"" \
  -d "import.meta.name=\"$NAME\"" \
  -d "import.meta.version=\"$VERSION\"" \
  -d "import.meta.datadir=\"$DATADIR\"" \
  -d "import.meta.bindir=\"$BINDIR\"

"
