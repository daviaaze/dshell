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
DEFAULT_DEPTH = 24
DEFAULT_NODES = 4000
MAX_DEPTH = 32
MAX_NODES = 8000


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

    def call(self, destination, path, interface, method, *args, signature=None, json_reply=False):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise AccessibilityError("AT-SPI command exceeded its %d-second time limit" % COMMAND_TIMEOUT)
        command = ["busctl", "--address=" + self.address, "--timeout=4s", "call", destination, path, interface, method]
        if json_reply:
            command.insert(3, "--json=short")
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
            if json_reply:
                return json.loads(result.stdout)
            return shlex.split(result.stdout)
        except ValueError as exc:
            raise AccessibilityError("Could not parse %s.%s reply %r: %s" % (interface, method, result.stdout.strip(), exc))


    def property_string(self, destination, path, interface, name):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise AccessibilityError("AT-SPI command exceeded its %d-second time limit" % COMMAND_TIMEOUT)
        command = ["busctl", "--address=" + self.address, "--timeout=4s", "--json=short", "get-property", destination, path, interface, name]
        try:
            result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=min(TIMEOUT, remaining))
        except FileNotFoundError:
            raise AccessibilityError("busctl is not installed")
        except subprocess.TimeoutExpired:
            raise AccessibilityError("Timed out reading %s.%s on %s %s" % (interface, name, destination, path))
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.strip() or exc.stdout.strip() or "no D-Bus diagnostic"
            raise AccessibilityError("D-Bus property %s.%s failed on %s %s: %s" % (interface, name, destination, path, detail))
        reply = json.loads(result.stdout)
        value = reply.get("data")
        if reply.get("type") != "s" or not isinstance(value, str):
            raise AccessibilityError("Unexpected %s property reply from %s %s: %r" % (name, destination, path, reply))
        return value

    def string(self, destination, path, method):
        reply = self.call(destination, path, ACCESSIBLE, method, json_reply=True)
        values = reply.get("data")
        if reply.get("type") != "s" or not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str):
            raise AccessibilityError("Unexpected %s reply from %s %s: %r" % (method, destination, path, reply))
        return values[0]


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
    def bounds(self, destination, path, coordinates=SCREEN_COORDS):
        try:
            fields = self.call(destination, path, COMPONENT, "GetExtents", coordinates, signature="u")
        except AccessibilityError:
            return None
        if len(fields) != 5 or fields[0] not in ("iiii", "(iiii)"):
            return None
        try:
            bounds = [int(value) for value in fields[1:]]
            if coordinates == SCREEN_COORDS and bounds == [0, 0, 0, 0]:
                return None
            return bounds
        except ValueError:
            return None

    def summary(self, destination, path):
        name = self.property_string(destination, path, ACCESSIBLE, "Name")
        return {
            "bus": destination,
            "path": path,
            "name": name,
            "native_name": name,
            "role": self.string(destination, path, "GetRoleName"),
            "bounds": None,
        }

    def node(self, destination, path):
        node = self.summary(destination, path)
        node["bounds"] = self.bounds(destination, path)
        return node

    def tree(self, destination, path, depth, max_depth, budget, include_bounds=True):
        node = self.node(destination, path) if include_bounds else self.summary(destination, path)
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
                node["children"].append(
                    self.tree(child["bus"], child["path"], depth + 1, max_depth, budget, include_bounds)
                )
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
    destination = getattr(args, "bus", None)
    path = getattr(args, "path", None)
    contains = getattr(args, "name_contains", False)
    if bool(destination) != bool(path):
        raise AccessibilityError("An exact node requires both --bus and --path")
    if destination and path:
        node = atspi.node(destination, path)
        identity_name = node.get("native_name", node["name"])
        name_matches = args.name.casefold() == identity_name.casefold()
        if (not name_matches
                or (args.role and node["role"].casefold() != args.role.casefold())):
            raise AccessibilityError("Exact accessible node changed native identity; refusing activation: " + json.dumps(node))
        if want_actions:
            node["actions"] = atspi.actions(node)
            if not node["actions"] and node["role"].casefold() != "tab":
                raise AccessibilityError("Exact node has no advertised native action: " + json.dumps(node))
        if getattr(args, "showing", False):
            words = atspi.state_words(node["bus"], node["path"])
            if not words[0] & (1 << 25):
                raise AccessibilityError("Exact node is not currently showing: " + json.dumps(node))
        return node
    try:
        root = atspi.summary(REGISTRY, ROOT_PATH)
    except AccessibilityError as exc:
        raise AccessibilityError("AT-SPI registry desktop root is unavailable: " + str(exc))
    budget = [1, bounded(args.max_nodes, DEFAULT_NODES, MAX_NODES)]
    tree = atspi.tree(
        root["bus"], root["path"], 0, bounded(args.max_depth, DEFAULT_DEPTH, MAX_DEPTH), budget,
        include_bounds=False,
    )
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
        candidate_name = node.get("name", "").casefold()
        matched = target in candidate_name if contains else candidate_name == target
        if not matched and role_matches and getattr(args, "description_match", False):
            try:
                description = atspi.property_string(node["bus"], node["path"], ACCESSIBLE, "Description")
                matched = description.casefold() == target
            except AccessibilityError:
                pass
        if matched and role_matches:
            if getattr(args, "showing", False):
                words = atspi.state_words(node["bus"], node["path"])
                if not words[0] & (1 << 25):
                    stack.extend(reversed(node.get("children", [])))
                    continue
            if want_actions:
                try:
                    node["actions"] = atspi.actions(node)
                except AccessibilityError as exc:
                    node["action_error"] = str(exc)
                if node.get("actions") or (node.get("role", "").casefold() == "tab" and node.get("actions") == []):
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
    match = matches[0]
    match["bounds"] = atspi.bounds(match["bus"], match["path"])
    return match


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
    include_bounds = not getattr(args, "no_bounds", False)
    destination, path = getattr(args, "bus", None), getattr(args, "path", None)
    if bool(destination) != bool(path):
        raise AccessibilityError("A scoped tree requires both --bus and --path")
    if destination:
        root = atspi.summary(destination, path)
    else:
        root = get_root(atspi) if include_bounds else atspi.summary(REGISTRY, ROOT_PATH)
    return atspi.tree(
        root["bus"], root["path"], 0, bounded(args.max_depth, DEFAULT_DEPTH, MAX_DEPTH),
        [1, bounded(args.max_nodes, DEFAULT_NODES, MAX_NODES)], include_bounds=include_bounds,
    )


