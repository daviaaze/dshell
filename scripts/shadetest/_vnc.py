"""VNC client wrapper around vncdo CLI.

All operations are stateless — each call spawns a fresh vncdo subprocess.
This avoids connection pool issues and keeps the API simple.

QEMU monitor integration: XF86 media keys are sent via the QEMU monitor
Unix socket (sendkey command) since vncdo's KEYMAP does not include them.
VM snapshots (savevm/loadvm) also use the same monitor socket.
"""

import os
import socket
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
        qemu_monitor_socket: str = "/tmp/shade-qemu-monitor",
    ):
        self._server = f"{host}::{port}"
        self._password = password
        self._monitor_socket_path = qemu_monitor_socket

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
            - "XF86AudioRaiseVolume" — Volume up media key (via QEMU monitor)
            - "XF86MonBrightnessUp" — Brightness up key (via QEMU monitor)

        XF86 keys are routed to the QEMU monitor sendkey command because
        vncdo's KEYMAP does not include media key codes.
        """
        # Route XF86 media keys through QEMU monitor (vncdo KEYMAP lacks them)
        if key_combo.startswith("XF86"):
            self.send_qemu_key(key_combo)
            return
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

    # ── QEMU monitor commands (Unix socket) ─────────────────────────────

    def _qemu_monitor_connect(self) -> socket.socket:
        """Connect to the QEMU monitor Unix socket.

        Returns:
            Connected socket (blocking, with 5s timeout)

        Raises:
            VNCError: If the socket does not exist or connection fails
        """
        if not os.path.exists(self._monitor_socket_path):
            raise VNCError(
                f"QEMU monitor socket not found: {self._monitor_socket_path}",
            )

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        try:
            sock.connect(self._monitor_socket_path)
        except (socket.error, OSError) as e:
            sock.close()
            raise VNCError(
                f"Failed to connect to QEMU monitor: {e}",
            ) from e
        return sock

    def _qemu_monitor_cmd(self, cmd: str) -> str:
        """Send a command to the QEMU monitor and return the response.

        Opens a new connection for each command (stateless).
        The QEMU Human Monitor Protocol (HMP) accepts plain-text commands
        terminated by newline. Responses end with the "(qemu)" prompt.

        Args:
            cmd: QEMU monitor command (e.g., "sendkey XF86AudioRaiseVolume")

        Returns:
            Response text from QEMU monitor

        Raises:
            VNCError: On connection failure or monitor error response
        """
        sock = self._qemu_monitor_connect()
        try:
            # Drain any pending banner/text before sending command.
            # On first connection, QEMU sends a welcome banner before the prompt.
            sock.settimeout(0.1)
            try:
                while True:
                    chunk = sock.recv(4096)
                    if not chunk or b"(qemu)" in chunk:
                        break
            except socket.timeout:
                pass
            sock.settimeout(5.0)

            sock.sendall((cmd + "\n").encode("utf-8"))

            response_parts: list[bytes] = []
            while True:
                try:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    response_parts.append(chunk)
                    # QEMU HMP prompt indicates end of response
                    if b"(qemu)" in chunk:
                        break
                except socket.timeout:
                    break

            response = b"".join(response_parts).decode("utf-8", errors="replace")

            # Check for QEMU error responses
            if "unknown command" in response.lower():
                raise VNCError(
                    f"QEMU monitor error for '{cmd}': {response.strip()}",
                )

            return response
        finally:
            sock.close()

    def send_qemu_key(self, key: str) -> None:
        """Send an XF86 media key via the QEMU monitor sendkey command.

        This is the mechanism for sending keys that vncdo's KEYMAP
        does not support (XF86AudioRaiseVolume, XF86MonBrightnessUp, etc.).

        Args:
            key: XF86 key name (e.g., "XF86AudioRaiseVolume", "XF86MonBrightnessUp")

        Raises:
            VNCError: If the monitor socket is unavailable or the command fails
        """
        self._qemu_monitor_cmd(f"sendkey {key}")
        # QEMU processes sendkey immediately; brief pause ensures the
        # key event propagates before the next screenshot or interaction
        time.sleep(0.05)

    def save_vm_snapshot(self, name: str) -> str:
        """Save a VM snapshot via the QEMU monitor savevm command.

        The VM must be started with a machine type that supports snapshots
        (default NixOS VM builds do). Snapshots are saved in the QCOW2 overlay.

        Args:
            name: Snapshot tag (e.g., "pre-test", "golden-base")

        Returns:
            QEMU monitor response text

        Raises:
            VNCError: If the monitor socket is unavailable or savevm fails
        """
        return self._qemu_monitor_cmd(f"savevm {name}")

    def load_vm_snapshot(self, name: str) -> str:
        """Load a VM snapshot via the QEMU monitor loadvm command.

        Restores the VM to a previously saved snapshot state.
        This resets CPU, memory, and device state — the VM resumes
        from the exact point the snapshot was taken.

        Args:
            name: Snapshot tag to restore (e.g., "pre-test", "golden-base")

        Returns:
            QEMU monitor response text

        Raises:
            VNCError: If the monitor socket is unavailable or loadvm fails
        """
        return self._qemu_monitor_cmd(f"loadvm {name}")

    def monitor_socket_available(self) -> bool:
        """Check if the QEMU monitor socket exists and is connectable."""
        if not os.path.exists(self._monitor_socket_path):
            return False
        try:
            sock = self._qemu_monitor_connect()
            sock.close()
            return True
        except VNCError:
            return False

    def is_reachable(self) -> bool:
        """Quick check: is the VNC server reachable right now?"""
        return self.wait_for_server(timeout=1)
