#!/usr/bin/env bash
set -euo pipefail

# Orchestrator that starts the VNC-enabled NixOS VM and runs the agent smoke test.
#
# Usage:
#   ./scripts/run-vm-test.sh [--smoke|--full] [--keep-alive]
#
#   --smoke       Run the quick smoke test (default)
#   --full        Run the extended full test
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
    --keep-alive) KEEP_ALIVE=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

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
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

echo "═══════════════════════════════════════════════════"
echo "  Shade Agentic VM Test ($TEST_MODE mode)"
echo "═══════════════════════════════════════════════════"
echo ""

# Ensure we're in a nix develop shell for Python deps
if ! command -v vncdo &>/dev/null; then
  echo "⚠️  vncdo not found in PATH."
  echo "   Please run: nix develop"
  echo "   Then run this script again."
  exit 1
fi

# Start VM in background
echo "🖥️  Starting NixOS VM with VNC on localhost:5901..."
echo "   (This will take a while on first run due to VM build)"
echo ""
$VM_CMD &
VM_PID=$!
echo "   VM PID: $VM_PID"
echo ""

# Wait a moment for QEMU to initialise
sleep 3

# Start MCP server alongside VM (optional, for agent integration)
echo "🔌 Starting MCP server on stdio..."
python3 "${SCRIPT_DIR}/vnc-mcp-server.py" &
MCP_PID=$!
echo "   MCP PID: $MCP_PID"
echo ""
sleep 1

# Run test
echo "🧪 Running agent test ($TEST_MODE mode)..."
if [[ "$TEST_MODE" == "full" ]]; then
  python3 "${SCRIPT_DIR}/agent-full-test.py"
else
  python3 "${SCRIPT_DIR}/agent-smoke-test.py"
fi

echo ""
echo "✅ Test run complete."
