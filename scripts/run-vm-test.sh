#!/usr/bin/env bash
set -euo pipefail

# Orchestrator that starts the VNC-enabled NixOS VM and runs agent tests.
#
# Usage:
#   ./scripts/run-vm-test.sh [--smoke|--full|--record] [--keep-alive]
#
#   --smoke       Run the quick smoke test (default)
#   --full        Run the extended full test
#   --record      Run recording test (wf-recorder + interactions)
#   --keep-alive  Don't kill the VM after the test (useful for debugging)
#
# The VM runs in the background. The script waits for VNC, runs the test,
# then shuts down the VM.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VM_CMD="nix run ${PROJECT_ROOT}#nixosConfigurations.vm-vnc.config.system.build.vm"

TEST_MODE="smoke"
KEEP_ALIVE=false

for arg in "$@"; do
  case "$arg" in
    --smoke) TEST_MODE="smoke" ;;
    --full) TEST_MODE="full" ;;
    --record) TEST_MODE="record" ;;
    --keep-alive) KEEP_ALIVE=true ;;
    *) echo "Unknown argument: $arg"; echo "Usage: $0 [--smoke|--full|--record] [--keep-alive]"; exit 1 ;;
  esac
done

# Ensure /tmp/shade-test-output exists for virtiofs
mkdir -p /tmp/shade-test-output

# Cleanup function
cleanup() {
  local exit_code=$?
  echo ""
  echo "🧹 Cleaning up..."
  if [[ -n "${MCP_PID:-}" ]]; then
    echo "  Stopping MCP server (PID: $MCP_PID)..."
    kill "$MCP_PID" 2>/dev/null || true
    wait "$MCP_PID" 2>/dev/null || true
  fi
  if [[ -n "${VM_PID:-}" ]] && ! $KEEP_ALIVE; then
    echo "  Stopping VM (PID: $VM_PID)..."
    kill "$VM_PID" 2>/dev/null || true
    wait "$VM_PID" 2>/dev/null || true
  elif $KEEP_ALIVE; then
    echo "  VM left running (PID: $VM_PID) — connect with vncviewer localhost:5901"
    echo "  Shared dir: /tmp/shade-test-output"
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ── Header ──────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════"
echo "  Shade Agentic VM Test ($TEST_MODE mode)"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Prerequisites ───────────────────────────────────────────────────────

if ! command -v vncdo &>/dev/null; then
  echo "⚠️  vncdo not found in PATH."
  echo "   Please run: nix develop"
  echo "   Then run this script again."
  exit 1
fi

# ── Start VM ────────────────────────────────────────────────────────────

echo "🖥️  Starting NixOS VM with VNC on localhost:5901..."
echo "   (This will take a while on first run due to VM build)"
echo ""
$VM_CMD &
VM_PID=$!
echo "   VM PID: $VM_PID"
echo ""

# Wait a moment for QEMU to initialise
sleep 3

# ── Start MCP server ────────────────────────────────────────────────────

echo "🔌 Starting MCP server on stdio..."
python3 "${SCRIPT_DIR}/vnc-mcp-server.py" &
MCP_PID=$!
echo "   MCP PID: $MCP_PID"
echo ""
sleep 1

# ── Run test ────────────────────────────────────────────────────────────

echo "🧪 Running agent test ($TEST_MODE mode)..."
echo ""

case "$TEST_MODE" in
  smoke)
    python3 "${SCRIPT_DIR}/agent-smoke-test.py"
    ;;
  full)
    python3 "${SCRIPT_DIR}/agent-full-test.py"
    ;;
  record)
    python3 "${SCRIPT_DIR}/agent-record-test.py"
    ;;
esac

echo ""
echo "✅ Test run complete."

# ── Show artifacts ──────────────────────────────────────────────────────

if [[ -d test-output ]]; then
  PNG_COUNT=$(find test-output -name '*.png' 2>/dev/null | wc -l)
  PNG_SIZE=$(du -sh test-output 2>/dev/null | cut -f1)
  echo ""
  echo "📸 Screenshots: $PNG_COUNT files ($PNG_SIZE) in test-output/"
fi

if [[ -d /tmp/shade-test-output ]]; then
  REC_COUNT=$(find /tmp/shade-test-output -name '*.mp4' -o -name '*.mkv' -o -name '*.webm' 2>/dev/null | wc -l)
  if [[ $REC_COUNT -gt 0 ]]; then
    echo "📹 Recordings:  $REC_COUNT files in /tmp/shade-test-output/"
  fi
fi
