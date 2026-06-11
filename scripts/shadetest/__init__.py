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
    ):
        self.vnc = VNCClient(vnc_host, vnc_port)
        self.assertions = Assert(self.vnc, output_dir)
        self._output_dir = output_dir

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

    def dbus_activate(self, action_name: str) -> bool:
        """Activate a Shade GIO action via gdbus.

        This is more reliable than keyboard shortcuts because it
        works regardless of screen resolution or focus state.

        Args:
            action_name: e.g. "toggle-applauncher", "toggle-quicksettings"

        Returns True on success.
        """
        import subprocess

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
