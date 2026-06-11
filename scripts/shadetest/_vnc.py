"""VNC client wrapper around vncdo CLI.

All operations are stateless — each call spawns a fresh vncdo subprocess.
This avoids connection pool issues and keeps the API simple.
"""

import os
import subprocess
import time
from pathlib import Path


class VNCError(Exception):
    """Raised when a vncdo command fails."""

    def __init__(self, message: str, command: list[str] | None = None):
        super().__init__(message)
        self.command = command or []


class VNCClient:
    """Thin wrapper over the vncdo command-line tool.

    Manages server address, error handling, and common operations.
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 5901,
        password: str | None = None,
    ):
        self._server = f"{host}::{port}"
        self._password = password

    # ── Core vncdo invocation ────────────────────────────────────────────

    def _vncdo(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        """Run a vncdo command.

        Args:
            *args: Arguments to pass to vncdo after the server spec
            check: If True (default), raise on non-zero exit

        Returns:
            CompletedProcess with capture_output

        Raises:
            VNCError: If the command fails and check=True
        """
        cmd = ["vncdo", "-s", self._server]
        if self._password:
            cmd.extend(["-p", self._password])
        cmd.extend(args)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if check and result.returncode != 0:
                detail = result.stderr.strip() or result.stdout.strip() or "unknown error"
                raise VNCError(f"vncdo failed: {detail}", cmd)
            return result
        except subprocess.TimeoutExpired:
            raise VNCError(f"vncdo timed out: {' '.join(cmd)}", cmd)
        except FileNotFoundError:
            raise VNCError(
                "vncdo not found in PATH. Run: nix develop",
                cmd,
            )

    # ── High-level operations ────────────────────────────────────────────

    def key(self, key_combo: str) -> None:
        """Send a key or key combination.

        Examples:
            - "super-space" — Super+Space (opens Shade app launcher)
            - "super-n" — Super+n (opens Shade quick settings)
            - "esc" — Escape
            - "Return" — Enter
            - "ctrl-c" — Ctrl+C
            - "XF86AudioRaiseVolume" — Volume up media key
            - "XF86MonBrightnessUp" — Brightness up key
        """
        self._vncdo("key", key_combo)

    def type(self, text: str) -> None:
        """Type a string of text character by character.

        Useful for searching in the app launcher or typing commands.
        """
        self._vncdo("type", text)

    def mouse_move(self, x: int, y: int) -> None:
        """Move the mouse cursor to screen coordinates (x, y)."""
        self._vncdo("mousemove", str(x), str(y))

    def mouse_click(self, x: int, y: int, button: int = 1) -> None:
        """Move mouse to (x, y) and click.

        Args:
            x, y: Screen coordinates
            button: 1=left, 2=middle, 3=right
        """
        self._vncdo("mousemove", str(x), str(y), "click", str(button))

    def capture(self, name: str, output_dir: str = "test-output") -> str:
        """Capture a screenshot.

        Args:
            name: Base filename (without extension). "01-desktop" → test-output/01-desktop.png
            output_dir: Directory to save screenshots in

        Returns:
            Path to the saved PNG file
        """
        os.makedirs(output_dir, exist_ok=True)
        path = os.path.join(output_dir, f"{name}.png")
        self._vncdo("capture", path)
        return path

    def pause(self, seconds: str | float) -> None:
        """Send a pause command to vncdo (server-side delay).

        Prefer this over time.sleep() when you need the delay
        before the *next* VNC command (avoids local clock drift).
        """
        self._vncdo("pause", str(seconds))

    def wait_for_server(self, timeout: int = 60) -> bool:
        """Wait for the VNC server to become reachable.

        Uses bash TCP test (no Python socket dependency).

        Args:
            timeout: Maximum seconds to wait

        Returns:
            True if server is reachable, False on timeout
        """
        host = self._server.split("::")[0]
        port = self._server.split("::")[1] if "::" in self._server else "5901"

        for _ in range(timeout):
            try:
                result = subprocess.run(
                    ["bash", "-c", f"exec 3<>/dev/tcp/{host}/{port}"],
                    capture_output=True,
                    timeout=2,
                )
                if result.returncode == 0:
                    return True
            except (subprocess.TimeoutExpired, Exception):
                pass
            time.sleep(1)
        return False

    def is_reachable(self) -> bool:
        """Quick check: is the VNC server reachable right now?"""
        return self.wait_for_server(timeout=1)
