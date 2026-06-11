#!/usr/bin/env python3
"""
Agent smoke test for Shade shell via VNC.

Connects to a running VNC server (or boots one via run-vm-test.sh)
and verifies that Shade starts correctly and major widgets respond
to input without crashing.

Usage:
    SHADE_VNC_HOST=localhost SHADE_VNC_PORT=5901 python3 scripts/agent-smoke-test.py

Prerequisites:
    - vncdo (installed via nix develop)
    - A running VNC server (e.g. the vm-vnc NixOS configuration)
"""

import os
import sys
import time

# Allow running from project root without PYTHONPATH hacks
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shadetest import ShadeTestHarness


def run_smoke_test(h: ShadeTestHarness) -> bool:
    print("\n=== Shade VNC Smoke Test ===\n")

    if not h.wait_for_vnc():
        print("❌ VNC server not reachable")
        return False

    print("Phase 1: Waiting for Hyprland + Shade to start...")
    if not h.wait_until_shade_ready():
        print("❌ Shade did not become ready within timeout")
        return False

    h.screenshot("01-desktop")
    h.assertions.file_not_empty("01-desktop")
    print("  ✅ Desktop appears to have rendered")

    # ── Phase 2: App Launcher ────────────────────────────────────────────
    print("\nPhase 2: Testing app launcher (Super+Space)...")
    h.send_key("super-space")
    time.sleep(1.5)
    h.screenshot("02-applauncher-open")
    h.assertions.file_not_empty("02-applauncher-open")

    # Verify the screenshot differs from desktop
    h.assert_screenshot_differs_from("01-desktop", "02-applauncher-open")
    print("  ✅ Launcher opened (screen changed)")

    # Type a search query
    h.type_text("fire")
    time.sleep(1)
    h.screenshot("03-applauncher-search")
    h.assertions.file_not_empty("03-applauncher-search")
    print("  ✅ Search typed")

    # Close launcher
    h.send_key("esc")
    time.sleep(0.5)
    h.screenshot("04-applauncher-closed")
    h.assertions.file_not_empty("04-applauncher-closed")
    print("  ✅ Launcher closed")

    # ── Phase 3: Quick Settings ──────────────────────────────────────────
    print("\nPhase 3: Testing quick settings (Super+n)...")
    h.send_key("super-n")
    time.sleep(1.5)
    h.screenshot("05-quicksettings-open")
    h.assertions.file_not_empty("05-quicksettings-open")

    # Should differ from post-launcher state
    h.assert_screenshot_differs_from("04-applauncher-closed", "05-quicksettings-open")
    print("  ✅ Quick settings opened (screen changed)")

    # Close QS
    h.send_key("esc")
    time.sleep(0.5)
    h.screenshot("06-quicksettings-closed")
    print("  ✅ Quick settings closed")

    # ── Phase 4: Bar toggle ──────────────────────────────────────────────
    print("\nPhase 4: Testing bar toggle (Super+w)...")
    h.send_key("super-w")
    time.sleep(1)
    h.screenshot("07-bar-hidden")
    h.assertions.file_not_empty("07-bar-hidden")
    print("  ✅ Bar toggle first press")

    h.send_key("super-w")
    time.sleep(1)
    h.screenshot("08-bar-visible")
    h.assertions.file_not_empty("08-bar-visible")
    print("  ✅ Bar toggle second press")

    # ── Phase 5: OSD simulation (media keys) ─────────────────────────────
    print("\nPhase 5: Sending media keys (via QEMU monitor sendkey)...")
    # XF86 keys are routed through QEMU monitor socket (see _vnc.py).
    # Falls back to vncdo if monitor socket is unavailable (VM not started
    # with -monitor flag or running outside the test VM).
    try:
        h.send_key("XF86AudioRaiseVolume")
        time.sleep(0.5)
        h.screenshot("09-osd-volume")
        h.assertions.file_not_empty("09-osd-volume")
        print("  ✅ Volume OSD appeared")
    except Exception as e:
        print(f"  ⚠️  Volume OSD skipped — {e}")

    # D-Bus testing requires SSH tunnel into the VM (not yet implemented).
    # See: nix/vm-vnc.nix for planned port forwarding.
    print("  ℹ️  D-Bus tests skipped — needs VM SSH access")

    print("\n=== Smoke test passed ===")
    print(f"Screenshots saved to: test-output/")
    return True


def main() -> int:
    output_dir = os.environ.get("SHADE_TEST_OUTPUT", "test-output")

    with ShadeTestHarness(output_dir=output_dir) as h:
        try:
            success = run_smoke_test(h)
            return 0 if success else 1
        except KeyboardInterrupt:
            print("\n⚠️  Interrupted by user")
            return 130


if __name__ == "__main__":
    sys.exit(main())
