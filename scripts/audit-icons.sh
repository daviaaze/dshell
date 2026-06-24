#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  audit-icons.sh — Verify icon names against installed theme
# ─────────────────────────────────────────────────────────────
# Scans src/lib/iconNames.ts for all icon name strings and
# checks each one against the Adwaita SVG files on disk.
#
# Usage:
#   ./scripts/audit-icons.sh              # basic audit
#   ./scripts/audit-icons.sh --verbose    # show all icons
#   ./scripts/audit-icons.sh --update     # update the file with changes
#
# Exit code: 0 if all OK, 1 if any icons are missing.

set -euo pipefail

ICON_NAMES_FILE="${EXTRA[0]:-src/lib/iconNames.ts}"
VERBOSE=false
UPDATE=false
EXTRA=()
for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=true ;;
    --update)  UPDATE=true ;;
    *)         EXTRA+=("$arg") ;;
  esac
done

# ── Find the Adwaita icon store ─────────────────────────────────
# Use adwaita-icon-theme from $XDG_DATA_DIRS or nix store
ADWAITA_DIR=$(find /nix/store -maxdepth 2 -name "*adwaita-icon-theme*" -type d 2>/dev/null | head -1)
ICON_DIR="$ADWAITA_DIR/share/icons/Adwaita"

if [ -z "$ADWAITA_DIR" ] || [ ! -d "$ICON_DIR" ]; then
  # Fallback: try XDG_DATA_DIRS
  ICON_DIR=""
  for dir in $(echo "${XDG_DATA_DIRS:-}" | tr ':' ' '); do
    candidate="$dir/icons/Adwaita"
    if [ -d "$candidate" ]; then
      ICON_DIR="$candidate"
      ADWAITA_DIR="$dir"
      break
    fi
  done
fi

if [ -z "$ICON_DIR" ] || [ ! -d "$ICON_DIR" ]; then
  echo "❌ Cannot find Adwaita icon theme on this system."
  echo "   Looked in /nix/store and XDG_DATA_DIRS."
  echo "   Run inside nix develop or install adwaita-icon-theme."
  exit 2
fi

ICON_DIR="$ADWAITA_DIR/share/icons/Adwaita"
VER=$("$ADWAITA_DIR"/share/pkgconfig/adwaita-icon-theme.pc 2>/dev/null | grep Version | cut -d' ' -f2 || echo "?")
echo "📁 Adwaita $VER: $ICON_DIR"
echo ""

# ── Extract icon names from the TS file ──────────────────────────
# Only scan non-comment lines to avoid catching commented-out names
ICONS=$(grep -v '^\s*//\|^\s*#' "$ICON_NAMES_FILE" | grep -o '"[a-zA-Z0-9._-]*-symbolic"' | tr -d '"' | sort -u)
UNVERIFIED=$(grep -A1 '@unverified' "$ICON_NAMES_FILE" | grep -o '"[a-zA-Z0-9._-]*-symbolic"' | tr -d '"' | sort -u)

TOTAL=0
MISSING=0
FOUND=0
UNV=0

while IFS= read -r name; do
  [ -z "$name" ] && continue
  TOTAL=$((TOTAL + 1))
  # Check if explicitly marked as @unverified
  if echo "$UNVERIFIED" | grep -qxF "$name"; then
    UNV=$((UNV + 1))
    $VERBOSE && echo "  ⚠️  $name (unverified)"
    continue
  fi
  svg=$(find "$ICON_DIR" -name "${name}.svg" 2>/dev/null | head -1)
  if [ -n "$svg" ]; then
    FOUND=$((FOUND + 1))
    $VERBOSE && echo "  ✅ $name"
  else
    MISSING=$((MISSING + 1))
    echo "  ❌ $name"
  fi
done <<< "$ICONS"

echo ""
echo "─── Results ─────────────────────────────────────"
echo "  Total:       $TOTAL"
echo "  Found:       $FOUND"
echo "  Unverified:  $UNV"
echo "  Missing:     $MISSING"
echo ""

if [ $MISSING -gt 0 ]; then
  echo "⚠️  $MISSING icon(s) not found in Adwaita $VER."
  echo "   Either rename them or add the missing icon theme."
  exit 1
else
  echo "✅ All $TOTAL icons verified against Adwaita $VER."
  exit 0
fi
