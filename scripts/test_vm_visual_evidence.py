"""Behavioral tests for frame-level VM visual evidence selection."""

from __future__ import annotations

import importlib.util
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("vm_visual_evidence.py")


class VisualEvidenceTests(unittest.TestCase):
    def make_video(self, directory: Path, *, flash_at: int | None, codec: str = "ffv1") -> Path:
        for index in range(10):
            shade = 0 if index == flash_at else 255
            (directory / f"frame-{index:02}.ppm").write_bytes(
                b"P6\n64 64\n255\n" + bytes([shade, shade, shade]) * (64 * 64)
            )
        video = directory / ("capture.mp4" if codec == "libx264" else "capture.mkv")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-framerate", "10", "-i", str(directory / "frame-%02d.ppm"),
             "-c:v", codec, *(["-pix_fmt", "yuv420p"] if codec == "libx264" else []), str(video)],
            check=True,
            capture_output=True,
        )
        return video

    def analyze(self, video: Path, **options) -> dict:
        spec = importlib.util.spec_from_file_location("vm_visual_evidence", MODULE)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.analyze_video(video, (0, 0, 64, 64), **options)

    def test_single_frame_flash_is_kept_with_surrounding_context(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            analysis = self.analyze(self.make_video(Path(temporary), flash_at=4))
        self.assertEqual(analysis["frame_count"], 10)
        self.assertIn(4, analysis["change_frames"])
        self.assertIn(5, analysis["change_frames"])
        self.assertTrue({0, 3, 4, 5, 9}.issubset(analysis["keyframes"]))
        self.assertEqual(len(analysis["frame_times"]), 10)

    def test_static_video_keeps_coverage_without_false_transitions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            analysis = self.analyze(self.make_video(Path(temporary), flash_at=None))
        self.assertEqual(analysis["change_frames"], [])
        self.assertEqual(analysis["keyframes"], [0, 9])

    def test_h264_encoder_metadata_does_not_corrupt_frame_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            analysis = self.analyze(self.make_video(Path(temporary), flash_at=4, codec="libx264"))
        self.assertEqual(analysis["frame_count"], 10)
        self.assertIn(4, analysis["change_frames"])

    def test_event_sample_is_kept_even_without_a_visual_transition(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            analysis = self.analyze(
                self.make_video(Path(temporary), flash_at=None), sample_times=[0.45]
            )
        self.assertEqual(analysis["keyframes"], [0, 5, 9])

    def test_subsampled_video_preserves_odd_native_roi_dimensions(self) -> None:
        spec = importlib.util.spec_from_file_location("vm_visual_evidence", MODULE)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            evidence = module.render_evidence(
                self.make_video(directory, flash_at=None, codec="libx264"),
                (1, 1, 3, 5), directory / "evidence", label="odd-native-roi",
            )
            for image in evidence["keyframe_pngs"]:
                self.assertEqual(struct.unpack(">II", Path(image).read_bytes()[16:24]), (3, 5))


if __name__ == "__main__":
    unittest.main()
