"""Behavioral tests for the VM workflow runner's timing report."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
RUNNER = SCRIPT_DIR / "vm-workflow-test.py"
sys.path.insert(0, str(SCRIPT_DIR))


class WorkflowTimingReportTests(unittest.TestCase):
    def load_runner(self):
        spec = importlib.util.spec_from_file_location("vm_workflow_test", RUNNER)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_results_include_elapsed_phase_and_slowest_command_metrics(self) -> None:
        module = self.load_runner()
        with tempfile.TemporaryDirectory() as temporary:
            runner = object.__new__(module.WorkflowTest)
            runner.artifacts = Path(temporary)
            runner.results = []
            runner.started_at = time.monotonic() - 10.0
            runner.phase_timings = {"nix_build": 2.5, "guest_boot": 3.0}
            runner.command_timings = [
                {"label": "building vm-vnc", "duration_seconds": 2.5, "returncode": 0},
                {"label": "waiting for guest", "duration_seconds": 0.75, "returncode": 0},
            ]

            runner.record_result("capture", "PASS", {"screenshot": "guest.png"}, 2.25)

            report = json.loads((runner.artifacts / "results.json").read_text())

        self.assertIn("timings", report)
        timings = report["timings"]
        self.assertGreaterEqual(timings["elapsed_seconds"], 10.0)
        self.assertEqual(timings["scenario_seconds"], 2.25)
        self.assertEqual(timings["phase_seconds"], {"nix_build": 2.5, "guest_boot": 3.0})
        self.assertEqual(timings["command_count"], 2)
        self.assertEqual(timings["command_seconds"], 3.25)
        self.assertEqual(timings["slowest_commands"][0]["label"], "building vm-vnc")
        self.assertEqual(timings["scenario_status_counts"], {"PASS": 1})

    def test_saved_accessibility_evidence_stops_at_depth_ten(self) -> None:
        runner_module = self.load_runner()
        spec = importlib.util.spec_from_file_location(
            "vm_workflow_accessibility", SCRIPT_DIR / "vm-workflow-accessibility.py"
        )
        assert spec is not None and spec.loader is not None
        accessibility = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(accessibility)

        class DeepTree(accessibility.Atspi):
            def summary(self, destination, path):
                return {
                    "bus": destination,
                    "path": path,
                    "name": path,
                    "role": "node",
                    "bounds": None,
                }

            def children(self, destination, path):
                index = 0 if path == accessibility.ROOT_PATH else int(path.rsplit("/", 1)[1])
                return [] if index >= 20 else [{"bus": destination, "path": f"/{index + 1}"}]

        def capture_tree(_label, *arguments):
            parsed = accessibility.make_parser().parse_args(list(arguments))
            return accessibility.command_tree(DeepTree("unused"), parsed)

        with tempfile.TemporaryDirectory() as temporary:
            runner = object.__new__(runner_module.WorkflowTest)
            runner.artifacts = Path(temporary)
            runner.accessibility = capture_tree
            saved_path = runner.save_accessibility_tree("deep-tree")
            saved = json.loads(saved_path.read_text())

        def max_depth(node, depth=0):
            return max([depth] + [max_depth(child, depth + 1) for child in node["children"]])

        self.assertEqual(max_depth(saved), 10)


if __name__ == "__main__":
    unittest.main()
