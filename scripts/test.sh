#!/usr/bin/env bash
# Runs every GJS test suite through gnim's bundler.
#
# Tests MUST go through gnim (rolldown) — not esbuild — because gnim's
# @property/@signal decorators rely on decorator metadata that esbuild
# does not emit (registration throws "missing property type declaration").
set -uo pipefail

cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"

failed=0
# Find all test files across the monorepo
for t in $(find packages apps -path '*/__tests__/*.test.ts' -not -path '*/node_modules/*' | sort); do
    name=$(basename "$t")
    [ "$name" = "all.test.ts" ] && continue
    echo "=== $name ==="
    if ! gnim run "$t"; then
        failed=1
    fi
    echo
done

if [ $failed -ne 0 ]; then
    echo "=== Some test suites FAILED ==="
    exit 1
fi
echo "=== All test suites passed ==="
