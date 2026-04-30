#!/usr/bin/env python3
"""
Extended agent test for Shade shell.
Tests more widgets and attempts to read journal errors via a terminal.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

VNC_HOST = os.environ.get("SHADE_VNC_HOST", "localhost")
VNC_PORT = os.environ.get("SHADE_VNC_PORT", "5901")
VNC_SERVER = f"{VNC_HOST}::{VNC_PORT}"
OUTPUT_DIR = Path("test-output")


def vncdo(*args: str) -> None:
    subprocess.run(["vncdo", "-s", VNC_SERVER, *args], check=True)


def screenshot(name: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"{name}.png"
    vncdo("capture", str(path))
    print(f"  📸 {path}")
    return path


def wait(seconds: float) -> None:
    time.sleep(seconds)


def wait_for_vnc(timeout: int = 60) -> bool:
    print(f"Waiting for VNC server at {VNC_SERVER}...")
    for i in range(timeout):
        try:
            result = subprocess.run(
                ["bash", "-c", f"exec 3<>/dev/tcp/{VNC_HOST}/{VNC_PORT}"],
                capture_output=True,
            )
            if result.returncode == 0:
                print("  ✅ VNC ready")
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def run_full_test() -> bool:
    print("\n=== Shade Full Agent Test ===\n")

    if not wait_for_vnc():
        return False

    # --- Phase 1: Boot ---
    print("Phase 1: Waiting for Hyprland + Shade...")
    wait(45)
    screenshot("f01-desktop")

    # --- Phase 2: App Launcher ---
    print("\nPhase 2: App launcher...")
    vncdo("key", "super-space")
    wait(1.5)
    screenshot("f02-launcher")

    vncdo("type", "ghost")
    wait(1)
    screenshot("f03-launcher-search")

    # Click the first result (Ghostty) to open terminal
    # The launcher items are roughly at y=120, x=200
    vncdo("mousemove", "200", "120", "click", "1")
    wait(2)
    screenshot("f04-terminal-open")

    # --- Phase 3: Check journal for errors ---
    print("\nPhase 3: Checking journal for JS errors...")
    # Type the journal command in Ghostty
    vncdo("type", "journalctl --user -b | grep -iE 'JS ERROR|shade-shell|gjs' | tail -20")
    wait(0.5)
    vncdo("key", "Return")
    wait(2)
    screenshot("f05-journal-errors")

    # Close terminal
    vncdo("type", "exit")
    wait(0.3)
    vncdo("key", "Return")
    wait(1)
    screenshot("f06-terminal-closed")

    # --- Phase 4: Quick Settings ---
    print("\nPhase 4: Quick settings...")
    vncdo("key", "super-n")
    wait(1.5)
    screenshot("f07-qs-open")

    # Try clicking the power button (bottom of QS panel, roughly)
    vncdo("mousemove", "300", "500", "click", "1")
    wait(1)
    screenshot("f08-qs-after-click")

    # Close QS with esc
    vncdo("key", "esc")
    wait(1)
    screenshot("f09-qs-closed")

    # --- Phase 5: Bar toggle ---
    print("\nPhase 5: Bar toggle...")
    vncdo("key", "super-w")
    wait(1)
    screenshot("f10-bar-hidden")

    vncdo("key", "super-w")
    wait(1)
    screenshot("f11-bar-visible")

    # --- Phase 6: Settings window ---
    print("\nPhase 6: Settings window...")
    vncdo("key", "super-space")
    wait(1)
    vncdo("type", "shade settings")
    wait(1)
    screenshot("f12-settings-search")
    # Click result
    vncdo("mousemove", "200", "120", "click", "1")
    wait(2)
    screenshot("f13-settings-open")
    vncdo("key", "esc")
    wait(1)

    # --- Phase 7: OSD ---
    print("\nPhase 7: Media keys / OSD...")
    vncdo("key", "XF86AudioRaiseVolume")
    wait(1)
    screenshot("f14-osd-volume")

    vncdo("key", "XF86MonBrightnessUp")
    wait(1)
    screenshot("f15-osd-brightness")

    print("\n=== Full test complete ===")
    print(f"Screenshots: {OUTPUT_DIR.absolute()}/")
    return True


def main() -> int:
    try:
        success = run_full_test()
        return 0 if success else 1
    except subprocess.CalledProcessError as e:
        print(f"\n❌ VNC command failed: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted")
        return 130


if __name__ == "__main__":
    sys.exit(main())
