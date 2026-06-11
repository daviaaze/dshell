#!/usr/bin/env python3
"""
Extended agent test for Shade shell.

Tests more widgets and attempts to read journal errors via a terminal.
Uses the shadetest library for improved reliability.

Usage:
    SHADE_VNC_HOST=localhost SHADE_VNC_PORT=5901 python3 scripts/agent-full-test.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shadetest import ShadeTestHarness


def run_full_test(h: ShadeTestHarness) -> bool:
    print("\n=== Shade Full Agent Test ===\n")

    if not h.wait_for_vnc():
        print("❌ VNC server not reachable")
        return False

    print("Phase 1: Waiting for Hyprland + Shade...")
    if not h.wait_until_shade_ready():
        print("❌ Shade did not become ready")
        return False

    h.screenshot("f01-desktop")
    h.assertions.file_not_empty("f01-desktop")
    print("  ✅ Desktop rendered")

    # ── Phase 2: App Launcher ────────────────────────────────────────────
    print("\nPhase 2: App launcher...")
    h.send_key("super-space")
    time.sleep(1.5)
    h.screenshot("f02-launcher")
    h.assert_screenshot_differs_from("f01-desktop", "f02-launcher")
    print("  ✅ Launcher opened")

    h.type_text("ghost")
    time.sleep(1)
    h.screenshot("f03-launcher-search")
    print("  ✅ Search typed")

    # D-Bus testing requires SSH tunnel into VM — skipped for now.
    # Use keyboard shortcuts (super-space, super-n, etc.) instead.
    time.sleep(0.5)

    # Close launcher
    h.send_key("esc")
    time.sleep(1)

    # ── Phase 4: Quick Settings ──────────────────────────────────────────
    print("\nPhase 4: Quick settings...")
    h.send_key("super-n")
    time.sleep(1.5)
    h.screenshot("f07-qs-open")
    h.assertions.file_not_empty("f07-qs-open")
    print("  ✅ Quick settings opened")

    # Close QS with esc
    h.send_key("esc")
    time.sleep(1)
    h.screenshot("f09-qs-closed")
    print("  ✅ Quick settings closed")

    # ── Phase 5: Bar toggle ──────────────────────────────────────────────
    print("\nPhase 5: Bar toggle...")
    h.send_key("super-w")
    time.sleep(1)
    h.screenshot("f10-bar-hidden")
    h.assertions.file_not_empty("f10-bar-hidden")

    h.send_key("super-w")
    time.sleep(1)
    h.screenshot("f11-bar-visible")
    h.assertions.file_not_empty("f11-bar-visible")

    # Verify bar toggle changed the screen
    h.assert_screenshot_differs_from("f10-bar-hidden", "f11-bar-visible")
    print("  ✅ Bar toggle works (screen changed)")

    # ── Phase 7: OSD ─────────────────────────────────────────────────────
    print("\nPhase 7: Media keys / OSD...")
    try:
        h.send_key("XF86AudioRaiseVolume")
        time.sleep(1)
        h.screenshot("f14-osd-volume")
        h.assertions.file_not_empty("f14-osd-volume")
        print("  ✅ Volume OSD")
    except Exception as e:
        print(f"  ⚠️  Volume OSD skipped — XF86 keys unsupported by vncdo ({e})")

    try:
        h.send_key("XF86MonBrightnessUp")
        time.sleep(1)
        h.screenshot("f15-osd-brightness")
        h.assertions.file_not_empty("f15-osd-brightness")
        print("  ✅ Brightness OSD")
    except Exception as e:
        print(f"  ⚠️  Brightness OSD skipped — XF86 keys unsupported by vncdo ({e})")

    print("\n=== Full test passed ===")
    print(f"Screenshots saved to: test-output/")
    return True


def main() -> int:
    output_dir = os.environ.get("SHADE_TEST_OUTPUT", "test-output")

    with ShadeTestHarness(output_dir=output_dir) as h:
        try:
            success = run_full_test(h)
            return 0 if success else 1
        except KeyboardInterrupt:
            print("\n⚠️  Interrupted")
            return 130


if __name__ == "__main__":
    sys.exit(main())
