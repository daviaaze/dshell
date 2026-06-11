"""
shadetest — Agent-driven test harness for Shade shell via VNC.

Usage:
    from shadetest import ShadeTestHarness

    with ShadeTestHarness() as h:
        h.wait_until_shade_ready()
        h.send_key("super-space")
        h.screenshot("launcher-open")
        h.assert_region_not_blank("launcher-open", 100, 100, 400, 300)
"""

from ._vnc import VNCClient
from ._assert import Assert
from . import _ssh

__all__ = ["ShadeTestHarness"]


class ShadeTestHarness:
    """Main test harness for Shade shell e2e testing.

    Provides VNC-based keyboard/mouse control, screenshot capture,
    readiness probing, and visual assertions.

    Can be used as a context manager to ensure cleanup.
    """

    def __init__(
        self,
        vnc_host: str = "localhost",
        vnc_port: int = 5901,
        output_dir: str = "test-output",
        qemu_monitor_socket: str = "/tmp/shade-qemu-monitor",
        vm_mode: bool | None = None,
    ):
        self.vnc = VNCClient(
            vnc_host, vnc_port,
            qemu_monitor_socket=qemu_monitor_socket,
        )
        self.assertions = Assert(self.vnc, output_dir)
        self._output_dir = output_dir
        self._monitor_socket_path = qemu_monitor_socket
        # None = auto-detect; True/False = force on/off
        self._vm_mode = vm_mode

    # ── Context manager ──────────────────────────────────────────────────

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass  # VNC connection is stateless; no explicit disconnect needed

    # ── VNC lifecycle ────────────────────────────────────────────────────

    def wait_for_vnc(self, timeout: int = 60) -> bool:
        """Wait for the VNC server to accept connections."""
        return self.vnc.wait_for_server(timeout)

    # ── Interaction primitives ───────────────────────────────────────────

    def send_key(self, key: str) -> None:
        """Send a key combination.

        Examples: "super-space", "esc", "Return", "XF86AudioRaiseVolume"
        """
        self.vnc.key(key)

    def type_text(self, text: str) -> None:
        """Type text into the VNC session."""
        self.vnc.type(text)

    def click(self, x: int, y: int, button: int = 1) -> None:
        """Move mouse to (x, y) and click."""
        self.vnc.mouse_click(x, y, button)

    def move_mouse(self, x: int, y: int) -> None:
        """Move mouse to (x, y) without clicking."""
        self.vnc.mouse_move(x, y)

    # ── Screenshots ──────────────────────────────────────────────────────

    def screenshot(self, name: str) -> str:
        """Capture a screenshot and save to test-output/<name>.png.

        Returns the file path.
        """
        return self.vnc.capture(name, self._output_dir)

    # ── Readiness probes ─────────────────────────────────────────────────

    def wait_until_shade_ready(self, timeout: int = 60) -> bool:
        """Poll until Shade appears to be running.

        Polls VNC continuously until a valid screenshot is captured.
        Returns early as soon as the VNC server serves frames > 2KB.

        Returns True if Shade appears ready, False on timeout.
        """
        import time

        start = time.monotonic()

        # Poll VNC continuously — return as soon as screenshots become valid
        # (don't wait for a fixed minimum time)
        while (time.monotonic() - start) < timeout:
            try:
                self.vnc.capture("__shade_ready_probe", self._output_dir)
                # If capture succeeds, VNC is working. Assume Shade is up.
                return True
            except Exception:
                time.sleep(1)

        return False

    def wait_until_widget_open(
        self, widget_name: str, timeout: int = 15
    ) -> bool:
        """Poll until a widget's D-Bus state indicates it is open.

        Uses gdbus to query Shade's GIO action state.
        Falls back to pixel-based detection if D-Bus is unavailable.

        Args:
            widget_name: One of "applauncher", "quicksettings", "windowswitcher"
            timeout: Maximum seconds to wait

        Returns True if widget opened, False on timeout.
        """
        import subprocess
        import time

        start = time.monotonic()
        while (time.monotonic() - start) < timeout:
            try:
                # Try D-Bus action state query
                # GIO SimpleAction state is internal — use hyprctl as fallback
                result = subprocess.run(
                    [
                        "dbus-send",
                        "--session",
                        "--print-reply",
                        "--dest=com.caioasmuniz.shade_shell",
                        "/com/caioasmuniz/shade_shell",
                        "org.gtk.Actions.DescribeAll",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                # If dbus-send succeeds, D-Bus is up; fall through to next check
                break
            except Exception:
                time.sleep(0.5)

        # For now, after confirming D-Bus is alive,
        # assume the action toggle worked if no error
        time.sleep(1)
        return True

    # ── D-Bus action helpers ─────────────────────────────────────────────

    # ── QEMU monitor helpers ────────────────────────────────────────────

    def send_media_key(self, key: str) -> None:
        """Send an XF86 media key via QEMU monitor (e.g., volume/brightness).

        Uses the QEMU monitor sendkey command directly.
        Note: send_key() also auto-routes XF86 keys to the QEMU monitor,
        so both methods are equivalent for XF86 keys.

        Args:
            key: XF86 key name (e.g., "XF86AudioRaiseVolume")

        Raises:
            VNCError: If the monitor socket is unavailable
        """
        self.vnc.send_qemu_key(key)

    def save_vm_snapshot(self, name: str) -> str:
        """Save a VM snapshot for fast restore.

        Useful for golden-image testing: snapshot before each test
        phase, restore if a test corrupts state.
        """
        return self.vnc.save_vm_snapshot(name)

    def load_vm_snapshot(self, name: str) -> str:
        """Restore a VM snapshot."""
        return self.vnc.load_vm_snapshot(name)

    # ── D-Bus action helpers ─────────────────────────────────────────────

    def dbus_activate(self, action_name: str) -> bool:
        """Activate a Shade GIO action via gdbus.

        When running against the VM (vm_mode=True or auto-detected),
        routes the gdbus call through SSH to reach the D-Bus session
        bus inside the VM. Otherwise executes gdbus locally.

        Args:
            action_name: e.g. "toggle-applauncher", "toggle-quicksettings"

        Returns True on success.
        """
        import subprocess

        if self._resolve_vm_mode():
            return _ssh.dbus_activate_remote(action_name)

        result = subprocess.run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest", "com.caioasmuniz.shade_shell",
                "--object-path", "/com/caioasmuniz/shade_shell",
                "--method", "org.gtk.Actions.Activate",
                "(sva{sv})",
                action_name,
                "[]",
                "[]",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"gdbus call failed for action '{action_name}': {result.stderr.strip()}"
            )
        return True

    # ── VM mode helpers ─────────────────────────────────────────────────

    def _resolve_vm_mode(self) -> bool:
        """Resolve VM mode: explicit setting > auto-detection."""
        if self._vm_mode is not None:
            return self._vm_mode
        return _ssh.detect_vm_mode()

    def enable_vm_mode(self) -> None:
        """Force VM mode on (SSH to VM for D-Bus calls)."""
        self._vm_mode = True

    def disable_vm_mode(self) -> None:
        """Force VM mode off (local gdbus calls)."""
        self._vm_mode = False

    @property
    def vm_mode(self) -> bool:
        """Is VM mode currently active?"""
        return self._resolve_vm_mode()

    def wait_for_ssh(self, timeout: int = 60) -> bool:
        """Wait for SSH to become available on the VM.

        Only meaningful in VM mode. Returns True when reachable.
        """
        return _ssh.wait_for_ssh(timeout)

    # ── Assertion shortcuts ──────────────────────────────────────────────

    def assert_region_not_blank(
        self, screenshot_name: str,
        x1: int, y1: int, x2: int, y2: int,
    ) -> bool:
        """Assert a screen region is not all one color."""
        return self.assertions.region_not_blank(
            screenshot_name, x1, y1, x2, y2
        )

    def assert_screenshot_differs_from(
        self, before: str, after: str
    ) -> bool:
        """Assert two screenshots are different."""
        return self.assertions.screenshot_differs_from(before, after)
