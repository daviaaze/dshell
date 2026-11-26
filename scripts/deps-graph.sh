#!/usr/bin/env bash
# Generate the module dependency graph and enforce the circular-dependency gate.
#
# Outputs (in $OUT_DIR, default docs/deps/):
#   deps.json       - madge raw graph
#   deps.dot        - Graphviz directedd graph, folder-aggregated
#   deps.svg/.png   - rendered graph (only if `dot` is on PATH)
#
# Gate: fails (exit 1) if circular deps exceed the baseline in
# docs/deps/cycle-baseline (read from there whatever $OUT_DIR is), if madge
# fails, or if the baseline is missing or not a number. Lower the baseline as
# cycles are removed in Phases 2-3; adding a new cycle always fails.
set -euo pipefail

cd "$(dirname "$0")/.."

ROOT="$(pwd)"
SRC="$ROOT/src"
OUT_DIR="${OUT_DIR:-$ROOT/docs/deps}"
mkdir -p "$OUT_DIR"

MADGE=(npx --yes madge@8.0.0)
SHELL_ENTRY="apps/shell/src/main.ts"
COMPOSITOR_ENTRY="apps/shell/src/compositor.ts"
GREETER_ENTRY="apps/greeter/src/main.ts"
SHAREPICKER_ENTRY="apps/share-picker/src/main.ts"

echo "==> Finding files & building graph (madge)"
"${MADGE[@]}" --json \
    --ts-config tsconfig.json \
    "$SHELL_ENTRY" "$COMPOSITOR_ENTRY" "$GREETER_ENTRY" "$SHAREPICKER_ENTRY" \
    > "$OUT_DIR/deps.json"

echo "==> Aggregating to folders & writing deps.dot"
JSON_PATH="$OUT_DIR/deps.json" OUT_DOT="$OUT_DIR/deps.dot" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { JSON_PATH, OUT_DOT } = process.env;
const graph = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

// Keys are relative to apps/ (madge's common ancestor of the entries),
// so packages/ files get a ../ prefix.
function normalize(file) {
    // Strip leading ../ so paths start cleanly
    const cleaned = file.replace(/^\.\.\//, '');
    return cleaned.replace(/\.\w+$/, '');
}
function bucket(file) {
    const p = normalize(file).split('/');
    // Skip gnim/third-party type files
    if (p[0] === '.gnim') return null;
    // packages/<name>/src/<subpath>
    if (p[0] === 'packages') {
        if (p.length < 4) return p[1];                         // packages/<name>
        if (p[2] !== 'src') return `${p[1]}`;                    // unexpected path
        if (p.length === 4) return p[1];                         // packages/<name>/src/<file> → <name>
        return `${p[1]}/${p[3]}`;                                // packages/<name>/src/<sub>/... → <name>/<sub>
    }
    // apps/<name>/src/<subpath> → apps/<name>
    if (p[0] === 'apps')
        return p.length > 1 ? `apps/${p[1]}` : 'apps';
    return p.length > 2 ? `${p[0]}/${p[1]}` : p[0];
}

const edges = new Map();
for (const [file, deps] of Object.entries(graph)) {
    const from = bucket(file);
    if (!from) continue;
    for (const dep of deps) {
        const to = bucket(dep);
        if (!to || from === to) continue;
        const key = `${from}\t${to}`;
        edges.set(key, (edges.get(key) || 0) + 1);
    }
}

const nodes = new Set();
const L = ['digraph deps {', '  rankdir=LR;', '  bgcolor="transparent";',
    '  node [shape=box, style="filled,rounded", fontname="Helvetica", fontsize=11, fontcolor="#cdd6f4", color="#585b70", fillcolor="#313244"];',
    '  edge [color="#7f849c", fontname="Helvetica", fontsize=9, fontcolor="#a6adc8"];'];
for (const [key, count] of [...edges.entries()].sort()) {
    const [from, to] = key.split('\t');
    nodes.add(from); nodes.add(to);
    const w = Math.min(1 + Math.log2(count), 6);
    L.push(`  "${from}" -> "${to}" [penwidth=${w.toFixed(1)}, label="${count}"];`);
}
const fill = { apps: '#585b70', core: '#313244', services: '#45475a', widgets: '#fab387', style: '#b4befe' };
for (const n of nodes)
    L.push(`  "${n}" [fillcolor="${fill[n.split('/')[0]] || '#313244'}"];`);
L.push('}');
fs.writeFileSync(OUT_DOT, L.join('\n') + '\n');
console.log(`nodes: ${nodes.size}, edges: ${edges.size}`);
NODE

if command -v dot >/dev/null 2>&1; then
    echo "==> Rendering SVG & PNG"
    dot -Tsvg "$OUT_DIR/deps.dot" -o "$OUT_DIR/deps.svg"
    dot -Tpng "$OUT_DIR/deps.dot" -o "$OUT_DIR/deps.png"
    echo "    $OUT_DIR/deps.svg"
    echo "    $OUT_DIR/deps.png"
else
    echo "==> graphviz 'dot' not found — skipped rendering (deps.dot still written)"
fi

echo "==> Circular-dependency gate"
BASELINE_FILE="$ROOT/docs/deps/cycle-baseline"
if [ ! -f "$BASELINE_FILE" ]; then
    echo "✖ FAIL: missing cycle baseline $BASELINE_FILE" >&2
    exit 1
fi
BASELINE="$(tr -d '[:space:]' < "$BASELINE_FILE")"
if [[ ! $BASELINE =~ ^[0-9]+$ ]]; then
    echo "✖ FAIL: $BASELINE_FILE must hold a non-negative integer, got '$BASELINE'" >&2
    exit 1
fi

# madge exits 1 both for "cycles found" and for a crash, so its status alone
# cannot tell them apart: the cycle list is read as JSON, and anything that is
# not a JSON array of cycles fails the gate. stderr stays on the terminal.
madge_status=0
CYCLE_JSON="$("${MADGE[@]}" --circular --json --no-spinner \
    --ts-config tsconfig.json \
    "$SHELL_ENTRY" "$COMPOSITOR_ENTRY" "$GREETER_ENTRY" "$SHAREPICKER_ENTRY")" || madge_status=$?
CYCLE_COUNT="$(printf '%s' "$CYCLE_JSON" | node -e '
const cycles = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!Array.isArray(cycles) || !cycles.every(Array.isArray)) process.exit(1);
console.log(cycles.length);
')" || {
    echo "✖ FAIL: madge produced no cycle report (exit $madge_status)" >&2
    printf '%s\n' "$CYCLE_JSON" >&2
    exit 1
}
if [ "$madge_status" -ne 0 ] && [ "$CYCLE_COUNT" -eq 0 ]; then
    echo "✖ FAIL: madge exited $madge_status without reporting a cycle" >&2
    exit 1
fi

echo "    cycles found: $CYCLE_COUNT  (baseline: $BASELINE)"

if [ "$CYCLE_COUNT" -gt "$BASELINE" ]; then
    echo "✖ FAIL: $CYCLE_COUNT cycles exceed baseline $BASELINE"
    printf '%s' "$CYCLE_JSON" | node -e '
JSON.parse(require("node:fs").readFileSync(0, "utf8"))
    .forEach((cycle, index) => console.log(`  ${index + 1}) ${cycle.join(" > ")}`));
'
    exit 1
fi

if [ "$CYCLE_COUNT" -lt "$BASELINE" ]; then
    echo "    hint: cycles dropped below baseline — lower it: echo $CYCLE_COUNT > $BASELINE_FILE"
fi
echo "✔ gate passed ($CYCLE_COUNT <= $BASELINE)"
