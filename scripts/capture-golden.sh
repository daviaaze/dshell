#!/usr/bin/env bash
set -euo pipefail

# Capture golden reference screenshots from a running Shade VM.
# These serve as regression baselines for future tests.
#
# Usage:
#   ./scripts/capture-golden.sh [--overwrite]
#
# Requirements:
#   - VM running with VNC on localhost:5901
#   - vncdo in PATH (nix develop)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOLDEN_DIR="${SCRIPT_DIR}/../test-golden"
OUTPUT_DIR="/tmp/shade-golden-capture"

OVERWRITE=false
[[ "${1:-}" == "--overwrite" ]] && OVERWRITE=true

if ! command -v vncdo &>/dev/null; then
  echo "❌ vncdo not found. Run: nix develop"
  exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  Shade Golden Image Capture"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Golden dir:  $GOLDEN_DIR"
echo "  Temp dir:    $OUTPUT_DIR"
echo ""

mkdir -p "$GOLDEN_DIR"
mkdir -p "$OUTPUT_DIR"

VNC="vncdo -s localhost::5901"

echo "Phase 1: Desktop baseline"
$VNC capture "$OUTPUT_DIR/desktop.png"
cp "$OUTPUT_DIR/desktop.png" "$GOLDEN_DIR/01-desktop.png"
echo "  ✅ desktop"

echo "Phase 2: App launcher"
$VNC key super-space
sleep 1.5
$VNC capture "$OUTPUT_DIR/launcher.png"
cp "$OUTPUT_DIR/launcher.png" "$GOLDEN_DIR/02-launcher-open.png"
echo "  ✅ launcher"

$VNC type fire
sleep 1
$VNC capture "$OUTPUT_DIR/search.png"
cp "$OUTPUT_DIR/search.png" "$GOLDEN_DIR/03-launcher-search.png"
echo "  ✅ launcher search"

$VNC key esc
sleep 0.5

echo "Phase 3: Quick settings"
$VNC key super-n
sleep 1.5
$VNC capture "$OUTPUT_DIR/qs.png"
cp "$OUTPUT_DIR/qs.png" "$GOLDEN_DIR/04-quicksettings-open.png"
echo "  ✅ quicksettings"

$VNC key esc
sleep 0.5

echo "Phase 4: OSD"
$VNC key XF86AudioRaiseVolume
sleep 0.5
$VNC capture "$OUTPUT_DIR/osd.png"
cp "$OUTPUT_DIR/osd.png" "$GOLDEN_DIR/05-osd-volume.png"
echo "  ✅ OSD"

$VNC key XF86MonBrightnessUp
sleep 0.5
$VNC capture "$OUTPUT_DIR/osd-brightness.png"
cp "$OUTPUT_DIR/osd-brightness.png" "$GOLDEN_DIR/06-osd-brightness.png"
echo "  ✅ OSD brightness"

echo ""
echo "✅ Golden images captured to $GOLDEN_DIR/"
echo ""
echo "Golden files:"
ls -lh "$GOLDEN_DIR"/*.png 2>/dev/null || echo "  (none)"
echo ""
echo "Run with --overwrite to replace existing golden images."
echo "To use in tests: h.assertions.matches_golden('02-launcher-open', 'test-golden')"
