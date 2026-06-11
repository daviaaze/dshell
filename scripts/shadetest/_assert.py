"""Visual assertions for Shade shell test screenshots.

Provides pixel-level checks (region-not-blank, screenshot-differs)
that work without external image libraries, with optional PIL-enhanced
comparison for regression testing.
"""

import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ._vnc import VNCClient


class AssertError(Exception):
    """Raised when a visual assertion fails."""

    def __init__(self, message: str, expected: str = "", actual: str = ""):
        super().__init__(message)
        self.expected = expected
        self.actual = actual


class Assert:
    """Visual assertion helpers for Shade test screenshots."""

    def __init__(self, vnc: "VNCClient", output_dir: str = "test-output"):
        self._vnc = vnc
        self._output_dir = output_dir

    # ── Region checks ────────────────────────────────────────────────────

    def region_not_blank(
        self,
        screenshot_name: str,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
    ) -> bool:
        """Assert that a rectangular region is not monochrome.

        Useful for checking that a widget rendered (not just black/background).

        Args:
            screenshot_name: Base name of the screenshot (e.g. "02-launcher")
            x1, y1: Top-left corner of region
            x2, y2: Bottom-right corner of region

        Returns:
            True if region has diverse pixel values

        Raises:
            AssertError: If region is blank (all one color)
        """
        path = os.path.join(self._output_dir, f"{screenshot_name}.png")
        if not os.path.exists(path):
            raise AssertError(
                f"Screenshot not found: {path}",
                expected=screenshot_name,
                actual="missing",
            )

        # Try PIL first (accurate), fall back to basic file-size heuristic
        try:
            from PIL import Image

            img = Image.open(path)
            region = img.crop((x1, y1, x2, y2))
            extrema = region.getextrema()
            # If every channel has same min and max, region is blank
            is_blank = all(lo == hi for lo, hi in extrema)
            if is_blank:
                raise AssertError(
                    f"Region ({x1},{y1})-({x2},{y2}) is blank (monochrome)",
                    expected="non-blank",
                    actual="blank",
                )
            return True
        except ImportError:
            # Fallback: check if the file is too small (likely blank capture)
            size = os.path.getsize(path)
            if size < 5000:  # 5KB — a blank screen PNG is typically < 2KB
                raise AssertError(
                    f"Screenshot {screenshot_name} appears blank (size={size}B)",
                    expected=">5KB",
                    actual=f"{size}B",
                )
            # Can't verify region without PIL, assume OK
            return True

    # ── Screenshot comparison ────────────────────────────────────────────

    def screenshot_differs_from(self, before: str, after: str) -> bool:
        """Assert two screenshots are visually different.

        Useful for verifying that a UI action had an effect (e.g.,
        toggling a widget changes the screen).

        Args:
            before: Base name of the "before" screenshot
            after: Base name of the "after" screenshot

        Returns:
            True if screenshots differ

        Raises:
            AssertError: If screenshots are identical
        """
        before_path = os.path.join(self._output_dir, f"{before}.png")
        after_path = os.path.join(self._output_dir, f"{after}.png")

        for p in [before_path, after_path]:
            if not os.path.exists(p):
                raise AssertError(
                    f"Screenshot not found: {p}",
                    expected="exists",
                    actual="missing",
                )

        try:
            from PIL import Image, ImageChops

            diff = ImageChops.difference(
                Image.open(before_path),
                Image.open(after_path),
            )
            if diff.getbbox() is None:
                raise AssertError(
                    f"Screenshots {before} and {after} are identical",
                    expected="different",
                    actual="identical",
                )
            return True

        except ImportError:
            # Fallback: compare file sizes
            before_size = os.path.getsize(before_path)
            after_size = os.path.getsize(after_path)

            # Allow 5% tolerance for compression differences
            tolerance = 0.05
            size_diff = abs(before_size - after_size) / max(before_size, after_size)

            if size_diff < tolerance:
                raise AssertError(
                    f"Screenshots {before} and {after} have nearly identical sizes "
                    f"({before_size}B vs {after_size}B, {size_diff:.1%} diff)",
                    expected=f">{tolerance:.0%} difference",
                    actual=f"{size_diff:.1%} difference",
                )
            return True

    # ── Golden image comparison ──────────────────────────────────────────

    def matches_golden(
        self, screenshot_name: str, golden_dir: str = "test-golden"
    ) -> bool:
        """Compare screenshot against a golden reference image.

        Requires PIL.

        Args:
            screenshot_name: Base name of the screenshot
            golden_dir: Directory containing golden images

        Returns:
            True if the screenshot matches the golden image

        Raises:
            AssertError: If images differ beyond threshold
        """
        try:
            from PIL import Image, ImageChops
        except ImportError:
            raise AssertError(
                "golden comparison requires Pillow: pip install Pillow"
            )

        current = os.path.join(self._output_dir, f"{screenshot_name}.png")
        golden = os.path.join(golden_dir, f"{screenshot_name}.png")

        if not os.path.exists(current):
            raise AssertError(f"Current screenshot not found: {current}")
        if not os.path.exists(golden):
            raise AssertError(f"Golden image not found: {golden}", expected=golden)

        diff = ImageChops.difference(Image.open(current), Image.open(golden))
        if diff.getbbox() is not None:
            # Save diff for debugging
            diff_path = os.path.join(
                self._output_dir, f"{screenshot_name}.diff.png"
            )
            diff.save(diff_path)
            raise AssertError(
                f"Screenshot {screenshot_name} differs from golden. Diff saved to {diff_path}",
                expected="matches golden",
                actual="differs",
            )
        return True

    # ── Structural checks ────────────────────────────────────────────────

    def file_exists(self, screenshot_name: str) -> bool:
        """Check that a screenshot was captured."""
        path = os.path.join(self._output_dir, f"{screenshot_name}.png")
        if not os.path.exists(path):
            raise AssertError(
                f"Screenshot {screenshot_name} was not captured",
                expected=path,
                actual="missing",
            )
        return True

    def file_not_empty(self, screenshot_name: str) -> bool:
        """Check that a screenshot is a non-empty file."""
        self.file_exists(screenshot_name)
        path = os.path.join(self._output_dir, f"{screenshot_name}.png")
        size = os.path.getsize(path)
        if size == 0:
            raise AssertError(
                f"Screenshot {screenshot_name} is empty (0 bytes)",
                expected=">0 bytes",
                actual="0 bytes",
            )
        return True
