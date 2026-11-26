#!/usr/bin/env bash
# Runs every GJS test suite through gnim's bundler.
#
# Tests MUST go through gnim (rolldown) — not esbuild — because gnim's
# @property/@signal decorators rely on decorator metadata that esbuild
# does not emit (registration throws "missing property type declaration").
#
# gnim's launcher exits 0 when its native CLI dies from a signal or cannot be
# spawned, so an exit status alone proves nothing: every step is also checked
# by what it produced (schema files, the runner's "N/M passed" line).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
export PATH="$PWD/node_modules/.bin:$PATH"

die() {
    echo "FAIL: $*" >&2
    exit 1
}

# Compile only this run's schemas and never write test preferences to user dconf.
schema_dir=$(mktemp -d "${TMPDIR:-/tmp}/shade-test-schemas.XXXXXX") || die "cannot create the schema directory"
output_log=$(mktemp "${TMPDIR:-/tmp}/shade-test-output.XXXXXX") || die "cannot create the output log"
trap 'rm -rf "$schema_dir" "$output_log"' EXIT
export XDG_DATA_HOME="$schema_dir/data"
cat > "$schema_dir/shade-clipboard-crypto" <<'EOF' || die "cannot write the clipboard test helper"
#!/usr/bin/env bash
exec python3 packages/services/src/clipboard/cryptoWorker.py "$@"
EOF
chmod +x "$schema_dir/shade-clipboard-crypto" || die "cannot make the clipboard test helper executable"
defines=(-d 'import.meta.domain="com.caioasmuniz.shade_shell"'
         -d 'import.meta.datadir="/tmp"' -d "import.meta.bindir=\"$schema_dir\"")
schema_count() { find "$schema_dir" -name '*.gschema.xml' | wc -l; }
for dir in packages/core/src/settings packages/services/src/settings \
           packages/services/src/location packages/services/src/time; do
    before=$(schema_count)
    gnim schemas "$dir" -o "$schema_dir" "${defines[@]}" || die "gnim schemas failed for $dir"
    [ "$(schema_count)" -gt "$before" ] || die "gnim schemas wrote no schema for $dir"
done
glib-compile-schemas "$schema_dir" || die "glib-compile-schemas failed"
[ -s "$schema_dir/gschemas.compiled" ] || die "glib-compile-schemas produced no gschemas.compiled"
export GSETTINGS_SCHEMA_DIR="$schema_dir" GSETTINGS_BACKEND=memory SHADE_TEST_SCHEMA_DIR="$schema_dir"
# gnim run prepends the checkout's cached .gnim/schemas. Restore fresh-first
# lookup inside GJS before importing a suite, without touching that shared cache.
cat > "$schema_dir/test-environment.ts" <<'EOF' || die "cannot write the schema test bootstrap"
import GLib from 'gi://GLib?version=2.0';
const fresh = GLib.getenv('SHADE_TEST_SCHEMA_DIR')!;
const inherited = GLib.getenv('GSETTINGS_SCHEMA_DIR')!;
GLib.setenv('GSETTINGS_SCHEMA_DIR', `${fresh}:${inherited}`, true);
EOF

# Explicit paths run only the requested regression suites.
if [ "$#" -gt 0 ]; then
    tests=("$@")
else
    mapfile -t tests < <(find packages apps -path '*/__tests__/*.test.ts' \
        -not -path '*/node_modules/*' -not -name 'all.test.ts' | sort)
fi
[ "${#tests[@]}" -gt 0 ] || die "no test files found under packages/ or apps/"

failed=()
for t in "${tests[@]}"; do
    echo "=== $(basename "$t") ==="
    test_entry=$(node -p 'JSON.stringify(require("node:path").resolve(process.argv[1]))' "$t") \
        || die "cannot resolve test entry $t"
    printf 'import "./test-environment.ts";\nimport %s;\n' "$test_entry" \
        > "$schema_dir/test-entry.ts" || die "cannot write test entry $t"
    gnim run "$schema_dir/test-entry.ts" "${defines[@]}" | tee "$output_log"
    status=${PIPESTATUS[0]}
    # The runner's last line is "N/M passed" (packages/core/src/__tests__/test-runner.ts).
    summary=$(grep -E '^[0-9]+/[0-9]+ passed' "$output_log" | tail -n 1)
    reason=""
    if [[ ! $summary =~ ^([0-9]+)/([0-9]+)\ passed ]]; then
        reason="no 'N/M passed' summary (crash, or the runner never ran)"
    elif [ "${BASH_REMATCH[2]}" -eq 0 ]; then
        reason="zero tests ran"
    elif [ "${BASH_REMATCH[1]}" -ne "${BASH_REMATCH[2]}" ]; then
        reason="$summary"
    elif [ "$status" -ne 0 ]; then
        reason="exit status $status"
    fi
    if [ -n "$reason" ]; then
        echo "FAIL: $t: $reason" >&2
        failed+=("$t")
    fi
    echo
done

if [ "${#failed[@]}" -ne 0 ]; then
    echo "=== ${#failed[@]} of ${#tests[@]} test suites FAILED ==="
    printf '  %s\n' "${failed[@]}"
    exit 1
fi
echo "=== All ${#tests[@]} test suites passed ==="
