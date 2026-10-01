#!/usr/bin/env python3
"""Query and operate the guest desktop accessibility tree over AT-SPI D-Bus."""

import argparse
import json
import os
import shlex
import subprocess
import sys
import time

REGISTRY = "org.a11y.atspi.Registry"
ROOT_PATH = "/org/a11y/atspi/accessible/root"
ACCESSIBLE = "org.a11y.atspi.Accessible"
ACTION = "org.a11y.atspi.Action"
COMPONENT = "org.a11y.atspi.Component"
SCREEN_COORDS = 0
TIMEOUT = 4.0
COMMAND_TIMEOUT = 30.0
DEFAULT_DEPTH = 16
DEFAULT_NODES = 2000
MAX_DEPTH = 16
MAX_NODES = 2000


class AccessibilityError(Exception):
    pass


def bus_address():
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS") and not os.environ.get("XDG_RUNTIME_DIR"):
        raise AccessibilityError("Cannot locate the user session bus (DBUS_SESSION_BUS_ADDRESS and XDG_RUNTIME_DIR are unset)")
    try:
        result = subprocess.run(
            ["busctl", "--user", "call", "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus", "GetAddress"],
            check=True, capture_output=True, text=True, timeout=TIMEOUT,
        )
    except FileNotFoundError:
        raise AccessibilityError("busctl is not installed")
    except subprocess.TimeoutExpired:
        raise AccessibilityError("Timed out querying org.a11y.Bus.GetAddress on the user session bus")
    except subprocess.CalledProcessError as exc:
        raise AccessibilityError("Could not query the AT-SPI bus address on the user session bus: " + (exc.stderr.strip() or exc.stdout.strip() or "no D-Bus diagnostic"))
    fields = shlex.split(result.stdout)
    if len(fields) != 2 or fields[0] != "s" or not fields[1].startswith("unix:"):
        raise AccessibilityError("org.a11y.Bus.GetAddress returned an unexpected address: " + result.stdout.strip())
    return fields[1]


