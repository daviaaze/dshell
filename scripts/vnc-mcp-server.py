#!/usr/bin/env python3
"""
MCP server that exposes VNC control tools for agentic testing of Shade.

Connects to a VNC server (e.g. a QEMU VM running Hyprland + Shade) and
provides screenshot, keyboard, and mouse automation primitives.

Usage:
    SHADE_VNC_HOST=localhost SHADE_VNC_PORT=5901 python3 scripts/vnc-mcp-server.py

Then configure your MCP client (Claude Desktop, Cursor, etc.) to use this script.
"""

import base64
import os
import subprocess
import tempfile

from mcp.server.fastmcp import FastMCP

VNC_HOST = os.environ.get("SHADE_VNC_HOST", "localhost")
VNC_PORT = os.environ.get("SHADE_VNC_PORT", "5901")
VNC_SERVER = f"{VNC_HOST}::{VNC_PORT}"

mcp = FastMCP("shade-vnc")


def _vncdo(*args: str) -> None:
    cmd = ["vncdo", "-s", VNC_SERVER, *args]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


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
def send_key(key: str) -> str:
    """
    Send a key combination to the VNC session.

    Examples:
      - "super-space"   (open Shade app launcher)
      - "super-n"       (open Shade quick settings)
      - "esc"           (close current popup)
      - "Return"        (press Enter)
      - "ctrl-c"        (copy)
    """
    _vncdo("key", key)
    return f"Sent key: {key}"


@mcp.tool()
def type_text(text: str) -> str:
    """
    Type the given text into the VNC session (e.g. to search the app launcher).
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


@mcp.tool()
def save_screenshot(path: str) -> str:
    """
    Capture a screenshot and save it to a file path on disk.
    Useful for debugging or reference image collection.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    _vncdo("capture", path)
    return f"Screenshot saved to: {path}"


if __name__ == "__main__":
    print(f"Starting Shade VNC MCP server (VNC: {VNC_SERVER})", flush=True)
    mcp.run()
