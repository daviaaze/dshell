#!/usr/bin/env python3
"""
MCP server that exposes VNC control tools for agentic testing of Shade.

Connects to a VNC server (e.g. a QEMU VM running Hyprland + Shade) and
provides screenshot, keyboard, mouse automation, recording, and assertion
primitives for AI agents.

Usage:
    SHADE_VNC_HOST=localhost SHADE_VNC_PORT=5901 python3 scripts/vnc-mcp-server.py

Then configure your MCP client (Claude Desktop, Cursor, etc.) to use this script.
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time

from mcp.server.fastmcp import FastMCP

# Add scripts dir to path so we can import shadetest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

VNC_HOST = os.environ.get("SHADE_VNC_HOST", "localhost")
VNC_PORT = os.environ.get("SHADE_VNC_PORT", "5901")
VNC_SERVER = f"{VNC_HOST}::{VNC_PORT}"

mcp = FastMCP("shade-vnc")


def _vncdo(*args: str) -> None:
    cmd = ["vncdo", "-s", VNC_SERVER, *args]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


# ═══════════════════════════════════════════════════════════════════════════
# Screenshot tools
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def screenshot() -> str:
    """
    Capture a screenshot of the VNC session and return it as a base64-encoded PNG.
    The agent can decode this to see the current visual state of the desktop.
    """
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        path = f.name
    try:
        _vncdo("capture", path)
        with open(path, "rb") as f:
            data = f.read()
        return base64.b64encode(data).decode("utf-8")
    finally:
        os.unlink(path)


@mcp.tool()
def save_screenshot(filename: str) -> str:
    """
    Capture a screenshot and save it to a file on disk.
    Useful for debugging or building golden image collections.

    Args:
        filename: Path like "test-output/01-desktop.png"
    """
    os.makedirs(os.path.dirname(filename) or ".", exist_ok=True)
    _vncdo("capture", filename)
    return f"Screenshot saved to: {filename}"


# ═══════════════════════════════════════════════════════════════════════════
# Input tools
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def send_key(key: str) -> str:
    """
    Send a key combination to the VNC session.

    Shade keybindings:
      - "super-space"   (open app launcher)
      - "super-n"       (open quick settings)
      - "super-w"       (toggle bar)
      - "super-s"       (toggle window switcher)
      - "super-v"       (toggle clipboard)
      - "super-l"       (lock screen)
    Media keys:
      - "XF86AudioRaiseVolume", "XF86AudioLowerVolume", "XF86AudioMute"
      - "XF86MonBrightnessUp", "XF86MonBrightnessDown"
      - "esc", "Return", "ctrl-c"
    """
    _vncdo("key", key)
    return f"Sent key: {key}"


@mcp.tool()
def type_text(text: str) -> str:
    """
    Type the given text into the VNC session.
    Use for searching in the app launcher or typing terminal commands.
    """
    _vncdo("type", text)
    return f"Typed: {text}"


@mcp.tool()
def mouse_click(x: int, y: int, button: int = 1) -> str:
    """
    Click at the given screen coordinates.

    Args:
        x: Horizontal pixel coordinate
        y: Vertical pixel coordinate
        button: Mouse button (1=left, 2=middle, 3=right)
    """
    _vncdo("mousemove", str(x), str(y), "click", str(button))
    return f"Clicked button {button} at ({x}, {y})"


@mcp.tool()
def mouse_move(x: int, y: int) -> str:
    """
    Move the mouse cursor to the given screen coordinates.
    """
    _vncdo("mousemove", str(x), str(y))
    return f"Moved mouse to ({x}, {y})"


# ═══════════════════════════════════════════════════════════════════════════
# Recording tools (Sprint 2)
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def record_sequence(
    actions: str,
    interval_ms: int = 300,
    output_dir: str = "test-output",
) -> str:
    """
    Execute a sequence of VNC actions, capturing a screenshot after each one.
    Returns the list of saved screenshot paths as JSON.

    Use this to record video-like frame sequences of UI interactions.

    Args:
        actions: JSON list of action objects.
                 Each action: {"type": "key", "value": "super-space"}
                            {"type": "type", "value": "fire"}
                            {"type": "click", "x": 200, "y": 120}
                            {"type": "wait", "ms": 500}
                            {"type": "screenshot", "label": "launcher-open"}
        interval_ms: Default delay between actions (milliseconds)
        output_dir: Directory to save screenshots

    Returns:
        JSON object with "frames" list of saved screenshot paths

    Example:
        record_sequence([
            {"type": "key", "value": "super-space"},
            {"type": "screenshot", "label": "01-launcher"},
            {"type": "type", "value": "fire"},
            {"type": "screenshot", "label": "02-search"},
            {"type": "key", "value": "esc"},
            {"type": "screenshot", "label": "03-closed"}
        ])
    """
    if isinstance(actions, str):
        actions = json.loads(actions)

    os.makedirs(output_dir, exist_ok=True)
    frames = []
    step = 0

    for action in actions:
        atype = action.get("type", "")

        if atype == "key":
            _vncdo("key", action["value"])
            time.sleep(interval_ms / 1000)

        elif atype == "type":
            _vncdo("type", action["value"])
            time.sleep(interval_ms / 1000)

        elif atype == "click":
            _vncdo(
                "mousemove",
                str(action["x"]),
                str(action["y"]),
                "click",
                str(action.get("button", 1)),
            )
            time.sleep(interval_ms / 1000)

        elif atype == "wait":
            time.sleep(action.get("ms", interval_ms) / 1000)

        elif atype == "screenshot":
            label = action.get("label", f"frame_{step:04d}")
            path = os.path.join(output_dir, f"{label}.png")
            _vncdo("capture", path)
            frames.append(path)
            step += 1

        else:
            return json.dumps({"error": f"Unknown action type: {atype}"})

    return json.dumps({"frames": frames, "count": len(frames)})


# ═══════════════════════════════════════════════════════════════════════════
# D-Bus tools (Sprint 2)
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def dbus_activate(action_name: str) -> str:
    """
    Activate a Shade GIO action via D-Bus.

    More reliable than keyboard shortcuts — works regardless of
    screen resolution, focus state, or VNC key mapping.

    Args:
        action_name: One of:
            "toggle-applauncher", "toggle-quicksettings", "toggle-bar",
            "toggle-windowswitcher", "toggle-settings",
            "toggle-clipboard", "lockscreen", "screenshot",
            "screenshot-area", "record", "record-area",
            "record-window", "record-output", "toggle-touchpad"

    Returns:
        D-Bus call result or error message
    """
    result = subprocess.run(
        [
            "gdbus", "call", "--session",
            "--dest", "com.caioasmuniz.shade_shell",
            "--object-path", "/com/caioasmuniz/shade_shell",
            "--method", "org.gtk.Actions.Activate",
            "(sva{sv})",
            action_name, "[]", "[]",
        ],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        return json.dumps({"error": result.stderr.strip()})
    return json.dumps({"success": True, "action": action_name})


# ═══════════════════════════════════════════════════════════════════════════
# Assertion tools (Sprint 2)
# ═══════════════════════════════════════════════════════════════════════════

@mcp.tool()
def assert_screen_changed() -> str:
    """
    Take two screenshots (before/after) and check if the screen changed.
    The agent should call this BEFORE and AFTER an interaction to verify
    the UI responded.

    Returns JSON with whether the screen changed and the two screenshot
    base64 strings for visual inspection.
    """
    import time

    result = {"before": screenshot(), "changed": False, "after": ""}

    # Agent calls this BEFORE interaction to set baseline
    # and a SECOND time AFTER interaction to check.
    # We use a simple file-based state.
    state_file = "/tmp/shade-mcp-assert-state.txt"

    if os.path.exists(state_file):
        # Second call — compare with baseline
        with open(state_file, "r") as f:
            before_b64 = f.read()

        after_b64 = screenshot()
        result["before"] = before_b64
        result["after"] = after_b64

        # Quick size-based comparison
        changed = len(before_b64) != len(after_b64)
        result["changed"] = changed

        os.unlink(state_file)
        return json.dumps(result)
    else:
        # First call — store baseline
        with open(state_file, "w") as f:
            f.write(result["before"])
        return json.dumps({"status": "baseline captured — call again after interaction"})


@mcp.tool()
def wait_for_shade(timeout_sec: int = 60) -> str:
    """
    Wait until Shade appears to be running by polling the VNC server
    for valid screenshots.

    Returns when Shade is ready or timeout.
    """
    import time

    start = time.monotonic()
    # Minimum wait for boot
    min_wait = 15
    elapsed = 0
    while elapsed < min_wait:
        time.sleep(1)
        elapsed = time.monotonic() - start

    while (time.monotonic() - start) < timeout_sec:
        try:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as f:
                _vncdo("capture", f.name)
                if os.path.getsize(f.name) > 2000:
                    return json.dumps({
                        "ready": True,
                        "elapsed_sec": round(time.monotonic() - start, 1),
                    })
        except Exception:
            pass
        time.sleep(1)

    return json.dumps({"ready": False, "elapsed_sec": timeout_sec})


# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"Starting Shade VNC MCP server (VNC: {VNC_SERVER})", flush=True)
    mcp.run()