def command_find(atspi, args):
    node = locate(atspi, args, want_actions=args.actionable)
    if args.include_state:
        node["state_words"] = atspi.state_words(node["bus"], node["path"])
    if getattr(args, "include_actions", False):
        try:
            node["actions"] = atspi.actions(node)
        except AccessibilityError as exc:
            node["actions"] = []
            node["action_error"] = str(exc)
    if getattr(args, "window_bounds", False):
        node["window_bounds"] = atspi.bounds(node["bus"], node["path"], 1)
    return node


def command_click(atspi, args):
    node = locate(atspi, args, want_actions=True)
    actions = node["actions"]
    if not actions and node["role"].casefold() == "tab":
        parent = atspi.call(
            node["bus"], node["path"], "org.freedesktop.DBus.Properties",
            "Get", ACCESSIBLE, "Parent", signature="ss",
        )
        if len(parent) != 4 or parent[:2] != ["v", "(so)"]:
            raise AccessibilityError("Unexpected tab parent reply: " + repr(parent))
        destination, path = parent[2:]
        if atspi.string(destination, path, "GetRoleName") != "tab list":
            raise AccessibilityError("Refusing tab selection outside a native tab list")
        matches = [
            index for index, child in enumerate(atspi.children(destination, path))
            if child["bus"] == node["bus"] and child["path"] == node["path"]
        ]
        if len(matches) != 1:
            raise AccessibilityError("Tab is not a unique child of its native parent")
        reply = atspi.call(destination, path, "org.a11y.atspi.Selection", "SelectChild", matches[0], signature="i")
        if reply != ["b", "true"]:
            raise AccessibilityError("Native tab selection was rejected: " + repr(reply))
        selected = atspi.call(destination, path, "org.a11y.atspi.Selection", "IsChildSelected", matches[0], signature="i")
        if selected != ["b", "true"]:
            raise AccessibilityError("Native tab selection was not confirmed: " + repr(selected))
        return {"clicked": True, "action": "SelectChild", "node": node}
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


