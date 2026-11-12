from __future__ import annotations

import importlib.util
import json
import os
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
import vm_dev_fast as fast


class FastVmTests(unittest.TestCase):
    def test_scene_loader_accepts_steps_and_rejects_bad_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            scene = Path(temporary) / "scene.json"
            scene.write_text(json.dumps({"steps": [
                {"run": "toggle-settings"}, {"key": ["down", "enter"]},
                {"click": [10, 20]}, {"sleep": 0.2}, {"shot": "settings", "diff": True},
            ]}))
            self.assertEqual(len(fast.load_scenes(scene)), 5)
            scene.write_text(json.dumps([{"sleep": -1}]))
            with self.assertRaises(fast.FastError):
                fast.load_scenes(scene)
            scene.write_text(json.dumps([{"shot": "a", "run": "x"}]))
            with self.assertRaises(fast.FastError):
                fast.load_scenes(scene)

    def test_diff_percentage_uses_changed_pixel_count_and_dimensions(self):
        def png(path: Path, width: int, height: int):
            path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 4 + b"IHDR" + struct.pack(">II", width, height))
        with tempfile.TemporaryDirectory() as temporary:
            old, new = Path(temporary) / "old.png", Path(temporary) / "new.png"
            png(old, 10, 10)
            png(new, 10, 10)
            def run(argv, **kwargs):
                class Result:
                    returncode = 1
                    stderr = "25 (0.25%)"
                    stdout = ""
                return Result()
            result = fast.compare_images("magick", old, new, Path(temporary) / "diff.png", run=run)
            self.assertEqual(result["changed"], 25)
            self.assertEqual(result["total"], 100)
            self.assertEqual(result["percent"], 25.0)

    def test_fast_sync_refuses_locked_state_before_build_or_upload(self):
        class Dev:
            def locked(self):
                return True
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(fast.FastError, "session is locked"):
                fast.fast_sync(Dev(), {"shade_path": "/nix/store/test"}, Path(temporary), locked=Dev().locked, shell_ready=lambda: True)

    def test_fast_sync_requires_a_full_sync_baseline(self):
        class Dev:
            def locked(self):
                return False
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(fast.FastError, "run .*sync.* once"):
                fast.fast_sync(Dev(), {"shade_path": "/nix/store/test"}, Path(temporary), locked=Dev().locked, shell_ready=lambda: True)

    def test_launcher_preserves_quoted_environment_and_path_prefix(self):
        value = "value with space ' $HOME"
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            probe = home / ".local/share/shade-dev/shell-wrapped.js"
            probe.parent.mkdir(parents=True)
            probe.write_text(
                f"#!{sys.executable}\n"
                "import os\n"
                "print(os.environ['A'])\n"
                "print(os.environ['PATH'])\n"
            )
            probe.chmod(0o755)
            script = home / "launch.sh"
            ops = [("set", "HOME", temporary), ("set", "A", value)]
            outputs = []
            for additional in ([], [("prefix", "PATH", ":", "/nix/bin")]):
                script.write_text(fast.render_launch(ops + additional))
                script.chmod(0o755)
                result = subprocess.run(
                    [str(script)],
                    env=dict(os.environ, HOME=temporary, PATH="/usr/bin:/bin"),
                    text=True, capture_output=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                outputs.append(result.stdout.splitlines())
            self.assertEqual(outputs[0][0], value)
            self.assertEqual(outputs[1], [value, "/nix/bin:" + outputs[0][1]])

    def test_nix_fingerprint_covers_prelogin_renderer_and_model(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inputs = (
                root / "apps/shell/src/compositor.ts",
                root / "packages/services/src/compositor/entry.ts",
                root / "packages/compositor-model/index.ts",
            )
            for path in inputs:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("initial")
            baseline = fast.nix_fingerprint(root)
            for path in inputs:
                path.write_text("changed")
                self.assertNotEqual(fast.nix_fingerprint(root), baseline, str(path))
                path.write_text("initial")


if __name__ == "__main__":
    unittest.main()