class Atspi:
    def __init__(self, address):
        self.address = address
        self.deadline = time.monotonic() + COMMAND_TIMEOUT

    def call(self, destination, path, interface, method, *args, signature=None):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise AccessibilityError("AT-SPI command exceeded its %d-second time limit" % COMMAND_TIMEOUT)
        command = ["busctl", "--address=" + self.address, "--timeout=4s", "call", destination, path, interface, method]
        if signature:
            command.append(signature)
        command.extend(map(str, args))
        try:
            result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=min(TIMEOUT, remaining))
        except FileNotFoundError:
            raise AccessibilityError("busctl is not installed")
        except subprocess.TimeoutExpired:
            raise AccessibilityError("Timed out calling %s.%s on %s %s" % (interface, method, destination, path))
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.strip() or exc.stdout.strip() or "no D-Bus diagnostic"
            raise AccessibilityError("D-Bus call %s.%s failed on %s %s: %s" % (interface, method, destination, path, detail))
        try:
            return shlex.split(result.stdout)
        except ValueError as exc:
            raise AccessibilityError("Could not parse %s.%s reply %r: %s" % (interface, method, result.stdout.strip(), exc))


    def property_string(self, destination, path, interface, name):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise AccessibilityError("AT-SPI command exceeded its %d-second time limit" % COMMAND_TIMEOUT)
        command = ["busctl", "--address=" + self.address, "--timeout=4s", "get-property", destination, path, interface, name]
        try:
            result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=min(TIMEOUT, remaining))
        except FileNotFoundError:
            raise AccessibilityError("busctl is not installed")
        except subprocess.TimeoutExpired:
            raise AccessibilityError("Timed out reading %s.%s on %s %s" % (interface, name, destination, path))
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.strip() or exc.stdout.strip() or "no D-Bus diagnostic"
            raise AccessibilityError("D-Bus property %s.%s failed on %s %s: %s" % (interface, name, destination, path, detail))
        fields = shlex.split(result.stdout)
        if len(fields) != 2 or fields[0] != "s":
            raise AccessibilityError("Unexpected %s property reply from %s %s: %r" % (name, destination, path, fields))
        return fields[1]

    def string(self, destination, path, method):
        fields = self.call(destination, path, ACCESSIBLE, method)
        if len(fields) < 2 or fields[0] != "s":
            raise AccessibilityError("Unexpected %s reply from %s %s: %r" % (method, destination, path, fields))
        return fields[1]


    def children(self, destination, path):
        fields = self.call(destination, path, ACCESSIBLE, "GetChildren")
        if len(fields) < 2 or fields[0] != "a(so)":
            raise AccessibilityError("Unexpected GetChildren reply from %s %s: %r" % (destination, path, fields))
        try:
            count = int(fields[1])
            pairs = fields[2:]
            if len(pairs) != count * 2:
                raise ValueError("expected %d object pairs, got %d values" % (count, len(pairs)))
            return [{"bus": pairs[i], "path": pairs[i + 1]} for i in range(0, len(pairs), 2)]
        except (ValueError, IndexError) as exc:
            raise AccessibilityError("Malformed GetChildren reply from %s %s: %r (%s)" % (destination, path, fields, exc))

    def state_words(self, destination, path):
        fields = self.call(destination, path, ACCESSIBLE, "GetState")
        if len(fields) < 2 or fields[0] != "au":
            raise AccessibilityError("Unexpected GetState reply from %s %s: %r" % (destination, path, fields))
        try:
            count = int(fields[1])
            words = [int(value) for value in fields[2:]]
            if len(words) != count:
                raise ValueError("expected %d state words, got %d values" % (count, len(words)))
            return words
        except (ValueError, IndexError) as exc:
            raise AccessibilityError("Malformed GetState reply from %s %s: %r (%s)" % (destination, path, fields, exc))
    def bounds(self, destination, path):
        try:
            fields = self.call(destination, path, COMPONENT, "GetExtents", SCREEN_COORDS, signature="u")
        except AccessibilityError:
            return None
        if len(fields) != 5 or fields[0] not in ("iiii", "(iiii)"):
            return None
        try:
            return [int(value) for value in fields[1:]]
        except ValueError:
            return None

    def node(self, destination, path):
        return {
            "bus": destination,
            "path": path,
            "name": self.property_string(destination, path, ACCESSIBLE, "Name"),
            "role": self.string(destination, path, "GetRoleName"),
            "bounds": self.bounds(destination, path),
        }

    def tree(self, destination, path, depth, max_depth, budget):
        node = self.node(destination, path)
        node["children"] = []
        if depth >= max_depth:
            node["truncated"] = True
            return node
        try:
            children = self.children(destination, path)
        except AccessibilityError as exc:
            node["error"] = str(exc)
            return node
        for child in children:
            if budget[0] >= budget[1]:
                node["truncated"] = True
                break
            budget[0] += 1
            try:
                node["children"].append(self.tree(child["bus"], child["path"], depth + 1, max_depth, budget))
            except AccessibilityError as exc:
                node["children"].append({**child, "error": str(exc)})
        return node

    def actions(self, node):
        fields = self.call(node["bus"], node["path"], ACTION, "GetActions")
        if len(fields) < 2 or fields[0] != "a(sss)":
            raise AccessibilityError("Unexpected GetActions reply for %r: %r" % (node, fields))
        try:
            count = int(fields[1])
            values = fields[2:]
            if count < 0 or count > 128 or len(values) != count * 3:
                raise ValueError("expected %d action triples, got %d values" % (count, len(values)))
            return [
                {"name": values[index], "description": values[index + 1], "keybinding": values[index + 2]}
                for index in range(0, len(values), 3)
            ]
        except (ValueError, IndexError) as exc:
            raise AccessibilityError("Malformed GetActions reply for %r: %r (%s)" % (node, fields, exc))


def bounded(value, default, maximum):
    return max(0, min(value if value is not None else default, maximum))


def get_root(atspi):
    try:
        return atspi.node(REGISTRY, ROOT_PATH)
    except AccessibilityError as exc:
        raise AccessibilityError("AT-SPI registry desktop root is unavailable: " + str(exc))


