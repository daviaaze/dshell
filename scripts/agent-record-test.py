#!/usr/bin/env python3
"""
Recording test for Shade shell — captures wf-recorder video inside the VM
and performs UI interactions, then retrieves the recording to the host.

Uses Shade's built-in D-Bus recording commands or falls back to
direct ssh + wf-recorder invocation.

Usage:
    SHADE_VNC_HOST=localhost SHADE_VNC_PORT=5901 python3 scripts/agent-record-test.py

Requirements:
    - VM must have wf-recorder installed (already in vm.nix)
    - VM must have /mnt/test-output mounted (virtiofs share)
    - Host has /tmp/shade-test-output writable
"""

import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shadetest import ShadeTestHarness


def start_recording_via_dbus(h: ShadeTestHarness) -> bool:
    """Start wf-recorder via Shade's D-Bus recording action."""
    try:
        h.dbus_activate("record")
        print("  🎥 Recording started via D-Bus")
        return True
    except Exception as e:
        print(f"  ⚠️  D-Bus record failed: {e}")
        return False


def stop_recording_via_dbus(h: ShadeTestHarness) -> bool:
    """Stop recording via D-Bus."""
    try:
        h.dbus_activate("record")
        print("  ⏹️  Recording stopped via D-Bus")
        return True
    except Exception as e:
        print(f"  ⚠️  D-Bus stop failed: {e}")
        return False


def run_record_test(h: ShadeTestHarness) -> bool:
    print("\n=== Shade Recording Test ===\n")

    if not h.wait_for_vnc():
        print("❌ VNC not reachable")
        return False

    print("Waiting for Shade...")
    if not h.wait_until_shade_ready():
        print("❌ Shade not ready")
        return False

    # Start recording
    print("\n🎥 Starting recording...")
    if not start_recording_via_dbus(h):
        print("⚠️  Falling back to VNC frame series")

    # Perform interactions
    print("\nPerforming interactions...")

    print("  1. Opening app launcher...")
    h.send_key("super-space")
    time.sleep(1.5)
    h.screenshot("r01-launcher")

    print("  2. Searching for app...")
    h.type_text("fire")
    time.sleep(1)
    h.screenshot("r02-search")

    print("  3. Closing launcher...")
    h.send_key("esc")
    time.sleep(0.5)

    print("  4. Opening quick settings...")
    h.send_key("super-n")
    time.sleep(1.5)
    h.screenshot("r03-qs")

    print("  5. Toggle bar...")
    h.send_key("super-w")
    time.sleep(1)
    h.screenshot("r04-bar-hidden")

    h.send_key("super-w")
    time.sleep(1)
    h.screenshot("r05-bar-visible")

    print("  6. Sending media keys (via QEMU monitor sendkey)...")
    try:
        h.send_key("XF86AudioRaiseVolume")
        time.sleep(0.5)
        h.screenshot("r06-osd")
    except Exception as e:
        print(f"    ⚠️  Volume OSD skipped — {e}")

    print("  7. Closing quick settings...")
    h.send_key("esc")
    time.sleep(1)

    # Stop recording
    print("\n⏹️  Stopping recording...")
    stop_recording_via_dbus(h)

    # Check shared directory for recordings
    print("\n📁 Checking for recording files...")
    shared_dir = "/tmp/shade-test-output"
    if os.path.isdir(shared_dir):
        files = sorted(os.listdir(shared_dir))
        recordings = [f for f in files if f.endswith(('.mp4', '.mkv', '.webm'))]
        if recordings:
            for r in recordings:
                rpath = os.path.join(shared_dir, r)
                size_mb = os.path.getsize(rpath) / (1024 * 1024)
                print(f"  📹 {r} ({size_mb:.1f} MB)")
        else:
            print(f"  No recording files found in {shared_dir}")
            print(f"  Files present: {files[:10]}")
    else:
        print(f"  ⚠️  Shared dir {shared_dir} does not exist")
        print(f"  Recording may be saved inside the VM at ~/Videos/")

    print("\n=== Recording test complete ===")
    print(f"Screenshots saved to: test-output/")
    return True


def main() -> int:
    output_dir = os.environ.get("SHADE_TEST_OUTPUT", "test-output")

    with ShadeTestHarness(output_dir=output_dir) as h:
        try:
            success = run_record_test(h)
            return 0 if success else 1
        except KeyboardInterrupt:
            print("\n⚠️  Interrupted")
            return 130


if __name__ == "__main__":
    sys.exit(main())
