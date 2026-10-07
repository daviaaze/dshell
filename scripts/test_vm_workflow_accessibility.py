import argparse
import importlib.util
from pathlib import Path
import unittest


MODULE = Path(__file__).with_name("vm-workflow-accessibility.py")
SPEC = importlib.util.spec_from_file_location("vm_workflow_accessibility", MODULE)
assert SPEC is not None and SPEC.loader is not None
ACCESSIBILITY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACCESSIBILITY)


class FakeAtspi:
    def __init__(self):
        self.graph = {
            (ACCESSIBILITY.REGISTRY, ACCESSIBILITY.ROOT_PATH): [("app", "/app")],
            ("app", "/app"): [("app", "/target"), ("app", "/other")],
            ("app", "/target"): [("app", "/child")],
            ("app", "/child"): [],
            ("app", "/other"): [],
        }
        self.names = {"/target": "Quick Settings", "/other": "Other", "/child": "Child"}
        self.roles = {"/target": "panel"}
        self.bounds_calls = 0

    def summary(self, destination, path):
        return {
            "bus": destination,
            "path": path,
            "name": self.names.get(path, ""),
            "role": self.roles.get(path, "application"),
            "bounds": None,
        }

    def node(self, destination, path):
        node = self.summary(destination, path)
        node["bounds"] = self.bounds(destination, path)
        return node

    def bounds(self, destination, path):
        self.bounds_calls += 1
        return [1, 2, 300, 400]

    def property_string(self, destination, path, interface, name):
        if name == "Name":
            return self.names.get(path, "")
        raise ACCESSIBILITY.AccessibilityError("property unavailable")

    def string(self, destination, path, method):
        if method == "GetRoleName":
            return self.roles.get(path, "application")
        raise ACCESSIBILITY.AccessibilityError("method unavailable")

    def children(self, destination, path):
        return [{"bus": bus, "path": child} for bus, child in self.graph[(destination, path)]]

    def tree(self, destination, path, depth, max_depth, budget, include_bounds=True):
        node = self.node(destination, path) if include_bounds else self.summary(destination, path)
        node["children"] = []
        if depth < max_depth:
            for bus, child in self.graph[(destination, path)]:
                if budget[0] >= budget[1]:
                    node["truncated"] = True
                    break
                budget[0] += 1
                node["children"].append(
                    self.tree(bus, child, depth + 1, max_depth, budget, include_bounds)
                )
        return node


def args(**overrides):
    values = {
        "name": "Quick Settings",
        "role": "panel",
        "description_match": False,
        "max_depth": 8,
        "max_nodes": 100,
        "no_bounds": False,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


class AccessibilityTraversalTests(unittest.TestCase):
    def test_locate_reads_bounds_only_for_the_unique_match(self):
        atspi = FakeAtspi()
        found = ACCESSIBILITY.locate(atspi, args())
        self.assertEqual((found["name"], found["role"], found["bounds"]),
                         ("Quick Settings", "panel", [1, 2, 300, 400]))
        self.assertEqual(atspi.bounds_calls, 1)

    def test_locate_still_rejects_ambiguous_matches(self):
        atspi = FakeAtspi()
        atspi.names["/other"] = "Quick Settings"
        atspi.roles["/other"] = "panel"
        with self.assertRaisesRegex(ACCESSIBILITY.AccessibilityError, "2 nodes"):
            ACCESSIBILITY.locate(atspi, args())
        self.assertEqual(atspi.bounds_calls, 0)

    def test_tree_can_skip_bounds_for_evidence_snapshots(self):
        atspi = FakeAtspi()
        tree = ACCESSIBILITY.command_tree(atspi, args(no_bounds=True))
        self.assertEqual(atspi.bounds_calls, 0)
        self.assertIsNone(tree["bounds"])

    def test_tree_keeps_bounds_by_default(self):
        atspi = FakeAtspi()
        ACCESSIBILITY.command_tree(atspi, args())
        self.assertEqual(atspi.bounds_calls, 6)


if __name__ == "__main__":
    unittest.main()