def command_select_row(atspi, args):
    # Selection is not activation: only selectable native list children qualify.
    node = locate(atspi, args)
    if (node["bus"] != args.bus or node["path"] != args.path
            or node.get("native_name", node["name"]) != args.name or node["role"] != args.role):
        raise AccessibilityError("Row changed exact bus/path/native-name/role identity; refusing selection: " + json.dumps(node))
    if node["role"].casefold() != "list item":
        raise AccessibilityError("select-row supports native list item rows only: " + json.dumps(node))
    words = atspi.state_words(node["bus"], node["path"])
    if not words or not (words[0] & (1 << 19)):
        raise AccessibilityError(
            "Row is not AT-SPI SELECTABLE; SelectChild cannot activate a nonselectable "
            "AdwActionRow. Use an advertised native action, or native keyboard navigation "
            "from a verified focused widget; no activation was attempted: " + json.dumps(node)
        )
    parent_reply = atspi.call(
        node["bus"], node["path"], "org.freedesktop.DBus.Properties",
        "Get", ACCESSIBLE, "Parent", signature="ss",
    )
    if len(parent_reply) != 4 or parent_reply[:2] != ["v", "(so)"]:
        raise AccessibilityError("Unexpected row parent reply: " + repr(parent_reply))
    destination, path = parent_reply[2:]
    parent = atspi.summary(destination, path)
    if parent["role"].casefold() not in ("list", "list box"):
        raise AccessibilityError("Row parent is not a native list: " + json.dumps(parent))
    interfaces = atspi.call(destination, path, ACCESSIBLE, "GetInterfaces")
    selection = "org.a11y.atspi.Selection"
    if (len(interfaces) < 2 or interfaces[0] != "as"
            or interfaces[1] != str(len(interfaces) - 2) or selection not in interfaces[2:]):
        raise AccessibilityError("Native row parent does not advertise Selection: " + repr(interfaces))
    children = atspi.children(destination, path)
    matches = [
        index for index, child in enumerate(children)
        if child["bus"] == node["bus"] and child["path"] == node["path"]
    ]
    if len(matches) != 1:
        raise AccessibilityError("Row is not a unique direct child of its native list")
    index = matches[0]
    reply = atspi.call(destination, path, selection, "SelectChild", index, signature="i")
    if reply != ["b", "true"]:
        raise AccessibilityError("Native row SelectChild was rejected: " + repr(reply))
    actual = atspi.summary(node["bus"], node["path"])
    if any(actual[key] != node[key] for key in ("bus", "path", "native_name", "role")):
        raise AccessibilityError("Row native identity changed after SelectChild: " + json.dumps(actual))
    current_children = atspi.children(destination, path)
    if index >= len(current_children) or current_children[index] != children[index]:
        raise AccessibilityError("Native list child identity changed after SelectChild")
    selected = atspi.call(destination, path, selection, "IsChildSelected", index, signature="i")
    if selected != ["b", "true"]:
        raise AccessibilityError("Native row selection was not confirmed: " + repr(selected))
    actual["state_words"] = atspi.state_words(node["bus"], node["path"])
    return {
        "selected": True, "selection_verified": True, "action": "SelectChild",
        "reply": reply, "selection_reply": selected, "child_index": index,
        "parent": parent, "node": actual,
    }




def command_focus(atspi, args):
    node = locate(atspi, args)
    try:
        reply = atspi.call(node["bus"], node["path"], COMPONENT, "GrabFocus")
    except AccessibilityError as exc:
        raise AccessibilityError(
            "Native GrabFocus is unavailable for this exact node; no keyboard target "
            "was established. Navigate from another verified focused widget: " + str(exc)
        )
    if reply != ["b", "true"]:
        raise AccessibilityError("AT-SPI rejected focus; no keyboard target was established: " + json.dumps(node))
    node["state_words"] = atspi.state_words(node["bus"], node["path"])
    if not node["state_words"] or not (node["state_words"][0] & (1 << 12)):
        raise AccessibilityError("GrabFocus returned true but native FOCUSED state was not confirmed: " + json.dumps(node))
    return {"focused": True, "focus_verified": True, "node": node}


def command_set_text(atspi, args):
    node = locate(atspi, args)
    reply = atspi.call(node["bus"], node["path"], "org.a11y.atspi.EditableText",
                       "SetTextContents", args.text, signature="s")
    if reply != ["b", "true"]:
        raise AccessibilityError("AT-SPI rejected text entry on " + json.dumps(node))
    return {"edited": True, "node": node}