def locate(atspi, args, want_actions=False):
    root = get_root(atspi)
    budget = [1, bounded(args.max_nodes, DEFAULT_NODES, MAX_NODES)]
    tree = atspi.tree(root["bus"], root["path"], 0, bounded(args.max_depth, DEFAULT_DEPTH, MAX_DEPTH), budget)
    matches = []
    rejected = []
    target = args.name.casefold()
    role = args.role.casefold() if args.role else None
    search_truncated = False
    stack = [tree]
    while stack:
        node = stack.pop()
        search_truncated = search_truncated or node.get("truncated", False)
        role_matches = role is None or node.get("role", "").casefold() == role
        matched = node.get("name", "").casefold() == target
        if not matched and role_matches and getattr(args, "description_match", False):
            try:
                description = atspi.property_string(node["bus"], node["path"], ACCESSIBLE, "Description")
                matched = description.casefold() == target
            except AccessibilityError:
                pass
        if matched and role_matches:
            if want_actions:
                try:
                    node["actions"] = atspi.actions(node)
                except AccessibilityError as exc:
                    node["action_error"] = str(exc)
                if node.get("actions"):
                    matches.append(node)
                else:
                    rejected.append({key: node.get(key) for key in ("name", "role", "bus", "path", "action_error")})
            else:
                matches.append(node)
        stack.extend(reversed(node.get("children", [])))
    if not matches:
        qualifier = " with an available AT-SPI action" if want_actions else ""
        evidence = "; matching nodes without usable actions: " + json.dumps(rejected, ensure_ascii=False) if rejected else ""
        truncation = "; search tree was truncated" if search_truncated else ""
        raise AccessibilityError("No node matched name %r%s%s; searched %d nodes from %s %s%s%s" % (
            args.name, " and role " + repr(args.role) if args.role else "", qualifier, budget[0], root["bus"], root["path"], evidence, truncation))
    if len(matches) != 1:
        evidence = [{key: node.get(key) for key in ("name", "role", "bus", "path", "actions")} for node in matches]
        raise AccessibilityError("Ambiguous match for name %r%s: %d nodes: %s" % (
            args.name, " and role " + repr(args.role) if args.role else "", len(matches), json.dumps(evidence, ensure_ascii=False)))
    return matches[0]


def command_probe(atspi):
    root = get_root(atspi)
    children = atspi.children(root["bus"], root["path"])
    applications = []
    for child in children:
        try:
            applications.append(atspi.node(child["bus"], child["path"]))
        except AccessibilityError as exc:
            applications.append({**child, "error": str(exc)})
    return {
        "available": True,
        "service": {"name": REGISTRY, "bus_address": atspi.address},
        "desktop": root,
        "applications": applications,
    }


def command_tree(atspi, args):
    root = get_root(atspi)
    return atspi.tree(root["bus"], root["path"], 0, bounded(args.max_depth, DEFAULT_DEPTH, MAX_DEPTH), [1, bounded(args.max_nodes, DEFAULT_NODES, MAX_NODES)])


def command_find(atspi, args):
    node = locate(atspi, args)
    if args.include_state:
        node["state_words"] = atspi.state_words(node["bus"], node["path"])
    return node


def command_click(atspi, args):
    node = locate(atspi, args, want_actions=True)
    actions = node["actions"]
    preferred = [i for i, action in enumerate(actions) if action["name"].casefold() in ("click", "press", "activate")]
    if len(preferred) == 1:
        index = preferred[0]
    elif len(actions) == 1:
        index = 0
    else:
        names = [action["name"] for action in actions]
        raise AccessibilityError("Node matched uniquely but has no unambiguous click action; available actions: " + json.dumps(names, ensure_ascii=False))
    action = actions[index]["name"]
    reply = atspi.call(node["bus"], node["path"], ACTION, "DoAction", index, signature="i")
    if len(reply) != 2 or reply[0] != "b":
        raise AccessibilityError("Unexpected DoAction reply for %r action %r: %r" % (node, action, reply))
    if reply[1] != "true":
        raise AccessibilityError("AT-SPI rejected action %r on node %r" % (action, node))
    return {"clicked": True, "action": action, "node": node}


def make_parser():
    parser = argparse.ArgumentParser(description="Inspect and operate the guest Shade accessibility tree")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("probe", help="report the AT-SPI registry desktop and application roots")
    tree = commands.add_parser("tree", help="print a bounded semantic tree")
    find = commands.add_parser("find", help="find one exact accessible name")
    find.add_argument("--include-state", action="store_true", help="include the AT-SPI state bit words for the matched node")
    click = commands.add_parser("click", help="invoke one unambiguous AT-SPI click action")
    for command in (find, click):
        command.add_argument("--description-match", action="store_true", help="also match the AT-SPI accessible description")
    for command in (tree, find, click):
        command.add_argument("--max-depth", type=int, default=DEFAULT_DEPTH)
        command.add_argument("--max-nodes", type=int, default=DEFAULT_NODES)
    for command in (find, click):
        command.add_argument("--name", required=True)
        command.add_argument("--role")
    return parser


def main():
    args = make_parser().parse_args()
    try:
        address = bus_address()
        atspi = Atspi(address)
        result = {"probe": command_probe, "tree": command_tree, "find": command_find, "click": command_click}[args.command](atspi, args) if args.command != "probe" else command_probe(atspi)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except AccessibilityError as exc:
        print("vm-workflow-accessibility: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
