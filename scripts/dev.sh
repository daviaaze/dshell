#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$PWD/node_modules/.bin:$PATH"

nix develop -c gnim dev apps/shell/src/main.ts \
  -d 'import.meta.domain="com.caioasmuniz.shade_shell"' \
  -d 'import.meta.name="shade-shell"' \
  -d 'import.meta.version="0.2.1"' \
  -d 'import.meta.datadir="'"$PWD/data"'"' \
  -d 'import.meta.bindir="/usr/local/bin"'