def command_set_value(atspi, args):
    node = locate(atspi, args)
    properties = "org.freedesktop.DBus.Properties"
    interface = "org.a11y.atspi.Value"
    if args.fraction is None and args.value is None:
        raise AccessibilityError("set-value requires --value or --fraction")
    if args.fraction is not None:
        minimum = atspi.call(node["bus"], node["path"], properties, "Get",
                             interface, "MinimumValue", signature="ss")
        maximum = atspi.call(node["bus"], node["path"], properties, "Get",
                             interface, "MaximumValue", signature="ss")
        if (len(minimum) != 3 or minimum[:2] != ["v", "d"]
                or len(maximum) != 3 or maximum[:2] != ["v", "d"]):
            raise AccessibilityError("Native Value range unavailable for " + json.dumps(node))
        fraction = min(1.0, max(0.0, args.fraction))
        args.value = float(minimum[2]) + fraction * (float(maximum[2]) - float(minimum[2]))
    atspi.call(node["bus"], node["path"], properties, "Set",
               interface, "CurrentValue", "d", args.value, signature="ssv")
    reply = atspi.call(node["bus"], node["path"], properties, "Get",
                       interface, "CurrentValue", signature="ss")
    if len(reply) != 3 or reply[:2] != ["v", "d"]:
        raise AccessibilityError("Unexpected native Value.CurrentValue reply: " + repr(reply))
    return {"requested": args.value, "actual": float(reply[2]), "node": node}


def make_parser():
    parser = argparse.ArgumentParser(description="Inspect and operate the guest Shade accessibility tree")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("probe", help="report the AT-SPI registry desktop and application roots")
    tree = commands.add_parser("tree", help="print a bounded semantic tree")
    tree.add_argument("--no-bounds", action="store_true", help="skip per-node screen geometry queries")
    find = commands.add_parser("find", help="find one exact accessible name")
    find.add_argument("--include-state", action="store_true", help="include the AT-SPI state bit words for the matched node")
    find.add_argument("--include-actions", action="store_true", help="report advertised actions without requiring one")
    find.add_argument("--actionable", action="store_true", help="require an available native AT-SPI action")
    find.add_argument("--window-bounds", action="store_true", help="also report native WINDOW-relative bounds; do not treat these as global coordinates")
    find.add_argument("--showing", action="store_true", help="require the native AT-SPI SHOWING state")
    click = commands.add_parser("click", help="invoke one unambiguous AT-SPI click action")
    focus = commands.add_parser("focus", help="focus one native accessible input")
    row = commands.add_parser("select-row", help="select and verify an exact selectable native list row (not action-row activation)")
    value = commands.add_parser("set-value", help="set and read back a native AT-SPI Value.CurrentValue")
    text = commands.add_parser("set-text", help="edit a native accessible text input")
    text.add_argument("--text", required=True)
    value.add_argument("--value", type=float)
    value.add_argument("--fraction", type=float, help="set fraction of the native Value minimum-to-maximum range")
    for command in (find, click, focus, value, text):
        command.add_argument("--description-match", action="store_true", help="also match the AT-SPI accessible description")
        command.add_argument("--name-contains", action="store_true", help="revalidate a stable name fragment when asynchronous status changes the rest")
    for command in (tree, find, click, focus, value, text, row):
        command.add_argument("--bus", help="activate only this previously observed accessible bus")
        command.add_argument("--path", help="activate only this previously observed accessible object path")
    for command in (tree, find, click, focus, value, text, row):
        command.add_argument("--max-depth", type=int, default=DEFAULT_DEPTH)
        command.add_argument("--max-nodes", type=int, default=DEFAULT_NODES)
    for command in (find, click, focus, value, text, row):
        command.add_argument("--name", required=True)
        command.add_argument("--role")
    return parser


def main():
    args = make_parser().parse_args()
    try:
        address = bus_address()
        atspi = Atspi(address)
        result = {"probe": command_probe, "tree": command_tree, "find": command_find, "click": command_click, "focus": command_focus, "select-row": command_select_row, "set-value": command_set_value, "set-text": command_set_text}[args.command](atspi, args) if args.command != "probe" else command_probe(atspi)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except AccessibilityError as exc:
        print("vm-workflow-accessibility: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
