"""Offline contracts for the isolated Hyprland UI harness."""
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import threading
from unittest.mock import patch
import zlib

MODULE_DIR = Path(__file__).parent / "ui-headless"
sys.path.insert(0, str(MODULE_DIR))
try:
    import core as ui
except ImportError:
    ui = None
from session import Session, parse_variant


def png_bytes(width, height, rows, color_type=2):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(b"\0" + row for row in rows))) + chunk(b"IEND", b""))


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(ui, "ui-headless/core.py must provide the offline harness contracts")

    def test_parse_sizes_and_scales(self):
        self.assertEqual(ui.parse_sizes("1280x720,1920x1080"), [(1280, 720), (1920, 1080)])
        self.assertEqual(ui.parse_scales("1,1.5"), [1.0, 1.5])
        for value in ("0x720", "1280x-1", "1920x1080;bad", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ui.parse_sizes(value)
        for value in ("0", "-1", "nan", "inf", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ui.parse_scales(value)

    def test_config_disables_real_panel_and_uses_fractional_scale(self):
        config = ui.hyprland_config((1280, 720), 1.5, Path("/tmp/private shell.sh"))
        self.assertIn('output = "eDP-1", disabled = true', config)
        self.assertIn('mode = "1280x720@60"', config)
        self.assertIn('scale = 1.5', config)
        self.assertIn('disable_scale_checks = true', config)
        self.assertIn('animations = {enabled = false}', config)
        self.assertIn('output create headless TEST-1', config)
        self.assertNotIn('AQ_BACKENDS', config)

    def test_process_cleanup_matches_only_private_runtime(self):
        root = Path("/tmp/shade-ui-own")
        self.assertTrue(ui.owns_environment(b"XDG_RUNTIME_DIR=/tmp/shade-ui-own/worker/runtime\0PATH=x\0", root))
        self.assertFalse(ui.owns_environment(b"XDG_RUNTIME_DIR=/tmp/shade-ui-other/runtime\0", root))
        self.assertFalse(ui.owns_environment(b"XDG_RUNTIME_DIR=/tmp/shade-ui-own-other/runtime\0", root))
        self.assertFalse(ui.owns_environment(b"XDG_RUNTIME_DIR=/run/user/1000\0", root))
        self.assertFalse(ui.owns_environment(b"NO_XDG_RUNTIME_DIR=/tmp/shade-ui-own/worker\0", root))

    def test_layer_bounds_use_logical_not_physical_pixels(self):
        monitor = {"x": 0, "y": 0, "width": 1280, "height": 720, "scale": 1.5, "transform": 0}
        layer = {"namespace": "shade-launcher", "x": 52, "y": 4, "w": 648, "h": 472}
        self.assertEqual(ui.layer_assertions(layer, monitor), {"layer_present": True, "inside_monitor": True, "no_horizontal_overflow": True})
        layer["h"] = 480
        self.assertFalse(ui.layer_assertions(layer, monitor)["inside_monitor"])
        layer.update(h=400, w=810)
        self.assertFalse(ui.layer_assertions(layer, monitor)["no_horizontal_overflow"])
        self.assertFalse(ui.layer_assertions(None, monitor)["layer_present"])

    def test_layers_select_namespace_on_expected_output(self):
        data = {"TEST-1": {"levels": {"2": [{"namespace": "shade-launcher", "x": 52, "y": 4, "w": 648, "h": 472}]}}, "eDP-1": {"levels": {"2": [{"namespace": "shade-launcher"}]}}}
        self.assertEqual(ui.find_layer(data, "shade-launcher")["w"], 648)
        self.assertIsNone(ui.find_layer(data, "shade-missing"))

    def test_png_dimensions_and_region_detect_real_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.png"
            path.write_bytes(png_bytes(2, 2, [b"\0\0\0\0\0\0", b"\0\0\0\xff\0\0"]))
            image = ui.read_png(path)
            self.assertEqual((image.width, image.height), (2, 2))
            self.assertTrue(image.region_nonuniform((0, 0, 2, 2)))
            self.assertFalse(image.region_nonuniform((0, 0, 2, 1)))
            self.assertEqual(image.changed_pixels(image, (0, 0, 2, 2)), 0)
            uniform = Path(directory) / "uniform.png"
            uniform.write_bytes(png_bytes(2, 2, [b"\0" * 6] * 2))
            self.assertEqual(image.changed_pixels(ui.read_png(uniform), (0, 0, 2, 2)), 1)

    def test_png_filter_reconstruction(self):
        self.assertEqual(ui.unfilter_row(1, bytes([10, 20, 30, 1, 2, 3]), bytes(6), 3), bytes([10, 20, 30, 11, 22, 33]))
        self.assertEqual(ui.unfilter_row(2, bytes([1, 2, 3]), bytes([10, 20, 30]), 3), bytes([11, 22, 33]))
        self.assertEqual(ui.unfilter_row(3, bytes([1, 2, 3]), bytes([10, 20, 30]), 3), bytes([6, 12, 18]))
        self.assertEqual(ui.unfilter_row(4, bytes([1, 2, 3]), bytes([10, 20, 30]), 3), bytes([11, 22, 33]))
        with self.assertRaises(ValueError):
            ui.unfilter_row(9, b"x", b"x", 1)

    def test_scene_loader_rejects_commands_that_could_touch_host(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unsafe.json"
            path.write_text(json.dumps({"namespace": "shade-launcher", "steps": [{"run": "shutdown"}]}))
            with self.assertRaisesRegex(ValueError, "action"):
                ui.load_scene(path)
            path.write_text(json.dumps({"namespace": "shade-launcher", "steps": [{"run": "toggle-applauncher"}, {"shot": "../escape"}]}))
            with self.assertRaisesRegex(ValueError, "shot"):
                ui.load_scene(path)

    def test_built_in_scenes_use_only_safe_actions(self):
        for path in (MODULE_DIR / "scenes").glob("*.json"):
            self.assertIn("steps", ui.load_scene(path))

    def test_pixel_difference_ignores_only_bounded_dither(self):
        baseline = ui.PNG(1, 1, 3, bytes([100, 100, 100]))
        dither = ui.PNG(1, 1, 3, bytes([101, 99, 102]))
        panel = ui.PNG(1, 1, 3, bytes([240, 240, 240]))
        self.assertEqual(dither.changed_pixels(baseline, (0, 0, 1, 1), tolerance=3), 0)
        self.assertEqual(panel.changed_pixels(baseline, (0, 0, 1, 1), tolerance=3), 1)


    def test_capture_scale_preserves_physical_fractional_dimensions(self):
        import math
        self.assertTrue(hasattr(ui, "capture_scale"), "capture scale must account for rounded Wayland logical extents")
        for width, height in ((1280, 720), (1920, 1080), (2560, 1440)):
            for scale in (1, 1.5):
                with self.subTest(width=width, height=height, scale=scale):
                    monitor = {"width": width, "height": height, "scale": scale}
                    capture_scale = ui.capture_scale(monitor)
                    logical_width = math.floor(width / scale + .5)
                    logical_height = math.floor(height / scale + .5)
                    self.assertEqual((int(logical_width * capture_scale), int(logical_height * capture_scale)), (width, height))


class DriverTests(unittest.TestCase):
    def test_session_environment_never_retargets_parent(self):
        import os
        original = os.environ.copy()
        session = Session(Path("/tmp/shu-test/0"), Path("/tmp/output"), (1280, 720), 1.5, threading.Event())
        self.assertEqual(os.environ, original)
        self.assertEqual(session.env["XDG_RUNTIME_DIR"], "/tmp/shu-test/0/r")
        self.assertEqual(session.env["GSETTINGS_BACKEND"], "memory")
        self.assertNotIn("DBUS_SESSION_BUS_ADDRESS", session.env)
        self.assertNotIn("HYPRLAND_INSTANCE_SIGNATURE", session.env)
        self.assertNotIn("WAYLAND_DISPLAY", session.env)
        self.assertEqual(session.env["LIBSEAT_BACKEND"], "noop")

    def test_input_refuses_to_target_undiscovered_session(self):
        session = Session(Path("/tmp/shu-test/0"), Path("/tmp/output"), (1280, 720), 1, threading.Event())
        with self.assertRaisesRegex(RuntimeError, "discovered"):
            session.key("Escape")

    def test_keyboard_chords_and_text_are_passed_without_a_shell(self):
        session = Session(Path("/tmp/shu-test/0"), Path("/tmp/output"), (1280, 720), 1, threading.Event())
        with patch.object(session, "command") as command:
            session.key("Ctrl+Shift+a")
            command.assert_called_once_with("wtype", "-M", "ctrl", "-M", "shift", "-k", "a", "-m", "shift", "-m", "ctrl")
            command.reset_mock()
            session.type("a; no shell interpolation")
            command.assert_called_once_with("wtype", "-d", "30", "--", "a; no shell interpolation")

    def test_foreign_toast_cannot_pass_for_an_opaque_panel(self):
        size = 32
        baseline = ui.PNG(size, size, 3, bytes(size * size * 3))
        layer = {"namespace": "shade-launcher", "x": 0, "y": 0, "w": size, "h": size}
        layers = {"TEST-1": {"levels": {"2": [layer]}}}
        opaque = bytearray([240] * (size * size * 3))
        opaque[(10 * size + 10) * 3:(10 * size + 10) * 3 + 3] = bytes(3)
        toast = bytearray(size * size * 3)
        for y in range(8, 18):
            for x in range(8, 18):
                toast[(y * size + x) * 3:(y * size + x) * 3 + 3] = bytes([240] * 3)
        for pixels, expected in ((opaque, True), (toast, False)):
            with self.subTest(opaque=expected):
                session = Session(Path("/tmp/shu-test/0"), Path("/tmp/output"), (size, size), 1, threading.Event())
                session.monitor = {"width": size, "height": size, "scale": 1}
                image = ui.PNG(size, size, 3, bytes(pixels))
                with patch.object(session, "layers", return_value=layers), patch.object(session, "capture", return_value=("capture.png", image)), patch.object(session.cancel, "wait"), patch("session.time.monotonic", side_effect=[0, 1, 9]):
                    capture = session.capture_panel("launcher", "shade-launcher", baseline)
                self.assertEqual(capture["assertions"]["drawn_pixels"], expected)

    def test_baseline_settles_thumbnails_then_decodes_one_full_frame(self):
        session = Session(Path("/tmp/shu-test/0"), Path("/tmp/output"), (1280, 720), 1.5, threading.Event())
        session.monitor = {"reserved": [52, 0, 0, 0]}
        thumbnail = ui.PNG(160, 90, 3, bytes(160 * 90 * 3))
        clock = iter(value / 4 for value in range(100))
        with patch.object(session, "command") as command, patch.object(session, "capture", return_value=("baseline.png", thumbnail)) as capture, patch("session.read_png", return_value=thumbnail), patch.object(session.cancel, "wait"), patch("session.time.monotonic", side_effect=lambda: next(clock)):
            self.assertIs(session.capture_baseline("launcher"), thumbnail)
        command.assert_any_call("grim", "-l", "0", "-s", "0.1875", "-o", "TEST-1", "/tmp/shu-test/0/r/settle.png")
        capture.assert_called_once_with("baselines/launcher")

    def test_gvariant_cache_and_child_references_are_data_only(self):
        value = "([(':1.1', objectpath '/org/a11y/atspi/accessible/root')],)"
        self.assertEqual(parse_variant(value), ([(":1.1", "/org/a11y/atspi/accessible/root")],))
        self.assertEqual(parse_variant("(@a(so) [],)"), ([],))
        self.assertEqual(parse_variant("('uint32 75 and @as text', uint32 2)"), ("uint32 75 and @as text", 2))
        with self.assertRaises((SyntaxError, ValueError)):
            parse_variant("__import__('os').system('false')")



if __name__ == "__main__":
    unittest.main()
