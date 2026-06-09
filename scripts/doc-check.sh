#!/usr/bin/env bash
# doc-check.sh — Pre-commit hook implementing Doc Maintenance Rules #1 and #4
#
# Rule #1: Every file path referenced in CHANGELOG.md under backticks must
#   exist on the filesystem. Only paths with a directory prefix (src/, nix/,
#   data/, scripts/, docs/, assets/) or containing '/' are treated as file
#   references — bare filenames are skipped as they may be component names.
#
# Rule #4: All .md documents are scanned for file-path references; any that
#   do not exist on disk are reported as warnings.
#
# Usage:
#   ./scripts/doc-check.sh           # check current working tree
#   ./scripts/doc-check.sh --strict  # exit non-zero on .md warnings too

set -euo pipefail

STRICT=false
[[ "${1:-}" == "--strict" ]] && STRICT=true

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

VIOLATIONS=0
WARNINGS=0

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# A path must start with a known project directory or contain '/' to count
# as a file reference (bare filenames like 'clock.tsx' are often component names)
is_file_ref() {
  local p="$1"
  [[ "$p" == src/* ]] && return 0
  [[ "$p" == nix/* ]] && return 0
  [[ "$p" == data/* ]] && return 0
  [[ "$p" == scripts/* ]] && return 0
  [[ "$p" == docs/* ]] && return 0
  [[ "$p" == assets/* ]] && return 0
  [[ "$p" == build/* ]] && return 0
  [[ "$p" == "."* ]] && return 0
  [[ "$p" == */* ]] && return 0
  return 1
}

echo "=== doc-check.sh — Doc Maintenance Rules #1 & #4 ==="
echo ""

# ─── Rule #1: CHANGELOG file references must be verifiable ───────────────────

echo "--- Rule #1: CHANGELOG.md file reference verification ---"

if [[ ! -f CHANGELOG.md ]]; then
  echo "  SKIP: CHANGELOG.md not found"
else
  changelog_refs=$(grep -oP '\x60([a-zA-Z0-9_./-]+\.(tsx?|nix|py|json|xml|sh|css|md|png|jpg|desktop|in))\x60' CHANGELOG.md \
    | sed 's/^`//;s/`$//' \
    | sort -u || true)

  found_any=false
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    f="${f#./}"
    is_file_ref "$f" || continue
    found_any=true
    if [[ -f "$f" ]]; then
      echo "  ${GREEN}OK${NC}  $f"
    else
      echo "  ${RED}MISS${NC} $f  (referenced in CHANGELOG.md but does not exist)"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done <<< "$changelog_refs"

  if ! $found_any; then
    echo "  ${GREEN}OK${NC}: No file-path references found in CHANGELOG.md"
  fi
fi

echo ""

# ─── Rule #4: All .md file paths must reference existing files ───────────────

echo "--- Rule #4: All .md document file reference verification ---"

mapfile -t md_files < <(find . -name "*.md" \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -not -path "./build/*" \
  -not -path "./.pi/*" \
  | sort)

for md in "${md_files[@]}"; do
  refs=$(grep -oP '\x60([a-zA-Z0-9_./-]+\.(tsx?|nix|py|json|xml|sh|css|md|png|jpg|desktop|in))\x60' "$md" \
    | sed 's/^`//;s/`$//' \
    | sort -u || true)

  [[ -z "$refs" ]] && continue

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    f="${f#./}"
    is_file_ref "$f" || continue
    # Skip URLs
    [[ "$f" =~ ^https?:// ]] && continue
    # Skip absolute paths (outside project)
    [[ "$f" == /* ]] && continue

    if [[ -f "$f" || -d "$f" ]]; then
      :
    else
      echo "  ${YELLOW}WARN${NC} $f  (referenced in $md but does not exist)"
      WARNINGS=$((WARNINGS + 1))
    fi
  done <<< "$refs"
done

if [[ "$WARNINGS" -eq 0 ]]; then
  echo "  ${GREEN}OK${NC}: No stale file-path references in .md documents"
fi

echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────

echo "=== Summary ==="
echo "  Violations (CHANGELOG): $VIOLATIONS"
echo "  Warnings  (all .md):    $WARNINGS"
echo ""

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo "${RED}FAIL${NC}: CHANGELOG.md references file paths that do not exist."
  echo "  Remove or update entries that claim features for missing files."
  exit 1
fi

if $STRICT && [[ "$WARNINGS" -gt 0 ]]; then
  echo "${RED}FAIL${NC}: Strict mode — .md warnings treated as errors."
  exit 1
fi

echo "${GREEN}PASS${NC}: Doc health check passed."
echo ""
echo "  Tip: Add as pre-commit hook:"
echo "    ln -sf ../../scripts/doc-check.sh .git/hooks/pre-commit"
