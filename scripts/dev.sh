#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$PWD/node_modules/.bin:$PATH"

DOMAIN="com.caioasmuniz.shade_shell"
NAME="shade-shell"
VERSION="0.2.1"
DATADIR="$PWD/data"
BINDIR="/usr/local/bin"

# Generate required gschema.xml files before running dev server
nix develop -c bash -c "
  for dir in packages/core/src/settings packages/services/src/settings \
           packages/services/src/location packages/services/src/time; do
    node_modules/.bin/gnim schemas \"\$dir\" -o schema-out \\
      -d import.meta.domain=$DOMAIN \\
      -d import.meta.datadir=$DATADIR \\
      -d import.meta.bindir=$BINDIR
  done
"

nix develop -c bash -c "
  node_modules/.bin/gnim dev apps/shell/src/main.ts \\
    -d import.meta.domain=$DOMAIN \\
    -d import.meta.name=$NAME \\
    -d import.meta.version=$VERSION \\
    -d import.meta.datadir=$DATADIR \\
    -d import.meta.bindir=$BINDIR
"
