#!/usr/bin/env bash
# Runs every GJS test suite through gnim's bundler.
#
# Tests MUST go through gnim (rolldown) — not esbuild — because gnim's
# @property/@signal decorators rely on decorator metadata that esbuild
# does not emit (registration throws "missing property type declaration").
set -uo pipefail

cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"

# Compile only this run's schemas and never write test preferences to user dconf.
schema_dir=$(mktemp -d "${TMPDIR:-/tmp}/shade-test-schemas.XXXXXX")
trap 'rm -rf "$schema_dir"' EXIT
defines=(-d 'import.meta.domain="com.caioasmuniz.shade_shell"'
         -d 'import.meta.datadir="/tmp"' -d 'import.meta.bindir="/tmp"')
for dir in packages/core/src/settings packages/services/src/settings \
           packages/services/src/location packages/services/src/time; do
    gnim schemas "$dir" -o "$schema_dir" "${defines[@]}"
done
glib-compile-schemas "$schema_dir"
export GSETTINGS_SCHEMA_DIR="$schema_dir" GSETTINGS_BACKEND=memory

failed=0
# Find all test files across the monorepo
for t in $(find packages apps -path '*/__tests__/*.test.ts' -not -path '*/node_modules/*' | sort); do
    name=$(basename "$t")
    [ "$name" = "all.test.ts" ] && continue
    echo "=== $name ==="
    if ! gnim run "$t" "${defines[@]}"; then
        failed=1
    fi
    echo
done

if [ $failed -ne 0 ]; then
    echo "=== Some test suites FAILED ==="
    exit 1
fi
echo "=== All test suites passed ==="
