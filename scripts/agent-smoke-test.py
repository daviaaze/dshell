#!/usr/bin/env python3
"""
Agent smoke test for Shade shell via VNC.

This script connects directly to a VNC session and verifies that Shade
starts correctly and its major widgets respond to input without crashing.

Usage:
    SHADE_VNC_HOST=localhost SHADE_VNC_PORT=5901 python3 scripts/agent-smoke-test.py

Prerequisites:
    - vncdo (installed via nix develop or pip)
    - A running VNC server (e.g. the vm-vnc NixOS configuration)
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
    cmd = ["vncdo", "-s", VNC_SERVER, *args]
    subprocess.run(cmd, check=True)


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
            # bash built-in TCP check
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
    print("  ❌ VNC never became available")
    return False


def run_smoke_test() -> bool:
    print("\n=== Shade VNC Smoke Test ===\n")

    if not wait_for_vnc():
        return False

    # --- Phase 1: Wait for boot + Shade startup ---
    print("Phase 1: Waiting for Hyprland + Shade to start...")
    wait(20)
    screenshot("01-desktop")

    # --- Phase 2: App Launcher ---
    print("\nPhase 2: Testing app launcher (Super+Space)...")
    vncdo("key", "super-space")
    wait(1.5)
    screenshot("02-applauncher-open")

    # Type a search query
    vncdo("type", "fire")
    wait(1)
    screenshot("03-applauncher-search")

    # Close launcher
    vncdo("key", "esc")
    wait(0.5)
    screenshot("04-applauncher-closed")

    # --- Phase 3: Quick Settings ---
    print("\nPhase 3: Testing quick settings (Super+n)...")
    vncdo("key", "super-n")
    wait(1.5)
    screenshot("05-quicksettings-open")

    # Close QS
    vncdo("key", "esc")
    wait(0.5)
    screenshot("06-quicksettings-closed")

    # --- Phase 4: Bar toggle ---
    print("\nPhase 4: Testing bar toggle (Super+w)...")
    vncdo("key", "super-w")
    wait(1)
    screenshot("07-bar-hidden")

    vncdo("key", "super-w")
    wait(1)
    screenshot("08-bar-visible")

    # --- Phase 5: OSD simulation (media keys) ---
    print("\nPhase 5: Sending media keys...")
    vncdo("key", "XF86AudioRaiseVolume")
    wait(0.5)
    screenshot("09-osd-volume")

    print("\n=== Smoke test complete ===")
    print(f"Screenshots saved to: {OUTPUT_DIR.absolute()}/")
    return True


def main() -> int:
    try:
        success = run_smoke_test()
        return 0 if success else 1
    except subprocess.CalledProcessError as e:
        print(f"\n❌ VNC command failed: {e}", file=sys.stderr)
        print(f"   cmd: {' '.join(e.cmd)}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user")
        return 130


if __name__ == "__main__":
    sys.exit(main())
