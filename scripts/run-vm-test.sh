#!/usr/bin/env bash
set -euo pipefail

# Orchestrator that starts the VNC-enabled NixOS VM and runs the agent smoke test.
#
# Usage:
#   ./scripts/run-vm-test.sh
#
# The VM runs in the background. The script waits for VNC, runs the smoke test,
# then shuts down the VM.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VM_CMD="nix run ${PROJECT_ROOT}#nixosConfigurations.vm-vnc.config.system.build.vm"

# Cleanup function
cleanup() {
    local exit_code=$?
    echo ""
    echo "🧹 Cleaning up..."
    if [[ -n "${VM_PID:-}" ]]; then
        # Try graceful shutdown via QEMU monitor, then kill
        echo "  Stopping VM (PID: $VM_PID)..."
        kill "$VM_PID" 2>/dev/null || true
        wait "$VM_PID" 2>/dev/null || true
    fi
    exit $exit_code
}
trap cleanup EXIT INT TERM

echo "═══════════════════════════════════════════════════"
echo "  Shade Agentic VM Smoke Test"
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

# Run smoke test
echo "🧪 Running agent smoke test..."
python3 "${SCRIPT_DIR}/agent-smoke-test.py"

echo ""
echo "✅ Test run complete."
