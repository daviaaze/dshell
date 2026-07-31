#!/usr/bin/env bash
# Generate the module dependency graph and enforce the circular-dependency gate.
#
# Outputs (in $OUT_DIR, default docs/deps/):
#   deps.json       - madge raw graph
#   deps.dot        - Graphviz directedd graph, folder-aggregated
#   deps.svg/.png   - rendered graph (only if `dot` is on PATH)
#
# Gate: fails (exit 1) if circular deps exceed the baseline in
# deps/cycle-baseline. Lower the baseline as cycles are removed in
# Phases 2-3; adding a new cycle always fails.
set -euo pipefail

cd "$(dirname "$0")/.."

ROOT="$(pwd)"
SRC="$ROOT/src"
OUT_DIR="${OUT_DIR:-$ROOT/docs/deps}"
mkdir -p "$OUT_DIR"

SHELL_ENTRY="apps/shell/src/main.ts"
GREETER_ENTRY="apps/greeter/src/main.ts"
SHAREPICKER_ENTRY="apps/share-picker/src/main.ts"

echo "==> Finding files & building graph (madge)"
npx madge --json \
    --ts-config tsconfig.json \
    "$SHELL_ENTRY" "$GREETER_ENTRY" "$SHAREPICKER_ENTRY" \
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
BASELINE_FILE="$OUT_DIR/cycle-baseline"
if [ ! -f "$BASELINE_FILE" ]; then
    echo "0" > "$BASELINE_FILE"
    echo "    (created baseline at 0 — set it to the current cycle count)"
fi
BASELINE=$(cat "$BASELINE_FILE")

# Collect cycle lines, strip the trailing summary.
CYCLE_REPORT="$(npx madge --circular \
    --ts-config tsconfig.json \
    "$SHELL_ENTRY" "$GREETER_ENTRY" "$SHAREPICKER_ENTRY" 2>&1 || true)"
CYCLE_COUNT="$(printf '%s\n' "$CYCLE_REPORT" | grep -cE '^\s*[0-9]+\)' || true)"

echo "    cycles found: $CYCLE_COUNT  (baseline: $BASELINE)"

if [ "$CYCLE_COUNT" -gt "$BASELINE" ]; then
    echo "✖ FAIL: $CYCLE_COUNT cycles exceed baseline $BASELINE"
    printf '%s\n' "$CYCLE_REPORT"
    exit 1
fi

if [ "$CYCLE_COUNT" -lt "$BASELINE" ]; then
    echo "    hint: cycles dropped below baseline — lower it: echo $CYCLE_COUNT > $BASELINE_FILE"
fi
echo "✔ gate passed ($CYCLE_COUNT <= $BASELINE)"
