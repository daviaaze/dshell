#!/usr/bin/env python3
"""Run isolated Shade desktop workflows in the repository's vm-vnc guest."""

from __future__ import annotations

import argparse
import importlib
import json
import os
import shlex
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from vm_visual_evidence import render_evidence

ROOT = Path(__file__).resolve().parent.parent
ACCESSIBILITY = ROOT / "scripts/vm-workflow-accessibility.py"
SSH_USER = "tester"
SSH_PASSWORD = "test"
SSH_TIMEOUT = 12
BOOT_TIMEOUT = 240
LOGIN_TIMEOUT = 120


class Unsupported(RuntimeError):
    pass


def summarize_timing(
    results: list[dict[str, object]],
    phases: dict[str, float],
    commands: list[dict[str, object]],
    elapsed_seconds: float,
) -> dict[str, object]:
    scenario_seconds = sum(float(result["duration_seconds"]) for result in results)
    status_counts: dict[str, int] = {}
    for result in results:
        status = str(result["status"])
        status_counts[status] = status_counts.get(status, 0) + 1
    command_seconds = sum(float(command["duration_seconds"]) for command in commands)
    slowest_commands = sorted(
        commands, key=lambda command: float(command["duration_seconds"]), reverse=True
    )[:5]
    return {
        "elapsed_seconds": round(elapsed_seconds, 2),
        "scenario_seconds": round(scenario_seconds, 2),
        "outside_scenario_seconds": round(max(0.0, elapsed_seconds - scenario_seconds), 2),
        "phase_seconds": {name: round(seconds, 2) for name, seconds in phases.items()},
        "scenario_status_counts": status_counts,
        "command_count": len(commands),
        "command_seconds": round(command_seconds, 2),
        "slowest_commands": [
            {
                "label": str(command["label"]),
                "duration_seconds": round(float(command["duration_seconds"]), 2),
                "returncode": int(command["returncode"]),
            }
            for command in slowest_commands
        ],
    }


class WorkflowTest:
    def __init__(self) -> None:
        self.started_at = time.monotonic()
        self.artifacts = Path(tempfile.mkdtemp(prefix="swf-a-", dir="/tmp"))
        self.state = Path(tempfile.mkdtemp(prefix="swf-s-", dir="/tmp"))
        self.results: list[dict[str, object]] = []
        self.phase_timings: dict[str, float] = {}
        self.command_timings: list[dict[str, object]] = []
        self.qemu: subprocess.Popen[bytes] | None = None
        self.ssh_port = self.free_port()
        self.vnc_port = self.free_port()
        self.monitor = self.state / "qemu-monitor.sock"
        self.build_log = self.artifacts / "build.log"
        self.qemu_log = self.artifacts / "qemu.log"
        self.command_log = self.artifacts / "commands.log"
        self._gsettings_environment_pid: int | None = None
        self._gsettings_environment: dict[str, str] = {}
        self.review_password = SSH_PASSWORD
        self.review_selection: dict[str, object] = {}
        self.review_records: list[dict[str, object]] = []
        self.review_theme = "prelogin"
        self.review_viewport = "native"
        self.review_family = "prerequisite"
        self.review_monitor: dict[str, object] = {}
        self.review_root = self.artifacts / "ui-review"
        self._review_shortcut_failures: set[str] = set()
        self.review_directory = self.review_root

    def write_review_manifest(self) -> None:
        self.review_root.mkdir(parents=True, exist_ok=True)
        counts: dict[str, int] = {}
        for record in self.review_records:
            status = str(record["status"])
            counts[status] = counts.get(status, 0) + 1
        (self.review_root / "manifest.json").write_text(json.dumps({
            "scope": "Guest UI evidence, not a global accessibility or pixel-padding conformance claim",
            "selection": self.review_selection,
            "records": self.review_records,
            "coverage": counts,
            "failures": [r for r in self.review_records if r["status"] == "failed"],
            "unavailable": [r for r in self.review_records if r["status"] == "unavailable"],
            "greeter_artifacts": [str(p) for p in sorted(self.artifacts.glob("greeter-*.png"))],
            "greeter_scope": "Real prerequisite before session variants; session theme/viewport do not establish greeter matrix coverage",
        }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def review_record(self, screen_id: str, status: str, **details) -> dict[str, object]:
        record = {
            "screen_id": screen_id, "status": status,
            "family": self.review_family, "theme": self.review_theme,
            "viewport": self.review_viewport, "monitor": self.review_monitor,
            **details,
        }
        self.review_records.append(record)
        self.write_review_manifest()
        return record

    def review_unavailable(self, screen_id: str, reason: str) -> dict[str, object]:
        return self.review_record(screen_id, "unavailable", reason=reason, reviewed=False)
    def _review_capture_existing(self, screen_id: str, screenshot: Path, *, notes=None, include_native_tree=True) -> dict[str, object]:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", screen_id).strip(".-") or "screen"
        directory = self.review_directory / f"{len(self.review_records):04d}-{safe}"
        directory.mkdir(parents=True, exist_ok=False)
        frozen_screenshot = directory / "screen.png"
        shutil.copyfile(screenshot, frozen_screenshot)
        evidence: dict[str, object] = {"screenshot": str(frozen_screenshot)}
        errors: dict[str, str] = {}
        operations = () if self.review_theme == "prelogin" else (
            (("atspi", lambda: self.accessibility_tree(f"reviewing {screen_id}")),)
            if include_native_tree else ()
        ) + (("layers", self.layers), ("clients", self.clients), ("monitors", self.monitors))
        if not include_native_tree:
            evidence["atspi_scope"] = "Full tree omitted to preserve the live transaction deadline; workflow-native control identity and compositor receipts remain separate evidence."
        if self.review_theme == "prelogin":
            evidence["native_receipts"] = {
                "status": "unavailable",
                "reason": "Tester session/AT-SPI and compositor socket do not exist before the real greeter login.",
            }
        for name, operation in operations:
            try:
                value = operation()
                path = directory / f"{name}.json"
                path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                evidence[name] = str(path)
                if name == "atspi":
                    bounds = [node.get("bounds") for node in self.walk_accessibility(value)]
                    valid = sum(isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)
                                and b[2] > 0 and b[3] > 0 and all(abs(v) < 2147483647 for v in b) for b in bounds)
                    evidence["native_bounds"] = {
                        "valid_allocations": valid, "invalid_or_unknown": len(bounds) - valid,
                        "qualification": "Native allocations only; invalid/unknown values are not exact padding measurements.",
                    }
            except Exception as exc:
                errors[name] = f"{type(exc).__name__}: {exc}"
        return self.review_record(
            screen_id, "failed" if errors else "captured", notes=notes,
            reviewed=False, evidence=evidence, errors=errors,
            scope="Actual screenshot captured during the existing workflow step; native allocation/compositor receipts, not exact padding",
            review_scope="prelogin-prerequisite" if self.review_theme == "prelogin" else "session-variant",
        )

    def review_run_scenario(self, method_name: str, *, include_native_tree=True) -> list[dict[str, object]]:
        """Run an existing WorkflowTest method while recording each real intermediate screenshot."""
        method = getattr(self, method_name, None)
        if not callable(method) or not method_name.startswith("test_"):
            raise ValueError(f"Unknown workflow test method: {method_name!r}")
        if method_name == "test_greeter":
            self.review_family, self.review_theme, self.review_viewport = "greeter-prerequisite", "prelogin", "native"
            self.review_directory = self.review_root / "prelogin" / "greeter"
            self.review_monitor = {}
        before = len(self.review_records)
        capture = self.capture

        def capture_hook(name: str) -> Path:
            screenshot = capture(name)
            self._review_capture_existing(
                f"{method_name}-{Path(name).name}",
                screenshot,
                notes=f"Intermediate screenshot from existing {method_name} workflow; no UI behavior reimplemented.",
                include_native_tree=include_native_tree,
            )
            return screenshot

        self.capture = capture_hook
        try:
            method()
        except Exception as exc:
            self.review_record(
                f"{method_name}-failure", "failed",
                reason=f"{type(exc).__name__}: {exc}",
                review_scope="prelogin-prerequisite" if self.review_theme == "prelogin" else "session-variant",
            )
            raise
        finally:
            self.capture = capture
        records = self.review_records[before:]
        if not records:
            self.review_record(method_name, "failed", reason="Workflow method produced no intermediate screenshots")
        return self.review_records[before:]


    def review_capture(self, screen_id: str, *, notes=None) -> dict[str, object]:
        # Never allow screen IDs to escape the per-family artifact directory.
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", screen_id).strip(".-") or "screen"
        directory = self.review_directory / f"{len(self.review_records):04d}-{safe}"
        directory.mkdir(parents=True, exist_ok=False)
        evidence: dict[str, object] = {}
        errors: dict[str, str] = {}
        operations = {
            "screenshot": lambda: str(self.capture(str(directory.relative_to(self.artifacts) / "screen"))),
            "atspi": lambda: self.accessibility_tree(f"reviewing {screen_id} native roles names states and bounds"),
            "layers": self.layers,
            "clients": self.clients,
            "monitors": self.monitors,
        }
        for name, operation in operations.items():
            try:
                value = operation()
                if name == "screenshot":
                    evidence[name] = value
                else:
                    path = directory / f"{name}.json"
                    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    evidence[name] = str(path)
                    if name == "atspi":
                        valid = invalid = unknown = 0
                        for node in self.walk_accessibility(value):
                            bounds = node.get("bounds")
                            if not isinstance(bounds, list) or len(bounds) != 4:
                                unknown += 1
                            elif not all(isinstance(v, (int, float)) for v in bounds) or bounds[2] <= 0 or bounds[3] <= 0 or any(abs(v) >= 2147483647 for v in bounds):
                                invalid += 1
                            else:
                                valid += 1
                        evidence["native_bounds"] = {
                            "valid_allocations": valid, "invalid": invalid, "unknown": unknown,
                            "qualification": "Native allocations only; invalid/unknown bounds cannot establish geometry. Allocations are not exact padding measurements.",
                        }
            except Exception as exc:
                errors[name] = f"{type(exc).__name__}: {exc}"
        return self.review_record(
            screen_id, "failed" if errors else "captured", notes=notes,
            reviewed=False, evidence=evidence, errors=errors,
            scope="Actual guest screenshot and native/compositor receipts; no inferred exact padding or physical hardware coverage",
            context={
                "family": self.review_family, "theme": self.review_theme,
                "viewport": self.review_viewport, "monitor": self.review_monitor,
            },
        )

    def review_restore(self) -> None:
        if self.lockscreen_visible():
            raise RuntimeError("Review family left the guest locked; refusing viewport changes or blind dismissal")
        # Escape cancels, never accepts a power/display/auth confirmation.
        self.vnc("cancelling guest review transients", "key", "esc", "key", "esc", "pause", "0.3")
        self.close_settings()
        self.close_quick_settings()

    def review_set_variant(self, theme: str, viewport: str) -> None:
        self.review_restore()
        width, height = {"wide": (1280, 800), "compact": (800, 600), "short": (1024, 480)}[viewport]
        primary = next((m for m in self.monitors() if m.get("name") == "Virtual-1"), None)
        if primary is None:
            raise Unsupported("Guest Virtual-1 output is unavailable")
        self.desktop(
            "setting guest-only review monitor configuration",
            "hyprctl eval " + shlex.quote(
                f'hl.monitor({{output = "Virtual-1", mode = "{width}x{height}@60", position = "0x0", scale = 1}})'
            ),
        )
        self.review_monitor = self.wait_until(
            "actual review monitor dimensions and scale",
            lambda: next((m for m in self.monitors() if m.get("name") == "Virtual-1"
                          and m.get("width") == width and m.get("height") == height
                          and float(m.get("scale", 0)) == 1), None),
            timeout=20,
        )
        self.open_settings()
        try:
            self.settings_page("Aparência")
            label = {"light": "Claro", "dark": "Escuro"}[theme]
            self.click_named("selecting review theme through native Settings", label, role="radio")
            def selected_theme():
                node = self.accessibility(
                    "reading selected review theme", "find", "--name", label,
                    "--role", "radio", "--include-state",
                )
                words = node.get("state_words", [])
                return node if words and words[0] & ((1 << 4) | (1 << 20) | (1 << 23)) else None
            self.wait_until("native theme selection state", selected_theme, timeout=12)
        finally:
            self.close_settings()
            self.close_quick_settings()

    def test_ui_review(self, families: list[str], themes: list[str], viewports: list[str]) -> dict[str, object]:
        modules = {
            "shell": "vm_ui_review_shell",
            "settings-auth": "vm_ui_review_settings_auth",
            "capture-share": "vm_ui_review_capture",
        }
        self.review_root.mkdir(parents=True, exist_ok=True)
        self.review_selection = {"families": families, "themes": themes, "viewports": viewports}
        self.write_review_manifest()
        for theme in themes:
            for viewport in viewports:
                self.review_theme, self.review_viewport = theme, viewport
                for family in families:
                    self.review_family = family
                    self.review_directory = self.review_root / theme / viewport / family
                    self.review_directory.mkdir(parents=True, exist_ok=True)
                    self.review_monitor = {}
                    start = len(self.review_records)
                    try:
                        self.review_set_variant(theme, viewport)
                        returned = importlib.import_module(modules[family]).run_review(self, theme, viewport)
                        for record in returned:
                            record.setdefault("family", family)
                            record.setdefault("theme", theme)
                            record.setdefault("viewport", viewport)
                            record.setdefault("monitor", self.review_monitor)
                            record.setdefault("reviewed", False)
                            if record not in self.review_records:
                                self.review_records.append(record)
                        if len(self.review_records) == start:
                            raise RuntimeError("Review module returned no coverage records")
                    except Exception as exc:
                        self.review_capture("family-failure-visible", notes=f"{type(exc).__name__}: {exc}")
                        self.review_record("family-execution", "failed", reason=f"{type(exc).__name__}: {exc}")
                    finally:
                        try:
                            self.review_restore()
                        except Exception as exc:
                            self.review_capture("restore-failure-visible", notes=str(exc))
                            self.review_record("family-restore", "failed", reason=str(exc))
                        self.write_review_manifest()
        if any(r["status"] == "failed" for r in self.review_records):
            raise RuntimeError(f"UI review failures recorded in {self.review_root / 'manifest.json'}")
        return {"manifest": str(self.review_root / "manifest.json"),
                "captured": sum(r["status"] == "captured" for r in self.review_records),
                "unavailable": sum(r["status"] == "unavailable" for r in self.review_records)}

    @staticmethod
    def free_port() -> int:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            return listener.getsockname()[1]

    def record_command(
        self, label: str, result: subprocess.CompletedProcess[str], duration_seconds: float
    ) -> None:
        self.command_timings.append({
            "label": label,
            "duration_seconds": duration_seconds,
            "returncode": result.returncode,
        })
        with self.command_log.open("a", encoding="utf-8") as log:
            log.write(f"## {label} (exit {result.returncode}, {duration_seconds:.2f}s)\n")
            log.write(result.stdout)
            if result.stderr:
                log.write(result.stderr)
            if not result.stdout.endswith("\n"):
                log.write("\n")

    def local(self, label: str, command: list[str], *, timeout: int = 120, check: bool = True) -> subprocess.CompletedProcess[str]:
        started = time.monotonic()
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        self.record_command(label, result, time.monotonic() - started)
        if check and result.returncode:
            detail = "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)
            raise RuntimeError(f"{label}: {detail or f'exit {result.returncode}'}")
        return result

    def ssh_argv(self) -> list[str]:
        return [
            "sshpass", "-p", SSH_PASSWORD, "ssh", "-F", "/dev/null",
            "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
            "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no",
            "-o", "ConnectTimeout=5", "-p", str(self.ssh_port), f"{SSH_USER}@127.0.0.1",
        ]

    def guest(self, label: str, command: str, *, timeout: int = SSH_TIMEOUT, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = self.local(label, self.ssh_argv() + [command], timeout=timeout, check=check)
        return result

    def desktop(self, label: str, command: str, *, timeout: int = SSH_TIMEOUT, check: bool = True) -> subprocess.CompletedProcess[str]:
        session = (
            'uid=$(id -u); export XDG_RUNTIME_DIR="/run/user/$uid" '
            'DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" '
            'WAYLAND_DISPLAY=wayland-1; '
            'sig=$(systemctl --user show-environment | while IFS="=" read -r key value; do '
            '[ "$key" = HYPRLAND_INSTANCE_SIGNATURE ] && printf "%s" "$value"; done); '
            'export HYPRLAND_INSTANCE_SIGNATURE="$sig"; '
        ) + command
        return self.guest(label, session, timeout=timeout, check=check)

    def bar_position_from_layers(self, layers: list[dict[str, object]]) -> str | None:
        screen_width = max((int(layer.get("x", 0)) + int(layer.get("w", 0)) for layer in layers), default=0)
        screen_height = max((int(layer.get("y", 0)) + int(layer.get("h", 0)) for layer in layers), default=0)
        if screen_width <= 0 or screen_height <= 0:
            return None
        for layer in layers:
            x, y = int(layer.get("x", 0)), int(layer.get("y", 0))
            width, height = int(layer.get("w", 0)), int(layer.get("h", 0))
            if height >= screen_height * 0.8 and width <= screen_width * 0.2:
                return "Left" if x < screen_width / 2 else "Right"
            if width >= screen_width * 0.8 and height <= screen_height * 0.2:
                return "Top" if y < screen_height / 2 else "Bottom"
        return None

    def user_service_active(self, label: str) -> bool:
        result = self.desktop(label, "systemctl --user is-active shade-shell.service", timeout=6, check=False)
        return result.returncode == 0 and result.stdout.strip() == "active"

    def accessibility(self, label: str, *args: str, check: bool = True) -> dict[str, object]:
        command = "python3 /tmp/shade-workflow-accessibility.py " + shlex.join(list(args))
        result = self.desktop(label, command, timeout=45, check=check)
        if result.returncode:
            detail = result.stderr.strip() or result.stdout.strip()
            if "No node matched" in detail or "Ambiguous match" in detail or "no unambiguous click action" in detail:
                raise Unsupported(detail)
            raise RuntimeError(detail or f"{label}: exit {result.returncode}")
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"{label}: helper returned invalid JSON: {exc}")
    def wait_until(self, label: str, probe, *, timeout: float = 30, interval: float = 0.2):
        deadline = time.monotonic() + timeout
        last: object = "no observation"
        while True:
            try:
                value = probe()
            except (RuntimeError, Unsupported, subprocess.TimeoutExpired) as exc:
                last = str(exc)
            else:
                if value:
                    return value
                last = value
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(interval, remaining))
        raise RuntimeError(f"{label} timed out after {timeout:g}s; last observation: {last!r}")

    def accessibility_tree(self, label: str) -> dict[str, object]:
        return self.accessibility(
            label, "tree", "--max-depth", "32", "--max-nodes", "4000"
        )

    @staticmethod
    def walk_accessibility(tree: dict[str, object]):
        stack = [tree]
        while stack:
            node = stack.pop()
            yield node
            children = node.get("children", [])
            if isinstance(children, list):
                stack.extend(reversed([child for child in children if isinstance(child, dict)]))

    def find_accessible_node(
        self, name: str, *, role: str | None = None, contains: bool = False
    ) -> dict[str, object]:
        tree = self.accessibility_tree(f"finding accessible {name}")
        target = name.casefold()
        matches = [
            node
            for node in self.walk_accessibility(tree)
            if (
                (str(node.get("name") or "").casefold() == target
                 if not contains
                 else target in str(node.get("name") or "").casefold())
                and (role is None or str(node.get("role") or "").casefold() == role.casefold())
            )
        ]
        if len(matches) != 1:
            raise Unsupported(
                f"Expected one accessible node for {name!r} role={role!r}; found "
                f"{[{key: node.get(key) for key in ('name', 'role', 'bounds')} for node in matches]}"
            )
        return matches[0]

    def click_accessible_node(self, node: dict[str, object], label: str) -> None:
        name = str(node.get("native_name", node.get("name")) or "")
        role = str(node.get("role") or "")
        destination, path = node.get("bus"), node.get("path")
        if not isinstance(destination, str) or not isinstance(path, str):
            raise Unsupported(f"{label} has no native accessible identity: {node}")
        self.accessibility(
            label, "click", "--name=" + name, "--role", role,
            "--bus", destination, "--path", path,
        )

    def click_named(
        self, label: str, name: str, *, role: str | None = None, contains: bool = False
    ) -> dict[str, object]:
        node = self.find_accessible_node(name, role=role, contains=contains)
        self.click_accessible_node(node, label)
        return node

    def nodes_in_group(self, tree: dict[str, object], group_title: str) -> list[dict[str, object]]:
        groups = [
            node for node in self.walk_accessibility(tree)
            if str(node.get("name") or "") == group_title
        ]
        if not groups:
            raise Unsupported(f"Settings feature group {group_title!r} is not exposed in the accessible tree")
        return [
            node
            for group in groups
            for node in self.walk_accessibility(group)
        ]

    def find_in_group(
        self,
        tree: dict[str, object],
        group_title: str,
        name: str,
        *,
        role: str | None = None,
    ) -> dict[str, object]:
        target = name.casefold()
        matches = {
            (node.get("bus"), node.get("path")): node
            for node in self.nodes_in_group(tree, group_title)
            if str(node.get("name") or "").casefold() == target
            and (role is None or str(node.get("role") or "").casefold() == role.casefold())
        }
        if len(matches) != 1:
            raise Unsupported(
                f"Expected one {name!r} role={role!r} in Settings group {group_title!r}; "
                f"found {[{key: node.get(key) for key in ('name', 'role', 'bounds')} for node in matches.values()]}"
            )
        return next(iter(matches.values()))

    def click_bluetooth_peer_action(
        self,
        label: str,
        action: str,
        controller: str,
        address: str,
        expected_path: str,
    ) -> dict[str, object]:
        device = self.bluetooth_device(controller, address)
        if (
            not device
            or str(device.get("Name", device.get("Alias", ""))) != "ShadeVM-Peer"
            or str(device.get("path")) != expected_path
        ):
            raise RuntimeError(
                f"Bluetooth action {action!r} target changed: expected ShadeVM-Peer "
                f"at {expected_path}, found {device}"
            )

        tree = self.accessibility_tree(f"finding {action} for exact ShadeVM-Peer row")

        def subtree(node: dict[str, object]):
            return list(self.walk_accessibility(node))

        labels = [
            node for node in self.walk_accessibility(tree)
            if str(node.get("name") or "") == "ShadeVM-Peer"
            and str(node.get("role") or "").casefold() == "label"
        ]
        if len(labels) != 1:
            raise Unsupported(f"Expected one ShadeVM-Peer accessible row label: {labels}")

        # Select the closest ancestor whose subtree contains the peer label and
        # exactly one matching action, but no other device identity. The tree's
        # real parent links preserve the Settings row/card association.
        parents: dict[int, dict[str, object]] = {}
        stack = [tree]
        while stack:
            parent = stack.pop()
            for child in parent.get("children", []):
                if isinstance(child, dict):
                    parents[id(child)] = parent
                    stack.append(child)
        current = labels[0]
        while id(current) in parents:
            current = parents[id(current)]
            nodes = subtree(current)
            device_names = {
                str(node.get("name") or "")
                for node in nodes
                if str(node.get("name") or "") in {"ShadeVM-Peer", "shade-vm"}
            }
            actions = [
                node for node in nodes
                if str(node.get("name") or "") == action
                and str(node.get("role") or "").casefold() == "button"
            ]
            if device_names == {"ShadeVM-Peer"} and len(actions) == 1:
                self.click_accessible_node(actions[0], label)
                return actions[0]
        raise Unsupported(
            f"Could not associate exactly one {action!r} button with ShadeVM-Peer row "
            f"at BlueZ object {expected_path}"
        )

    def click_in_group(
        self,
        label: str,
        group_title: str,
        name: str,
        *,
        role: str | None = None,
    ) -> dict[str, object]:
        tree = self.accessibility_tree(f"finding {name} in Settings group {group_title}")
        node = self.find_in_group(tree, group_title, name, role=role)
        self.click_accessible_node(node, label)
        return node


    def gsettings_environment(self) -> dict[str, str]:
        raw_pid = self.desktop(
            "identifying the running shell for GSettings schema lookup",
            "systemctl --user show shade-shell.service -p MainPID --value",
        ).stdout.strip()
        if not raw_pid.isdecimal() or int(raw_pid) <= 0:
            raise Unsupported(f"Shade has no running MainPID for schema lookup: {raw_pid!r}")
        pid = int(raw_pid)
        if self._gsettings_environment_pid == pid:
            return self._gsettings_environment
        code = """import json, os, sys
keys = {b'GSETTINGS_SCHEMA_DIR', b'XDG_DATA_DIRS'}
environment = {}
with open('/proc/' + sys.argv[1] + '/environ', 'rb') as source:
    for entry in source.read().split(b'\\0'):
        key, separator, value = entry.partition(b'=')
        if separator and key in keys:
            environment[os.fsdecode(key)] = os.fsdecode(value)
print(json.dumps(environment))"""
        environment = json.loads(self.desktop(
            "reading only the running shell's GSettings schema environment",
            "python3 -c " + shlex.quote(code) + " " + str(pid),
        ).stdout)
        if not isinstance(environment, dict) or any(
            key not in {"GSETTINGS_SCHEMA_DIR", "XDG_DATA_DIRS"} or not isinstance(value, str)
            for key, value in environment.items()
        ):
            raise RuntimeError(f"Invalid GSettings schema environment: {environment!r}")
        self._gsettings_environment_pid = pid
        self._gsettings_environment = environment
        return environment

    def gsetting(self, key: str, value: str | None = None) -> str:
        schema = "com.caioasmuniz.shade_shell"
        if key in {"position"}:
            schema += ".bar"
        else:
            schema += ".screen-capture"
        environment = self.gsettings_environment()
        command_env = shlex.join([
            "env", "-u", "GSETTINGS_SCHEMA_DIR", "-u", "XDG_DATA_DIRS",
            *[f"{name}={value}" for name, value in environment.items()],
        ])
        if value is not None:
            self.desktop(
                f"setting {schema}.{key}",
                f"{command_env} gsettings set {schema} {shlex.quote(key)} {shlex.quote(value)}",
            )
        return self.desktop(
            f"reading {schema}.{key}",
            f"{command_env} gsettings get {schema} {shlex.quote(key)}",
        ).stdout.strip()

    def activate_shell_action(self, action: str) -> None:
        self.desktop(
            f"activating registered Shade action {action}",
            "gdbus call --session --dest com.caioasmuniz.shade_shell "
            "--object-path /com/caioasmuniz/shade_shell "
            "--method org.gtk.Actions.Activate "
            + shlex.quote(action) + " '[]' '{}'",
        )

    def hyprland_pid(self) -> str:
        code = """import json, os, subprocess
signature = os.environ.get('HYPRLAND_INSTANCE_SIGNATURE')
instances = json.loads(subprocess.check_output(['hyprctl', 'instances', '-j'], text=True))
matches = [item for item in instances if item.get('instance') == signature]
pid = matches[0].get('pid') if len(matches) == 1 else None
print(str(pid) if str(pid).isdecimal() else '')"""
        return self.desktop(
            "reading the current Hyprland instance PID",
            "python3 -c " + shlex.quote(code),
        ).stdout.strip()

    def quick_settings_open(self) -> bool:
        return any(layer.get("namespace") == "shade-quicksettings" for layer in self.layers())

    def _toggle_quick_settings(self, opening: bool) -> None:
        if self.quick_settings_open() == opening:
            return
        label = "opening" if opening else "closing"
        self.vnc(
            f"{label} Quick Settings with Super+N",
            "keydown", "super", "key", "n", "keyup", "super",
        )
        try:
            self.wait_until(
                f"Quick Settings {label} through Super+N",
                lambda: self.quick_settings_open() == opening,
                timeout=2,
            )
            return
        except RuntimeError as shortcut_error:
            if self.review_selection and "quick-settings-super-n" not in self._review_shortcut_failures:
                self._review_shortcut_failures.add("quick-settings-super-n")
                self.review_record(
                    "quick-settings-super-n",
                    "failed",
                    reason=f"Guest Super+N did not change the Quick Settings layer: {shortcut_error}",
                    reviewed=False,
                )
            if self.quick_settings_open() != opening:
                self.activate_shell_action("toggle-quicksettings")
            self.wait_until(
                f"Quick Settings {label} through the registered application action",
                lambda: self.quick_settings_open() == opening,
                timeout=12,
            )

    def open_quick_settings(self) -> None:
        self._toggle_quick_settings(True)

    def close_quick_settings(self) -> None:
        self._toggle_quick_settings(False)

    def settings_search(self, title: str) -> dict[str, object]:
        self.vnc("focus Settings global search", "keydown", "ctrl", "key", "f", "keyup", "ctrl", "pause", "0.5")
        entry = self.find_accessible_node("Buscar nas configurações", role="search box")
        return self.accessibility(
            "set exact UTF8 Settings query", "set-text",
            "--name", "Buscar nas configurações", "--role", "search box",
            "--bus", str(entry["bus"]), "--path", str(entry["path"]), "--text", title,
        )

    def settings_page(self, title: str) -> dict[str, object]:
        clients = [client for client in self.clients() if client.get("title") == "Configurações"]
        if len(clients) != 1:
            raise Unsupported(f"Settings window is not unique: {clients}")
        self.settings_search(title)
        def first_exact_result():
            tree = self.accessibility_tree(f"reading Settings search results for {title}")
            rows = [
                node for node in self.nodes_in_group(tree, "Resultados de busca")
                if node.get("role") == "list item"
            ]
            # A setting in another module can share the module's title; Enter
            # deliberately opens the ranked first result, not a unique label.
            return rows[0] if rows and rows[0].get("name") == title else None
        self.wait_until(
            f"Settings ranked exact-title result {title}", first_exact_result,
            timeout=12,
        )
        self.vnc(f"open exact Settings destination {title}", "key", "enter")

        def visible_destination():
            tree = self.accessibility_tree(f"reading current Settings destination {title}")
            # A preference group may repeat its containing NavigationPage title.
            # Match outermost named pages, not every nested group with that name.
            groups = []
            pending = [tree]
            while pending:
                node = pending.pop()
                if node.get("role") == "group" and node.get("name") == title:
                    groups.append(node)
                else:
                    pending.extend(node.get("children", []))
            if len(groups) != 1:
                return None
            group = groups[0]
            descendants = [
                node for node in self.walk_accessibility(group)
                if node is not group and node.get("role") != "group" and node.get("bounds")
            ]
            if not descendants:
                return None
            return {"bounds": group.get("bounds"), "group": group, "visible_descendants": descendants}

        return self.wait_until(
            f"native Settings group and visible title {title}", visible_destination, timeout=12,
        )

    def open_settings(self) -> None:
        # A detail page can already own the panel; reopening resets to Home.
        # Do not blindly toggle: the compositor layer is the source of truth.
        self.close_quick_settings()
        self.open_quick_settings()
        self.click_named("open Settings from Quick Settings", "Configurações", role="button")
        self.wait_until(
            "Shade Settings window",
            lambda: any(
                client.get("title") == "Configurações"
                for client in self.clients()
            ),
            timeout=15,
        )

    def close_settings(self) -> None:
        settings_clients = [
            client for client in self.clients()
            if client.get("title") == "Configurações"
        ]
        if not settings_clients:
            return
        if len(settings_clients) != 1:
            raise Unsupported(f"Settings window target is ambiguous: {settings_clients}")
        address = str(settings_clients[0].get("address", ""))
        if not address:
            raise Unsupported(f"Settings window has no Hyprland address: {settings_clients[0]}")
        self.desktop(
            "closing the targeted Settings window",
            "hyprctl dispatch " + shlex.quote(f'hl.dsp.window.close({{window = "address:{address}"}})'),
        )
        self.wait_until(
            "Shade Settings closure",
            lambda: not any(client.get("address") == address for client in self.clients()),
            timeout=12,
        )

    def clients(self) -> list[dict[str, object]]:
        result = self.desktop("reading Hyprland clients", "hyprctl clients -j")
        clients = json.loads(result.stdout)
        if not isinstance(clients, list):
            raise RuntimeError(f"hyprctl clients returned a non-list: {clients!r}")
        return [client for client in clients if isinstance(client, dict)]

    def monitors(self) -> list[dict[str, object]]:
        result = self.desktop("reading Hyprland monitors", "hyprctl monitors -j")
        monitors = json.loads(result.stdout)
        if not isinstance(monitors, list):
            raise RuntimeError(f"hyprctl monitors returned a non-list: {monitors!r}")
        return [monitor for monitor in monitors if isinstance(monitor, dict)]

    def save_accessibility_tree(self, name: str) -> Path:
        tree = self.accessibility(
            f"capturing {name} AT-SPI tree",
            "tree",
            "--no-bounds",
            "--max-depth",
            "10",
            "--max-nodes",
            "2000",
        )
        path = self.artifacts / f"{name}-atspi-tree.json"
        path.write_text(json.dumps(tree, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return path

    def vnc(self, label: str, *args: str, timeout: int = 25) -> None:
        self.local(label, ["vncdo", "-s", f"127.0.0.1::{self.vnc_port}", *args], timeout=timeout)

    def capture(self, name: str) -> Path:
        path = self.artifacts / f"{name}.png"
        self.vnc(f"capture {name}", "capture", str(path))
        if not path.is_file() or path.stat().st_size < 1024:
            raise RuntimeError(f"VNC capture did not produce a usable artifact: {path}")
        return path

    def copy_guest_file(self, source: str, destination: Path) -> None:
        expected_size = int(self.guest(
            "reading completed guest artifact size",
            "stat -c %s -- " + shlex.quote(source),
        ).stdout.strip())
        self.local(
            f"copying guest artifact {source}",
            [
                "sshpass", "-p", SSH_PASSWORD, "scp", "-F", "/dev/null",
                "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                "-o", "LogLevel=ERROR", "-o", "PreferredAuthentications=password",
                "-o", "PubkeyAuthentication=no", "-P", str(self.ssh_port),
                f"{SSH_USER}@127.0.0.1:{source}", str(destination),
            ],
            timeout=90,
        )
        if not destination.is_file() or destination.stat().st_size != expected_size:
            raise RuntimeError(f"Guest artifact copy differs from its source: {destination}")

    def assert_visual_change(self, before: Path, after: Path, label: str) -> int:
        with tempfile.TemporaryDirectory(prefix="greeter-compare.", dir=self.artifacts) as temporary:
            first = Path(temporary) / "before.png"
            second = Path(temporary) / "after.png"
            for source, target in ((before, first), (after, second)):
                self.local(
                    f"cropping greeter form {label}",
                    ["magick", str(source), "-crop", "400x240+440+360", "+repage", str(target)],
                    timeout=25,
                )
            result = self.local(
                f"comparing greeter form {label}",
                ["magick", "compare", "-metric", "AE", str(first), str(second), "null:"],
                timeout=25,
                check=False,
            )
            try:
                changed = int(float((result.stderr.strip() or result.stdout.strip()).split()[0]))
            except (IndexError, ValueError) as exc:
                raise RuntimeError(f"Could not measure the greeter form change for {label}: {result.stderr or result.stdout}") from exc
            if changed < 30:
                raise RuntimeError(f"Greeter form did not visibly change for {label}: only {changed} pixels differed")
            return changed


    def wait_port(self, port: int, timeout: int, label: str) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.qemu is not None and self.qemu.poll() is not None:
                raise RuntimeError(f"QEMU exited during {label}; inspect {self.qemu_log}")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    return
            except OSError:
                time.sleep(1)
        raise RuntimeError(f"Timed out waiting for {label} on 127.0.0.1:{port}")

    def wait_guest(self) -> None:
        deadline = time.monotonic() + BOOT_TIMEOUT
        while time.monotonic() < deadline:
            result = self.guest("guest readiness", "systemctl is-active greetd", timeout=6, check=False)
            if result.returncode == 0 and result.stdout.strip() == "active":
                return
            if self.qemu is not None and self.qemu.poll() is not None:
                raise RuntimeError(f"QEMU exited before greetd became active; inspect {self.qemu_log}")
            time.sleep(2)
        raise RuntimeError("Guest SSH is ready, but greetd did not become active")

    def wait_greeter_visible(self, name: str) -> Path:
        path = self.artifacts / f"{name}.png"
        deadline = time.monotonic() + 120
        last_mean = "unavailable"
        while time.monotonic() < deadline:
            try:
                self.vnc(f"waiting for rendered greeter {name}", "capture", str(path))
                measured = self.local(
                    f"measuring greeter pixels {name}",
                    ["magick", str(path), "-format", "%[fx:mean]", "info:"],
                    timeout=25,
                    check=False,
                )
                if measured.returncode == 0:
                    last_mean = measured.stdout.strip()
                    if float(last_mean) > 0.15:
                        return path
            except (RuntimeError, ValueError):
                pass
            time.sleep(2)
        raise RuntimeError(f"Greeter did not render a usable screen within 120 seconds; mean pixel value {last_mean}")

    def wait_shell(self) -> None:
        deadline = time.monotonic() + LOGIN_TIMEOUT
        last_application_count = 0
        last_layer_count = 0
        while time.monotonic() < deadline:
            if self.user_service_active("Shade session readiness"):
                try:
                    probe = self.accessibility("AT-SPI readiness", "probe")
                    applications = probe.get("applications", [])
                    last_application_count = len(applications) if isinstance(applications, list) else 0
                    if probe.get("available") and last_application_count:
                        layers = self.layers()
                        last_layer_count = len(layers)
                        if any(
                            (int(layer.get("h", 0)) > 400 and 0 < int(layer.get("w", 0)) < 400)
                            or (int(layer.get("w", 0)) > 400 and 0 < int(layer.get("h", 0)) < 400)
                            for layer in layers
                        ):
                            return
                except (Unsupported, RuntimeError):
                    pass
            time.sleep(2)
        diagnostics = self.desktop(
            "collecting shell startup diagnostics",
            "systemctl --user status shade-shell.service --no-pager; "
            "journalctl --user --unit=shade-shell.service -b --no-pager -n 80",
            timeout=30,
            check=False,
        )
        detail = (diagnostics.stdout or diagnostics.stderr).strip()[-5000:]
        raise RuntimeError(
            "Virtual login did not produce a visible Shade session with AT-SPI "
            f"({last_application_count} accessible app(s), {last_layer_count} compositor layer(s)); {detail}"
        )

    def start(self) -> None:
        if not os.environ.get("IN_NIX_SHELL"):
            raise RuntimeError("Run this command inside `nix develop`; use `nix develop -c python3 scripts/vm-workflow-test.py`")
        if not ACCESSIBILITY.is_file():
            raise RuntimeError(f"Missing guest AT-SPI helper: {ACCESSIBILITY}")
        if not all(shutil.which(binary) for binary in ("sshpass", "vncdo", "magick")):
            raise RuntimeError("The development shell must provide sshpass, vncdo, and magick")

        build_started = time.monotonic()
        built = self.local(
            "building vm-vnc",
            ["nix", "build", "--no-link", "--print-out-paths", ".#nixosConfigurations.vm-vnc.config.system.build.vm"],
            timeout=3600,
        )
        self.phase_timings["nix_build"] = time.monotonic() - build_started
        vm_out = Path(built.stdout.strip().splitlines()[-1])
        launcher = vm_out / "bin/run-shade-vm-vm"
        if not launcher.is_file():
            raise RuntimeError(f"Nix build did not produce VM launcher: {launcher}")

        env = os.environ.copy()
        env.update(
            NIX_DISK_IMAGE=str(self.state / "disk.img"),
            QEMU_NET_OPTS=f"restrict=on,hostfwd=tcp:127.0.0.1:{self.ssh_port}-:22",
            QEMU_OPTS=(
                # The guest fixture pins virtio-vga to the legacy pci.0 bus.
                "-machine pc "
                f"-display vnc=127.0.0.1:{self.vnc_port - 5900} "
                f"-monitor unix:{self.monitor},server,nowait"
            ),
            TMPDIR=str(self.state),
        )
        boot_started = time.monotonic()
        with self.qemu_log.open("wb") as log:
            self.qemu = subprocess.Popen(
                [str(launcher)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.wait_port(self.vnc_port, BOOT_TIMEOUT, "VNC")
        self.wait_port(self.ssh_port, BOOT_TIMEOUT, "SSH")
        self.wait_guest()
        self.phase_timings["guest_boot_ready"] = time.monotonic() - boot_started
        setup_started = time.monotonic()
        self.local(
            "installing guest accessibility helper",
            [
                "sshpass", "-p", SSH_PASSWORD, "scp", "-P", str(self.ssh_port), "-F", "/dev/null",
                "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
                str(ACCESSIBILITY), f"{SSH_USER}@127.0.0.1:/tmp/shade-workflow-accessibility.py",
            ],
            timeout=45,
        )
        self.wait_greeter_visible("greeter-ready")
        self.phase_timings["helper_and_greeter_ready"] = time.monotonic() - setup_started

    def layers(self) -> list[dict[str, object]]:
        result = self.desktop("reading compositor layers", "hyprctl layers -j")
        try:
            raw = json.loads(result.stdout)
            return [layer for monitor in raw.values() for level in monitor.get("levels", {}).values() for layer in level]
        except (json.JSONDecodeError, AttributeError, TypeError) as exc:
            raise RuntimeError(f"hyprctl layers returned invalid JSON: {exc}")

    def write_results(self) -> None:
        report = {
            "artifacts": str(self.artifacts),
            "results": self.results,
            "timings": summarize_timing(
                self.results,
                self.phase_timings,
                self.command_timings,
                time.monotonic() - self.started_at,
            ),
        }
        with (self.artifacts / "results.json").open("w", encoding="utf-8") as output:
            json.dump(report, output, indent=2, ensure_ascii=False)
            output.write("\n")

    def record_result(self, name: str, status: str, detail: object, duration: float) -> None:
        result = {"scenario": name, "status": status, "duration_seconds": round(duration, 2), "evidence": detail}
        self.results.append(result)
        print(f"{status} {name}: {detail}", flush=True)
        self.write_results()

    def scenario(self, name: str, callback) -> None:
        started = time.monotonic()
        try:
            evidence = callback()
            status = "PASS"
            detail = evidence
        except Unsupported as exc:
            status = "UNSUPPORTED"
            detail = str(exc)
        except Exception as exc:
            status = "FAIL"
            detail = str(exc)
        self.record_result(name, status, detail, time.monotonic() - started)

    def test_greeter(self) -> dict[str, object]:
        if self.user_service_active("checking tester session before greeter test"):
            raise RuntimeError("Tester Shade session was already active before the greeter scenario")

        self.wait_until(
            "selected account starts its PAM worker without Continue",
            lambda: int(self.guest("checking native greeter authentication worker", "pgrep -c -x greetd").stdout.strip()) >= 3,
            timeout=15,
        )
        prompt = self.capture("greeter-automatic-password-prompt")
        self.vnc("submit invalid greeter password", "type", "shade-invalid", "key", "enter", "pause", "2")
        invalid = self.capture("greeter-invalid-password")
        invalid_change = self.assert_visual_change(prompt, invalid, "invalid password feedback")
        if self.user_service_active("verifying invalid login did not start Shade"):
            raise RuntimeError("Invalid password unexpectedly started the tester Shade session")
        self.vnc("return from greeter password prompt", "key", "esc", "pause", "1")
        back = self.capture("greeter-back")
        back_change = self.assert_visual_change(prompt, back, "Escape to user selection")
        # Back focuses the selected account button. Review the adjacent native
        # session chooser without changing its selection, then enter the real
        # test account through the separate manual-account form.
        self.vnc(
            "opening the native greeter session chooser",
            "key", "tab", "key", "tab", "key", "space", "pause", "0.4",
        )
        session_picker = self.capture("greeter-session-chooser")
        self.vnc(
            "opening the manual greeter account form without submitting credentials",
            "key", "esc", "key", "shift-tab", "key", "enter", "pause", "0.4",
            "type", "tester",
        )
        manual_account = self.capture("greeter-manual-account")
        self.vnc("starting PAM for the explicitly entered account", "key", "enter", "pause", "1")
        self.wait_until(
            "explicit retry starts the greeter PAM worker",
            lambda: int(self.guest("checking retried greeter authentication worker", "pgrep -c -x greetd").stdout.strip()) >= 3,
            timeout=15,
        )
        retry = self.capture("greeter-password-retry")
        retry_change = self.assert_visual_change(back, retry, "Continue after Back")
        self.vnc("submit test-account password", "type", SSH_PASSWORD, "key", "enter", "pause", "2")
        self.wait_shell()
        return {
            "ui": "The selected account started PAM without Continue; invalid password and Escape/Back were followed by session-chooser review and an explicit manual-account authentication retry",
            "visual_pixels_changed_in_form": {
                "invalid_response": invalid_change,
                "back": back_change,
                "retry": retry_change,
            },
            "guest": "invalid login left the Shade service inactive; valid login started Shade and registered AT-SPI",
            "screenshots": [str(prompt), str(invalid), str(back), str(session_picker), str(manual_account), str(retry)],
        }

    def test_launcher(self) -> dict[str, object]:
        if any(layer.get("namespace") == "shade-launcher" for layer in self.layers()):
            raise RuntimeError("Launcher was already open before its activation scenario")
        self.vnc("open launcher with Super+Space", "keydown", "super", "key", "space", "keyup", "super", "pause", "3")
        self.capture("launcher-open")
        self.save_accessibility_tree("launcher-open")
        entry = self.accessibility(
            "finding launcher search entry", "find", "--max-depth", "16", "--max-nodes", "2000",
            "--name", "", "--role", "text box",
        )
        launcher = self.wait_until(
            "launcher compositor layer",
            lambda: next(
                (layer for layer in self.layers() if layer.get("namespace") == "shade-launcher"),
                None,
            ),
            timeout=10,
        )
        self.vnc("close launcher with Escape", "key", "esc", "pause", "1")
        self.wait_until(
            "launcher closure after Escape",
            lambda: not any(layer.get("namespace") == "shade-launcher" for layer in self.layers()),
            timeout=10,
        )
        return {
            "ui": "VNC Super+Space opened the launcher; Escape removed its layer",
            "accessibility": entry,
            "guest": {"launcher_namespace": launcher.get("namespace")},
        }

    def wifi_control(self) -> dict[str, object]:
        return self.find_accessible_node("Wi-Fi:", role="toggle button", contains=True)

    def click_wifi_control(self, label: str) -> dict[str, object]:
        node = self.wifi_control()
        return self.accessibility(
            label, "click", "--max-depth", "24", "--max-nodes", "3000",
            "--name", str(node["name"]), "--role", "toggle button",
        )

    def test_quicksettings(self) -> dict[str, object]:
        self.vnc("open Quick Settings with Super+N", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")
        self.capture("quicksettings-open")
        self.save_accessibility_tree("quicksettings-open")
        wifi = self.wifi_control()
        opened = self.layers()
        quicksettings = next(
            (layer for layer in opened if layer.get("namespace") == "shade-quicksettings"),
            None,
        )
        if quicksettings is None:
            raise RuntimeError(f"Super+N did not add the Quick Settings layer: {opened}")
        quicksettings_geometry = tuple(quicksettings.get(key) for key in ("x", "y", "w", "h"))
        self.vnc("close Quick Settings with Super+N", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")
        remaining = self.layers()
        if quicksettings_geometry in {tuple(layer.get(key) for key in ("x", "y", "w", "h")) for layer in remaining}:
            raise RuntimeError("Quick Settings layer remained after its shortcut")
        return {"ui": "VNC Super+N opened and closed Quick Settings", "accessibility": wifi, "guest": {"quicksettings_geometry": quicksettings_geometry, "remaining_layer_count": len(remaining)}}

    def start_pattern_window(self, title: str = "Shade Area Recording Pattern", title_control: str | None = None) -> dict[str, object]:
        pattern = """import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
const app = new Gtk.Application({application_id: 'org.shade.WorkflowPattern'});
app.connect('activate', () => {
  const window = new Gtk.ApplicationWindow({application: app, title: __TITLE__});
  window.set_decorated(false);
  window.set_resizable(false);
  window.set_default_size(480, 320);
  const canvas = new Gtk.DrawingArea();
  canvas.set_content_width(480);
  canvas.set_content_height(320);
  canvas.set_draw_func((_area, cr) => {
    const cells = [
      [0, 0, 120, 160, 1, 0, 0], [120, 0, 120, 160, 0, 1, 0],
      [240, 0, 120, 160, 0, 0, 1], [360, 0, 120, 160, 1, 1, 1],
      [0, 160, 120, 160, 1, 0.5, 0], [120, 160, 120, 160, 0, 1, 1],
      [240, 160, 120, 160, 1, 0, 1], [360, 160, 120, 160, 1, 1, 0],
    ];
    cr.setSourceRGB(0.06, 0.06, 0.06);
    cr.paint();
    for (const [x, y, w, h, r, g, b] of cells) {
      cr.setSourceRGB(r, g, b);
      cr.rectangle(x, y, w, h);
      cr.fill();
    }
  });
  window.set_child(canvas);
  const titleControl = __TITLE_CONTROL__;
  if (titleControl) {
    const file = Gio.File.new_for_path(titleControl);
    file.replace_contents(new TextEncoder().encode(__TITLE__), null, false, Gio.FileCreateFlags.NONE, null);
    const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    monitor.connect('changed', () => {
      const [ok, contents] = file.load_contents(null);
      if (ok) window.set_title(new TextDecoder().decode(contents));
    });
    window.connect('destroy', () => monitor.cancel());
  }
  window.present();
});
app.run([]);""".replace("__TITLE__", json.dumps(title)).replace("__TITLE_CONTROL__", json.dumps(title_control))
        guest_script = "/tmp/shade-vm-pattern.mjs"
        code = """import json, os, sys
pid = sys.argv[1]
allowed = {b'GI_TYPELIB_PATH', b'LD_LIBRARY_PATH', b'XDG_DATA_DIRS',
           b'WAYLAND_DISPLAY', b'XDG_RUNTIME_DIR', b'DBUS_SESSION_BUS_ADDRESS'}
environment = {}
for entry in open('/proc/' + pid + '/environ', 'rb').read().split(b'\\0'):
    key, separator, value = entry.partition(b'=')
    if separator and key in allowed:
        environment[os.fsdecode(key)] = os.fsdecode(value)
print(json.dumps({'executable': os.readlink('/proc/' + pid + '/exe'), 'environment': environment}))"""
        runtime = json.loads(self.desktop(
            "reading the installed GTK fixture runtime",
            'pid=$(systemctl --user show shade-shell.service -p MainPID --value); python3 -c '
            + shlex.quote(code) + ' "$pid"',
        ).stdout)
        command = shlex.join([
            "env", "-u", "LD_PRELOAD",
            *[f"{name}={value}" for name, value in runtime["environment"].items()],
            runtime["executable"], "-m", guest_script,
        ])
        self.desktop(
            "creating deterministic guest capture pattern",
            f"printf %s {shlex.quote(pattern)} > {guest_script}; "
            f"systemd-run --user --no-block --collect --unit=shade-vm-pattern "
            f"{command}",
        )
        client = self.wait_until(
            "guest capture pattern window",
            lambda: next(
                (
                    item for item in self.clients()
                    if item.get("title") == title
                ),
                None,
            ),
            timeout=20,
        )
        address = str(client.get("address", ""))
        if not address.startswith("0x"):
            raise RuntimeError(f"Pattern window has no Hyprland client address: {client}")
        self.desktop(
            "placing deterministic capture pattern at non-origin coordinates",
            "hyprctl dispatch "
            + shlex.quote(f'hl.dsp.window.move({{x = 100, y = 100, window = "address:{address}"}})'),
        )
        geometry = self.wait_until(
            "positioned guest capture pattern",
            lambda: next(
                (
                    item for item in self.clients()
                    if item.get("address") == address
                    and item.get("at") == [100, 100]
                    and item.get("size") == [480, 320]
                ),
                None,
            ),
            timeout=12,
        )
        return geometry

    def stop_pattern_window(self) -> None:
        self.desktop(
            "stopping guest capture pattern",
            "systemctl --user stop shade-vm-pattern.service; "
            "rm -f /tmp/shade-vm-pattern.mjs",
            check=False,
        )

    def recording_processes(self) -> list[dict[str, object]]:
        code = """import glob, json, os
result = []
for path in glob.glob('/proc/[0-9]*/cmdline'):
    try:
        argv = [part.decode(errors='replace') for part in open(path, 'rb').read().split(b'\\0') if part]
        if argv and os.path.basename(argv[0]) in ('wf-recorder', 'wl-screenrec', 'gpu-screen-recorder'):
            result.append({'pid': int(path.split('/')[2]), 'backend': os.path.basename(argv[0]), 'argv': argv})
    except (OSError, ValueError):
        pass
print(json.dumps(result))"""
        result = self.desktop(
            "reading active recording backend process",
            "python3 -c " + shlex.quote(code),
            check=False,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or "Could not inspect recorder processes")
        processes = json.loads(result.stdout)
        return [process for process in processes if isinstance(process, dict)]

    def assert_recording_geometry(
        self, argv: list[str], x: int, y: int, width: int, height: int,
        *, edge_tolerance: int = 0,
    ) -> str:
        backend = Path(argv[0]).name if argv else ""
        if any(type(value) is not int for value in (x, y, width, height)):
            raise RuntimeError(f"Recording rectangle must contain integer pixels: {(x, y, width, height)}")
        if backend in {"wf-recorder", "wl-screenrec"}:
            flag, expected = "-g", f"{x},{y} {width}x{height}"
        elif backend == "gpu-screen-recorder":
            flag, expected = "-region", f"{width}x{height}+{x}+{y}"
        else:
            raise RuntimeError(f"Unknown recording backend: {argv}")
        if argv.count(flag) != 1:
            raise RuntimeError(f"Recorder must receive exactly one {flag} rectangle: {argv}")
        index = argv.index(flag) + 1
        if index >= len(argv):
            raise RuntimeError(f"{backend} did not receive {flag} {expected!r}: {argv}")
        actual = argv[index]
        if actual != expected:
            match = re.fullmatch(r"(-?\d+),(-?\d+) (\d+)x(\d+)", actual)
            if edge_tolerance and backend in {"wf-recorder", "wl-screenrec"} and match:
                ax, ay, aw, ah = map(int, match.groups())
                expected_edges = (x, y, x + width, y + height)
                actual_edges = (ax, ay, ax + aw, ay + ah)
                if all(abs(a - b) <= edge_tolerance for a, b in zip(actual_edges, expected_edges)):
                    return actual
            raise RuntimeError(f"{backend} did not receive {flag} {expected!r}: {argv}")
        return actual

    def stop_recording(self) -> None:
        try:
            node = self.accessibility(
                "finding visible recording Stop control",
                "find", "--description-match", "--name", "Parar gravação",
                "--role", "button",
            )
            self.click_accessible_node(node, "stop recording from its visible control")
        except (RuntimeError, Unsupported):
            self.desktop(
                "requesting graceful recorder stop during cleanup",
                "pkill -INT -x wf-recorder 2>/dev/null || true; "
                "pkill -INT -x wl-screenrec 2>/dev/null || true; "
                "pkill -INT -x gpu-screen-recorder 2>/dev/null || true",
                check=False,
            )
        self.wait_until(
            "recording backend to finalize",
            lambda: not self.recording_processes(),
            timeout=20,
        )

    def assert_recorded_pattern(
        self, video: Path, width: int, height: int, *, window: bool = False
    ) -> subprocess.CompletedProcess[str]:
        points = (
            [
                "60,40:#ff0000", "180,40:#00ff00", "300,40:#0000ff",
                "420,40:#ffffff", "60,240:#ff8000", "180,240:#00ffff",
                "300,240:#ff00ff", "420,240:#ffff00",
            ]
            if window
            else [
                "10,20:#ff0000", "55,20:#00ff00", "170,20:#0000ff",
                "300,20:#ffffff", "10,150:#ff8000", "55,150:#00ffff",
                "170,150:#ff00ff", "300,150:#ffff00",
            ]
            # Keep samples inside color blocks, away from 4:2:0 edge blending.
        )
        return self.local(
            f"asserting decoded crop content for {video.name}",
            [
                "python3", str(ROOT / "scripts/vm-recording-frame-assert.py"),
                str(video), str(width), str(height),
                "--tolerance", "24",
                *[arg for point in points for arg in ("--sample", point)],
            ],
            timeout=40,
        )

    def notification_dnd(self, enabled: bool | None = None) -> bool:
        self.activate_shell_action("open-notifications")
        try:
            tree = self.accessibility_tree("reading the current notification-center view")
            history_back = [
                candidate for candidate in self.walk_accessibility(tree)
                if candidate.get("name") == "Voltar às notificações" and candidate.get("role") == "button"
            ]
            if history_back:
                if len(history_back) != 1:
                    raise RuntimeError(f"Notification history Back control is ambiguous: {history_back}")
                self.click_accessible_node(history_back[0], "returning to notifications before reading Do Not Disturb")
            node = self.wait_until(
                "native Do Not Disturb switch",
                lambda: self.accessibility(
                    "finding native Do Not Disturb switch", "find", "--max-depth", "32",
                    "--max-nodes", "4000", "--include-state", "--actionable",
                    "--name", "Não perturbe", "--role", "switch",
                ),
                timeout=10,
            )
            def read_state() -> bool:
                current = self.accessibility(
                    "reading exact native Do Not Disturb state", "find", "--max-depth", "32",
                    "--max-nodes", "4000", "--include-state", "--name", "Não perturbe",
                    "--role", "switch", "--bus", str(node["bus"]), "--path", str(node["path"]),
                )
                return bool(int(current["state_words"][0]) & (1 << 4))

            initial = read_state()
            if enabled is not None and initial != enabled:
                self.click_accessible_node(node, "setting native Do Not Disturb state")
                self.wait_until(
                    "requested native Do Not Disturb state",
                    lambda: read_state() == enabled,
                    timeout=10,
                )
            return initial
        finally:
            self.activate_shell_action("close-all")

    def test_area_recording(self) -> dict[str, object]:
        original_engine_raw = self.gsetting("area-selection-engine")
        original_engine = original_engine_raw.strip("'\"")
        original_boundary = self.gsetting("show-recording-boundary")
        original_backend = self.gsetting("recorder-backend")
        original_dnd: bool | None = None
        pattern_started = False
        pattern: dict[str, object] = {}
        evidence: list[dict[str, object]] = []
        active_guest_videos: set[str] = set()
        log_marker = self.desktop("marking area recording log time", "date +%s").stdout.strip()
        try:
            original_dnd = self.notification_dnd()
            self.notification_dnd(True)
            self.gsetting("recorder-backend", "1")
            pattern_started = True
            pattern = self.start_pattern_window()
            if original_engine not in {"overlay", "slurp"}:
                raise Unsupported(f"Unknown area selection route persisted in settings: {original_engine!r}")
            client_at = pattern.get("at")
            client_size = pattern.get("size")
            if client_at != [100, 100] or client_size != [480, 320]:
                raise RuntimeError(f"Pattern geometry is not deterministic: at={client_at}, size={client_size}")
            x0, y0 = int(client_at[0]) + 80, int(client_at[1]) + 60
            x1, y1 = x0 + 320, y0 + 200
            monitors = self.monitors()
            if not monitors or x1 > int(monitors[0].get("width", 0)) or y1 > int(monitors[0].get("height", 0)):
                raise RuntimeError(f"Selected test rectangle is outside the primary output: {(x0, y0, x1, y1)}")
            for engine in ("overlay", "slurp"):
                for boundary in (False, True):
                    self.gsetting("area-selection-engine", f"'{engine}'")
                    self.gsetting("show-recording-boundary", "true" if boundary else "false")
                    before_layers = len(self.layers())
                    self.desktop(
                        f"starting {engine} area recording with boundary={boundary}",
                        "shade-shell record-area",
                    )
                    if engine == "overlay":
                        self.wait_until(
                            "in-shell area selection overlay",
                            lambda: len(self.layers()) > before_layers,
                            timeout=12,
                        )
                    else:
                        self.wait_until(
                            "slurp area selection process",
                            lambda: bool(self.desktop(
                                "checking slurp selector process",
                                "pgrep -x slurp",
                                check=False,
                            ).stdout.strip()),
                            timeout=12,
                        )
                    self.vnc(
                        f"selecting non-origin rectangle via {engine}",
                        "move", str(x0), str(y0), "mousedown", "1",
                        "move", str(x1), str(y1), "mouseup", "1",
                    )
                    if engine == "overlay":
                        self.vnc(f"reviewing {engine} rectangle", "key", "enter")
                        if self.recording_processes():
                            raise RuntimeError("Area selection/review started recording before explicit confirmation")
                        confirmation = self.wait_until(
                            "reviewed recording area confirmation",
                            lambda: self.find_accessible_node("Start recording", role="button"),
                            timeout=12,
                        )
                        self.click_accessible_node(confirmation, "confirming the reviewed recording area")
                    recorder = self.wait_until(
                        f"{engine} {boundary=} recorder",
                        lambda: next(iter(self.recording_processes()), None),
                        timeout=20,
                    )
                    argv = [str(arg) for arg in recorder.get("argv", [])]
                    # Absolute VNC tablet positions are fractional. Slurp floors
                    # pixel edges; GTK's selection path rounds them instead.
                    self.assert_recording_geometry(
                        argv, x0, y0, 320, 200,
                        edge_tolerance=1 if engine == "slurp" else 0,
                    )
                    output_index = argv.index("-f") + 1 if "-f" in argv else -1
                    if output_index < 0 or output_index >= len(argv):
                        raise RuntimeError(f"Recorder command has no output file: {argv}")
                    guest_video = argv[output_index]
                    active_guest_videos.add(guest_video)
                    screenshot = self.capture(f"area-recording-{engine}-boundary-{str(boundary).lower()}")
                    started = time.monotonic()
                    self.wait_until(
                        "capturing several finalized-pattern frames",
                        lambda: time.monotonic() - started >= 1.5 and bool(self.recording_processes()),
                        timeout=8,
                        interval=0.1,
                    )
                    self.stop_recording()
                    video = self.artifacts / (
                        f"area-recording-{engine}-boundary-{str(boundary).lower()}.mp4"
                    )
                    self.copy_guest_file(guest_video, video)
                    assertion = self.assert_recorded_pattern(video, 320, 200)
                    active_guest_videos.discard(guest_video)
                    self.desktop("removing guest area recording artifact", f"rm -f {shlex.quote(guest_video)}")
                    evidence.append({
                        "route": engine,
                        "boundary": boundary,
                        "backend": recorder.get("backend"),
                        "command": argv,
                        "selected_geometry": {"x": x0, "y": y0, "width": 320, "height": 200},
                        "middle_frame_assertion": assertion.stdout.strip(),
                        "video": str(video),
                        "overlay_evidence": str(screenshot),
                    })
            logs = self.desktop(
                "collecting area recording route and geometry logs",
                f"journalctl --user -u shade-shell.service --since @{log_marker} --no-pager",
                check=False,
            )
            log_path = self.artifacts / "area-recording-shell.log"
            log_path.write_text(logs.stdout + logs.stderr, encoding="utf-8")
            return {
                "ui": "The in-shell and slurp area selectors each received a real pointer-drag rectangle.",
                "guest": {
                    "pattern_window": {
                        "title": pattern.get("title"),
                        "at": pattern.get("at"),
                        "size": pattern.get("size"),
                    },
                    "routes": evidence,
                    "shell_log": str(log_path),
                },
            }
        finally:
            try:
                if any(layer.get("namespace") == "shade-screenshot" for layer in self.layers()):
                    self.vnc("canceling the unfinished guest selection overlay", "key", "esc", "pause", "0.3")
                if self.recording_processes():
                    self.stop_recording()
            finally:
                try:
                    self.gsetting("area-selection-engine", original_engine_raw)
                finally:
                    try:
                        self.gsetting("show-recording-boundary", original_boundary)
                    finally:
                        try:
                            for guest_video in active_guest_videos:
                                self.desktop(
                                    "removing unfinished guest area recording",
                                    f"rm -f {shlex.quote(guest_video)}",
                                    check=False,
                                )
                        finally:
                            try:
                                if pattern_started:
                                    self.stop_pattern_window()
                            finally:
                                try:
                                    self.gsetting("recorder-backend", original_backend)
                                finally:
                                    if original_dnd is not None:
                                        self.notification_dnd(original_dnd)

    def wait_bar_position(self, position: str, raw_value: str, timeout: float = 20) -> dict[str, object]:
        deadline = time.monotonic() + timeout
        consecutive: list[dict[str, object]] = []
        last: dict[str, object] = {}
        while time.monotonic() < deadline:
            raw = self.gsetting("position")
            geometry = self.bar_position_from_layers(self.layers())
            last = {"stored_raw": raw, "geometry": geometry}
            if raw == raw_value and geometry == position:
                consecutive.append(last)
                if len(consecutive) == 3:
                    return {**last, "samples": consecutive}
            else:
                consecutive.clear()
            time.sleep(0.25)
        raise RuntimeError(
            f"Bar did not converge to {position} ({raw_value}) over three stable samples: {last}"
        )

    def test_settings_position(self) -> dict[str, object]:
        saved_raw = self.gsetting("position")
        saved_position = {2: "Top", 8: "Left", 4: "Right", 16: "Bottom"}.get(int(saved_raw))
        initial_geometry = self.bar_position_from_layers(self.layers())
        opened_settings = False
        restored_raw = None
        restoration = None
        try:
            self.open_settings()
            opened_settings = True
            self.save_accessibility_tree("settings-home")
            page = self.settings_page("Barra e dock")
            self.capture("settings-bar-position")
            self.save_accessibility_tree("settings-bar-position")
            bounds = page.get("bounds")
            if not isinstance(bounds, list) or len(bounds) != 4 or int(bounds[2]) < 400 or int(bounds[3]) < 400:
                raise RuntimeError(f"Bar & Dock page is not selected in Settings: {page}")

            self.click_named("establishing known Top bar baseline", "Superior", role="radio")
            top = self.wait_bar_position("Top", "2")
            self.click_named("moving visible Bar position control to Left", "Esquerda", role="radio")
            left = self.wait_bar_position("Left", "8")
            self.capture("bar-left")
            self.click_named("moving visible Bar position control to Right", "Direita", role="radio")
            right = self.wait_bar_position("Right", "4")
            self.capture("bar-right")
            self.click_named("moving visible Bar position control to Bottom", "Inferior", role="radio")
            bottom = self.wait_bar_position("Bottom", "16")
            bottom_capture = self.capture("bar-bottom")
            bottom_layers = self.layers()
            screen_height = max(
                (int(layer.get("y", 0)) + int(layer.get("h", 0)) for layer in bottom_layers),
                default=0,
            )
            bottom_bar = next(
                (
                    layer for layer in bottom_layers
                    if int(layer.get("y", -1)) + int(layer.get("h", 0)) >= screen_height - 4
                    and int(layer.get("w", 0)) > 400
                ),
                None,
            )
            if bottom_bar is None:
                raise RuntimeError(f"Bottom position preference produced no bottom-edge bar layer: {bottom_layers}")
        finally:
            try:
                restored_raw = self.gsetting("position", saved_raw)
                if restored_raw != saved_raw:
                    raise RuntimeError(f"Raw bar position restoration failed: {saved_raw} -> {restored_raw}")
                if saved_position is not None:
                    restoration = self.wait_bar_position(saved_position, saved_raw)
                else:
                    restoration = {
                        "stored_raw": restored_raw,
                        "geometry": self.bar_position_from_layers(self.layers()),
                    }
            finally:
                try:
                    if opened_settings:
                        self.close_settings()
                finally:
                    self.close_quick_settings()

        if restored_raw != saved_raw or (
            saved_position is not None and restoration.get("geometry") != saved_position
        ):
            raise RuntimeError(
                f"Restoring saved bar state failed: raw {saved_raw}->{restored_raw}, "
                f"expected geometry {saved_position}, got {restoration}"
            )
        return {
            "ui": "Native Bar & Dock controls exercised all four edges and restored the exact saved position.",
            "guest": {
                "saved_raw": saved_raw,
                "saved_position": saved_position,
                "initial_geometry": initial_geometry,
                "top_stable_samples": top,
                "left_stable_samples": left,
                "right_stable_samples": right,
                "bottom_stable_samples": bottom,
                "bottom_layer": bottom_bar,
                "bottom_screenshot": str(bottom_capture),
                "restored_raw": restored_raw,
                "restoration": restoration,
            },
            "accessibility": {"page": page},
        }

    def test_wifi(self) -> dict[str, object]:
        self.open_quick_settings()
        try:
            self.wait_until(
                "Quick Settings Wi-Fi toggle",
                lambda: self.find_accessible_node("Wi-Fi:", role="toggle button", contains=True),
                timeout=10,
            )
            button = self.wifi_control()
            initial = self.guest("reading initial Wi-Fi radio", "nmcli radio wifi", timeout=30).stdout.strip()
            if initial != "enabled":
                raise RuntimeError(f"Wi-Fi test fixture must start enabled: got {initial!r}")
            self.click_wifi_control("turning Wi-Fi off in Quick Settings")
            off = self.wait_until(
                "guest NetworkManager Wi-Fi radio disabled",
                lambda: (
                    state if (state := self.guest(
                        "waiting for Wi-Fi radio disabled",
                        "nmcli radio wifi",
                    ).stdout.strip()) == "disabled" else None
                ),
                timeout=20,
            )
            self.capture("wifi-radio-off")
            self.click_wifi_control("turning Wi-Fi on in Quick Settings")
            on = self.wait_until(
                "guest NetworkManager Wi-Fi radio enabled",
                lambda: (
                    state if (state := self.guest(
                        "waiting for Wi-Fi radio enabled",
                        "nmcli radio wifi",
                    ).stdout.strip()) == "enabled" else None
                ),
                timeout=20,
            )
            self.guest("requesting a fresh guest Wi-Fi scan", "nmcli device wifi rescan ifname wlan0", timeout=15, check=False)
            scan = self.guest("scanning guest-local test access point", "nmcli -t -f SSID device wifi list ifname wlan0", timeout=15, check=False)
            for _ in range(4):
                if "Shade-Test" in scan.stdout:
                    break
                time.sleep(2)
                self.guest("requesting another guest Wi-Fi scan", "nmcli device wifi rescan ifname wlan0", timeout=15, check=False)
                scan = self.guest("retrying guest-local test access point scan", "nmcli -t -f SSID device wifi list ifname wlan0", timeout=15, check=False)
            if "Shade-Test" not in scan.stdout:
                raise Unsupported("Wi-Fi control toggled successfully, but the guest-local Shade-Test AP was not visible in NetworkManager scan output")
            state = self.guest("reading Wi-Fi connection state", "nmcli -t -f DEVICE,STATE,CONNECTION device status").stdout.strip()
            self.click_named("opening Wi-Fi details after radio controls", "Wi-Fi details", role="button")
            self.wait_until(
                "Wi-Fi detail route", lambda: self.find_accessible_node("Wi-Fi", role="window"), timeout=12
            )
            self.capture("wifi-radio-details")
            self.accessibility("returning to Quick Settings home", "click", "--name", "Voltar", "--role", "button")
            return {"ui": "AT-SPI Click actions on the WiFi toggle changed radio state both ways", "guest": {"radio_initial": initial, "radio_off": off, "radio_on": on, "devices": state, "scan": scan.stdout.strip()}, "accessibility": button}
        finally:
            self.vnc("close Quick Settings", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")
    
    def wifi_device(self) -> str:
        code = """import subprocess
rows = subprocess.check_output(['nmcli', '-t', '-e', 'no', '-f', 'DEVICE,TYPE', 'device', 'status'], text=True)
devices = [row.split(':', 1)[0] for row in rows.splitlines() if row.endswith(':wifi')]
devices = [device for device in devices if device != 'wlan1']
print(devices[0] if devices else '')"""
        device = self.guest(
            "identifying guest Wi-Fi client device",
            "python3 -c " + shlex.quote(code),
        ).stdout.strip()
        if not device:
            raise Unsupported("The guest has no NetworkManager Wi-Fi client device")
        return device

    def wifi_test_profiles(self) -> list[str]:
        code = """import subprocess
uuids = subprocess.check_output(['nmcli', '-t', '-f', 'UUID', 'connection', 'show'], text=True).splitlines()
matches = []
for uuid in uuids:
    try:
        ssid = subprocess.check_output(['nmcli', '-g', '802-11-wireless.ssid', 'connection', 'show', uuid], text=True, stderr=subprocess.DEVNULL).strip()
        if ssid == 'Shade-Test':
            matches.append(uuid)
    except subprocess.CalledProcessError:
        pass
print('\\n'.join(matches))"""
        result = self.guest(
            "reading guest Shade-Test saved profiles",
            "python3 -c " + shlex.quote(code),
        )
        return [line for line in result.stdout.splitlines() if line]

    def wifi_guest_state(self, device: str) -> dict[str, object]:
        code = """import json, subprocess
device = __import__('sys').argv[1]
rows = subprocess.check_output(['nmcli', '-t', '-e', 'no', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status'], text=True)
status = next((row.split(':', 3) for row in rows.splitlines() if row.split(':', 1)[0] == device), [])
aps = subprocess.check_output(['nmcli', '-t', '-e', 'no', '-f', 'IN-USE,SSID', 'device', 'wifi', 'list', 'ifname', device], text=True)
selected = [row.split(':', 1)[1] for row in aps.splitlines() if row.startswith('*:')]
addresses = json.loads(subprocess.check_output(['ip', '-j', 'address', 'show', 'dev', device], text=True))
ipv4 = [item['local'] for info in addresses for item in info.get('addr_info', []) if item.get('family') == 'inet']
print(json.dumps({'device': device, 'status': status, 'selected_ssids': selected, 'ipv4': ipv4, 'scan': aps}))"""
        result = self.guest(
            "reading independent guest Wi-Fi and DHCP state",
            "python3 -c " + shlex.quote(code) + " " + shlex.quote(device),
        )
        return json.loads(result.stdout)

    def test_wifi_credentials(self) -> dict[str, object]:
        initial_radio = self.guest("snapshotting guest Wi-Fi radio", "nmcli radio wifi").stdout.strip()
        if initial_radio not in {"enabled", "disabled"}:
            raise RuntimeError(f"Unexpected initial Wi-Fi radio state: {initial_radio!r}")
        device = self.wifi_device()
        original_profiles = self.wifi_test_profiles()
        opened_quick_settings = False
        profiles_after_connect: list[str] = []
        connection_evidence: dict[str, object] | None = None
        connection_attempted = False
        try:
            # An old fixture profile would skip credential entry, so remove only this guest-local test SSID.
            for uuid in original_profiles:
                self.guest(
                    "clearing stale guest test AP profile before credential entry",
                    f"nmcli connection delete uuid {shlex.quote(uuid)}",
                )
            self.open_quick_settings()
            opened_quick_settings = True
            current_radio = self.guest("checking guest Wi-Fi before connection", "nmcli radio wifi").stdout.strip()
            if current_radio == "disabled":
                self.click_wifi_control("enabling guest Wi-Fi in Quick Settings")
                self.wait_until(
                    "guest Wi-Fi radio enabled",
                    lambda: self.guest("waiting for guest Wi-Fi radio", "nmcli radio wifi").stdout.strip() == "enabled",
                    timeout=20,
                )
            self.click_named("opening Wi-Fi details", "Wi-Fi details", role="button")
            self.click_named("scanning guest Wi-Fi access points", "Buscar redes", role="button")
            self.wait_until(
                "guest-local Shade-Test AP in NetworkManager",
                lambda: "Shade-Test" in str(self.wifi_guest_state(device).get("scan", "")),
                timeout=25,
            )
            self.click_named(
                "selecting guest-local Shade-Test network", "Shade-Test", role="button", contains=True
            )
            self.wait_until(
                "Shade-Test credential prompt",
                lambda: self.find_accessible_node("Senha de Shade-Test", role="text box"),
                timeout=8,
            )
            connection_attempted = True
            self.vnc("entering guest-local AP credential", "type", "shade-test", "key", "enter")
            connection_evidence = self.wait_until(
                "guest Wi-Fi connection with DHCP address",
                lambda: (
                    state
                    if (
                        (state := self.wifi_guest_state(device)).get("selected_ssids") == ["Shade-Test"]
                        and any(str(address).startswith("10.42.0.") for address in state.get("ipv4", []))
                    )
                    else None
                ),
                timeout=45,
            )
            profiles_after_connect = self.wifi_test_profiles()
            if not profiles_after_connect:
                raise RuntimeError("NetworkManager connected but did not save the guest Shade-Test profile")
            self.capture("wifi-credentials-connected")
            self.click_named(
                "disconnecting guest Shade-Test from its visible row",
                "Shade-Test", role="button", contains=True,
            )
            disconnected = self.wait_until(
                "guest Wi-Fi disconnection",
                lambda: (
                    state
                    if (
                        (state := self.wifi_guest_state(device)).get("selected_ssids") == []
                        and not any(str(address).startswith("10.42.0.") for address in state.get("ipv4", []))
                    )
                    else None
                ),
                timeout=30,
            )
            return {
                "ui": "Opened the Shade Wi-Fi access-point list, entered the guest AP credential, then disconnected from its visible row.",
                "guest": {
                    "device": device,
                    "initial_radio": initial_radio,
                    "connected": connection_evidence,
                    "disconnected": disconnected,
                    "saved_profile_uuids": profiles_after_connect,
                    "initial_test_profiles_removed": original_profiles,
                },
            }
        finally:
            try:
                if connection_attempted:
                    self.guest(
                        "ensuring guest test AP is disconnected",
                        f"nmcli device disconnect {shlex.quote(device)}",
                        check=False,
                    )
                for uuid in self.wifi_test_profiles():
                    self.guest(
                        "removing guest Shade-Test saved profile",
                        f"nmcli connection delete uuid {shlex.quote(uuid)}",
                        check=False,
                    )
                if opened_quick_settings:
                    current_radio = self.guest(
                        "checking guest Wi-Fi radio for restoration", "nmcli radio wifi"
                    ).stdout.strip()
                    if current_radio != initial_radio:
                        self.click_wifi_control("restoring original guest Wi-Fi radio state")
                        self.wait_until(
                            "original guest Wi-Fi radio state",
                            lambda: self.guest(
                                "verifying restored guest Wi-Fi radio", "nmcli radio wifi"
                            ).stdout.strip() == initial_radio,
                            timeout=20,
                        )
            finally:
                if opened_quick_settings:
                    self.close_quick_settings()

    def test_window_target_capture(self) -> dict[str, object]:
        original_audio = self.gsetting("record-audio")
        original_backend = self.gsetting("recorder-backend")
        original_dnd: bool | None = None
        overlay_open = False
        guest_video: str | None = None
        screenshot_guest: str | None = None
        pattern_started = False
        pattern: dict[str, object] = {}
        try:
            original_dnd = self.notification_dnd()
            self.notification_dnd(True)
            self.gsetting("recorder-backend", "1")
            pattern_started = True
            pattern = self.start_pattern_window()
            client_size = pattern.get("size")
            client_at = pattern.get("at")
            if client_size != [480, 320] or client_at != [100, 100]:
                raise RuntimeError(f"Window capture pattern geometry is not deterministic: {pattern}")
            screenshot_marker = self.desktop(
                "marking window-target screenshot artifact time", "date +%s.%N"
            ).stdout.strip()
            overlay_open = True
            self.desktop("opening Shade capture target picker", "shade-shell screenshot-overlay")
            self.wait_until(
                "Shade screenshot target picker",
                lambda: any(layer.get("namespace") == "shade-screenshot" for layer in self.layers()),
                timeout=12,
            )
            image_mode = self.find_accessible_node("Image", role="toggle button")
            image_state = self.accessibility(
                "reading the retained capture mode", "find", "--name", "Image",
                "--role", "toggle button", "--bus", str(image_mode["bus"]),
                "--path", str(image_mode["path"]), "--include-state",
            )
            # A previous area recording deliberately leaves Recording selected.
            # GTK toggle buttons expose PRESSED; CHECKED also covers radio roles.
            if not image_state["state_words"][0] & ((1 << 20) | (1 << 4)):
                self.click_accessible_node(image_mode, "selecting explicit Image mode")
            self.click_named("choosing Window screenshot target", "Window", role="toggle button")
            self.capture("window-target-before-selection")
            self.vnc(
                "selecting guest pattern window for screenshot",
                "move", "340", "260", "click", "1", "pause", "0.3", "key", "enter",
            )
            self.capture("window-target-after-selection")
            if self.recording_processes():
                raise RuntimeError("Reviewing a screenshot unexpectedly started a recorder")
            confirmation = self.wait_until(
                "reviewed window image confirmation",
                lambda: self.find_accessible_node("Capture image", role="button"),
                timeout=12,
            )
            self.click_accessible_node(confirmation, "confirming the reviewed window image")
            self.wait_until(
                "window screenshot overlay closure",
                lambda: not any(layer.get("namespace") == "shade-screenshot" for layer in self.layers()),
                timeout=12,
            )
            overlay_open = False
            screenshots = self.wait_until(
                "window-target screenshot artifact",
                lambda: json.loads(
                    self.desktop(
                        "finding new window-target screenshot",
                        "python3 -c " + shlex.quote(
                            "import json,pathlib,sys; "
                            "p=pathlib.Path.home()/'Pictures/Screenshots'; "
                            "files=sorted((f for f in p.glob('*.png') if f.stat().st_mtime >= float(sys.argv[1])-1), "
                            "key=lambda f:f.stat().st_mtime); print(json.dumps([str(f) for f in files]))"
                        ) + " " + shlex.quote(screenshot_marker),
                    ).stdout
                ),
                timeout=15,
                interval=0.25,
            )
            screenshot_guest = screenshots[-1]
            screenshot = self.artifacts / "window-target.png"
            self.copy_guest_file(screenshot_guest, screenshot)
            image_probe = self.local(
                "checking selected-window screenshot dimensions and pattern pixels",
                [
                    "magick", str(screenshot), "-format",
                    "%w %h %[fx:round(255*p{60,40}.r)] %[fx:round(255*p{60,40}.g)] "
                    "%[fx:round(255*p{60,40}.b)]",
                    "info:",
                ],
            ).stdout.split()
            if image_probe[:2] != ["480", "320"] or image_probe[2:] != ["255", "0", "0"]:
                raise RuntimeError(f"Window screenshot is not the selected guest window: {image_probe}")

            self.gsetting("record-audio", "false")
            record_marker = self.desktop(
                "marking window-target recording time", "date +%s.%N"
            ).stdout.strip()
            overlay_open = True
            self.desktop("opening Shade recording target picker", "shade-shell screenshot-overlay")
            self.wait_until(
                "Shade recording target picker",
                lambda: any(layer.get("namespace") == "shade-screenshot" for layer in self.layers()),
                timeout=12,
            )
            self.click_named("selecting Recording mode", "Recording", role="toggle button")
            self.click_named("selecting Window recording target", "Window", role="toggle button")
            self.vnc(
                "selecting guest pattern window for recording",
                "move", "340", "260", "click", "1", "pause", "0.3", "key", "enter",
            )
            if self.recording_processes():
                raise RuntimeError("Selecting a window started recording before explicit confirmation")
            confirmation = self.wait_until(
                "reviewed window recording confirmation",
                lambda: self.find_accessible_node("Start recording", role="button"),
                timeout=12,
            )
            self.click_accessible_node(confirmation, "confirming the reviewed window recording")
            self.wait_until(
                "window recording target overlay closure",
                lambda: not any(layer.get("namespace") == "shade-screenshot" for layer in self.layers()),
                timeout=12,
            )
            overlay_open = False
            recorder = self.wait_until(
                "window-target recording backend",
                lambda: next(iter(self.recording_processes()), None),
                timeout=20,
            )
            argv = [str(arg) for arg in recorder.get("argv", [])]
            expected_geometry = self.assert_recording_geometry(argv, 100, 100, 480, 320)
            if any(arg in {"-a", "--audio"} or arg.startswith("--audio=") for arg in argv):
                raise RuntimeError(f"Audio was enabled in a window-target recording command: {argv}")
            if self.gsetting("record-audio") != "false":
                raise RuntimeError("Recording audio preference did not remain disabled for the UI recording")
            output_index = argv.index("-f") + 1 if "-f" in argv else -1
            if output_index < 0 or output_index >= len(argv):
                raise RuntimeError(f"Window recorder command has no output path: {argv}")
            guest_video = argv[output_index]
            started = time.monotonic()
            self.wait_until(
                "capturing window recording frames",
                lambda: time.monotonic() - started >= 1.5 and bool(self.recording_processes()),
                timeout=8,
                interval=0.1,
            )
            self.capture("window-target-recording-active")
            self.stop_recording()
            video = self.artifacts / f"window-target{Path(guest_video).suffix}"
            self.copy_guest_file(guest_video, video)
            assertion = self.assert_recorded_pattern(video, 480, 320, window=True)
            self.desktop("removing guest window recording", f"rm -f {shlex.quote(guest_video)}")
            guest_video = None
            logs = self.desktop(
                "collecting window capture command evidence",
                f"journalctl --user -u shade-shell.service --since @{int(float(record_marker))} --no-pager",
                check=False,
            )
            return {
                "ui": "Shade's target picker selected the test window for a screenshot and a short recording; recording audio was disabled.",
                "guest": {
                    "window": {"title": pattern.get("title"), "at": client_at, "size": client_size},
                    "screenshot": str(screenshot),
                    "screenshot_probe": image_probe,
                    "recorder_backend": recorder.get("backend"),
                    "recorder_command": argv,
                    "recorded_geometry": expected_geometry,
                    "audio_enabled": False,
                    "middle_frame_assertion": assertion.stdout.strip(),
                    "video": str(video),
                    "shell_log": logs.stdout + logs.stderr,
                    "screenshot_marker": screenshot_marker,
                },
            }
        finally:
            try:
                if self.recording_processes():
                    self.stop_recording()
            finally:
                try:
                    if overlay_open and not self.recording_processes():
                        self.vnc("cancelling remaining capture overlay", "key", "esc")
                finally:
                    try:
                        self.gsetting("record-audio", original_audio)
                    finally:
                        try:
                            if guest_video:
                                self.desktop(
                                    "removing unfinished guest window recording",
                                    f"rm -f {shlex.quote(guest_video)}",
                                    check=False,
                                )
                            if screenshot_guest:
                                self.desktop(
                                    "removing guest window-target screenshot",
                                    f"rm -f {shlex.quote(screenshot_guest)}",
                                    check=False,
                                )
                        finally:
                            try:
                                if pattern_started:
                                    self.stop_pattern_window()
                            finally:
                                try:
                                    self.gsetting("recorder-backend", original_backend)
                                finally:
                                    if original_dnd is not None:
                                        self.notification_dnd(original_dnd)

    def test_settings_page_registry(self) -> dict[str, object]:
        destinations = [
            "Aparência", "Barra e dock", "Telas", "Som", "Mouse e touchpad",
            "Conexões", "Bluetooth", "Bloqueio e energia", "Energia", "Notificações",
            "Não perturbe", "Captura de tela", "Compartilhamento de tela",
            "Aplicativos padrão", "Aplicativos ao entrar", "Relógio", "Clima",
            "Temporizador", "Atalhos", "Sobre o sistema", "Diagnóstico",
        ]
        visited: list[dict[str, object]] = []
        opened_settings = False
        try:
            self.open_settings()
            opened_settings = True
            for title in destinations:
                page = self.settings_page(title)
                screenshot = self.capture(f"settings-destination-{len(visited) + 1:02d}")
                visited.append({"title": title, "page": page, "screenshot": str(screenshot)})
            self.settings_search("Bluetooth")
            search_result = self.wait_until(
                "global Settings exact Bluetooth result",
                lambda: self.find_in_group(self.accessibility_tree("reading global search results"),
                    "Resultados de busca", "Bluetooth", role="list item"),
                timeout=12,
            )
            self.vnc("open Bluetooth from global Settings search", "key", "enter")
            bluetooth = self.wait_until(
                "Bluetooth destination opened from search",
                lambda: next((
                    {"bounds": node.get("bounds"), "group": node, "visible_descendants": [
                        child for child in self.walk_accessibility(node)
                        if child is not node and child.get("role") != "group" and child.get("bounds")
                    ]}
                    for node in self.walk_accessibility(self.accessibility_tree("reading opened Bluetooth destination"))
                    if node.get("role") == "group" and node.get("name") == "Bluetooth"
                    and any(child is not node and child.get("role") != "group" and child.get("bounds")
                            for child in self.walk_accessibility(node))
                ), None),
                timeout=10,
            )
            self.accessibility(
                "returning to global Settings search", "click", "--name", "Voltar",
                "--role", "button", "--description-match",
            )
            restored_result = self.wait_until(
                "restored Bluetooth search result with preserved query",
                lambda: self.find_in_group(self.accessibility_tree("reading restored search results"),
                    "Resultados de busca", "Bluetooth", role="list item"),
                timeout=10,
            )
            self.wait_until(
                "restored Settings search field",
                lambda: self.find_accessible_node("Buscar nas configurações", role="search box"),
                timeout=10,
            )
            return {
                "ui": "Visited the 21 Settings destinations and returned from global search results with the query intact.",
                "guest": {"visited_destinations": visited, "destination_count": len(visited)},
                "accessibility": {
                    "search_result": search_result,
                    "opened_destination": bluetooth,
                    "restored_search_result": restored_result,
                },
            }
        finally:
            if opened_settings:
                self.close_settings()
            self.close_quick_settings()
    def test_settings_search_keyboard(self) -> dict[str, object]:
        opened_settings = False
        try:
            self.open_settings()
            opened_settings = True
            # Keep typing and Enter on one VNC connection: a second SSH/AT-SPI
            # command would let the native debounce expire before the key.
            self.vnc(
                "type and immediately open Bluetooth before search debounce settles",
                "keydown", "ctrl", "key", "f", "keyup", "ctrl", "pause", "0.2",
                "keydown", "ctrl", "key", "a", "keyup", "ctrl",
                "type", "Bluetooth", "key", "enter", "pause", "0.5",
            )
            bluetooth = self.wait_until(
                "Bluetooth destination opened by immediate search Enter",
                lambda: next((
                    {"bounds": node.get("bounds"), "group": node, "visible_descendants": [
                        child for child in self.walk_accessibility(node)
                        if child is not node and child.get("role") != "group" and child.get("bounds")
                    ]}
                    for node in self.walk_accessibility(self.accessibility_tree("reading immediate Bluetooth destination"))
                    if node.get("role") == "group" and node.get("name") == "Bluetooth"
                    and any(child is not node and child.get("role") != "group" and child.get("bounds")
                            for child in self.walk_accessibility(node))
                ), None),
                timeout=10,
            )
            self.vnc("returning to preserved Settings search with Escape", "key", "esc")
            restored_result = self.wait_until(
                "restored Bluetooth result after immediate keyboard navigation",
                lambda: self.find_in_group(self.accessibility_tree("reading immediate search restoration"),
                    "Resultados de busca", "Bluetooth", role="list item"),
                timeout=10,
            )
            return {
                "ui": "Global UTF8 query opened the native Bluetooth group by immediate physical Enter before debounce, then Back preserved the query result.",
                "accessibility": {"opened_destination": bluetooth, "restored_search_result": restored_result},
            }
        finally:
            if opened_settings:
                self.close_settings()
            self.close_quick_settings()


    def test_displays_preview(self) -> dict[str, object]:
        initial_monitors = self.monitors()
        initial_primary = next((item for item in initial_monitors if item.get("name") == "Virtual-1"), None)
        if initial_primary is None:
            raise Unsupported("Guest primary Virtual-1 output is unavailable")
        fixture_started = False
        settings_open = False
        preview_pending = False
        reverted = None
        try:
            self.desktop(
                "enabling guest-only secondary output",
                "systemctl --user start shade-vm-secondary-display.service",
            )
            fixture_started = True
            with_secondary = self.wait_until(
                "guest Virtual-2 output",
                lambda: next(
                    (item for item in self.monitors() if item.get("name") == "Virtual-2"),
                    None,
                ),
                timeout=20,
            )
            self.open_settings()
            settings_open = True
            page = self.settings_page("Telas")
            tree = self.accessibility_tree("reading display controls before preview")
            self.save_accessibility_tree("settings-displays-preview")
            change_groups = [
                node for node in self.walk_accessibility(tree)
                if node.get("name") == "Revisar alterações" and any(
                    child.get("name") == "Aplicar alterações" and child.get("role") == "button"
                    for child in self.walk_accessibility(node)
                )
            ]
            if not change_groups:
                raise Unsupported("Native Revisar alterações action group is unavailable")
            def current_revert():
                return self.find_in_group(
                    self.accessibility_tree("reading current display transaction actions"),
                    "Revisar alterações", "Reverter", role="button",
                )
            scale_controls = [
                node for node in self.nodes_in_group(tree, "Telas conectadas")
                if str(node.get("role", "")).casefold() == "spin button"
                and isinstance(node.get("bounds"), list)
                and len(node["bounds"]) == 4
            ]
            if len(scale_controls) < 2:
                raise Unsupported(
                    f"Displays page did not expose both guest output scale controls: "
                    f"{[{key: node.get(key) for key in ('name', 'role', 'bounds')} for node in scale_controls]}"
                )
            primary_scale = float(initial_primary.get("scale", 1.0))
            target_scale = 1.25 if abs(primary_scale - 1.25) > 0.01 else 1.5
            def primary_scale_control():
                current = self.accessibility_tree("reacquiring Virtual-1 native scale editor")
                identity = initial_primary.get("description") or initial_primary["name"]
                editors = [
                    node for node in self.nodes_in_group(current, "Telas conectadas")
                    if any(child.get("name") == identity for child in self.walk_accessibility(node))
                    and len([child for child in self.walk_accessibility(node)
                             if str(child.get("role", "")).casefold() == "spin button"]) == 1
                ]
                if not editors:
                    raise RuntimeError(f"No unique scale editor for Virtual-1 identity {identity!r}")
                editor = min(editors, key=lambda node: len(list(self.walk_accessibility(node))))
                return next(child for child in self.walk_accessibility(editor)
                            if str(child.get("role", "")).casefold() == "spin button")
            control = primary_scale_control()
            self.accessibility(
                "setting a reversible native Virtual-1 scale",
                "set-value", "--name", str(control.get("native_name", control.get("name")) or ""), "--role", "spin button",
                "--bus", str(control["bus"]), "--path", str(control["path"]),
                "--value", str(target_scale),
            )
            self.click_in_group("applying reversible display preview", "Revisar alterações", "Aplicar alterações", role="button")
            preview_pending = True
            revert_control = self.wait_until(
                "display preview controls",
                current_revert,
                timeout=12,
            )
            preview = self.wait_until(
                "Virtual-1 preview scale applied",
                lambda: (
                    item
                    if (item := next(
                        (monitor for monitor in self.monitors() if monitor.get("name") == "Virtual-1"),
                        None,
                    )) is not None and abs(float(item.get("scale", 0)) - target_scale) < 0.02
                    else None
                ),
                timeout=20,
            )
            if preview.get("disabled", False):
                raise RuntimeError("Display preview unexpectedly disabled the primary Virtual-1 output")
            preview_screenshot = self.capture("display-preview-active")
            self.click_accessible_node(revert_control, "reverting guest display preview")
            preview_pending = False
            reverted = self.wait_until(
                "Virtual-1 layout restored by Revert",
                lambda: (
                    item
                    if (item := next(
                        (monitor for monitor in self.monitors() if monitor.get("name") == "Virtual-1"),
                        None,
                    )) is not None
                    and abs(float(item.get("scale", 0)) - primary_scale) < 0.02
                    and item.get("width") == initial_primary.get("width")
                    and item.get("height") == initial_primary.get("height")
                    else None
                ),
                timeout=20,
            )
            if not any(item.get("name") == "Virtual-2" for item in self.monitors()):
                raise RuntimeError("The secondary output disappeared before fixture cleanup")
            return {
                "ui": "Changed Virtual-1 scale through Settings, observed the pending preview, then explicitly selected Revert.",
                "guest": {
                    "primary_before": initial_primary,
                    "secondary_fixture": with_secondary,
                    "preview_scale": preview,
                    "reverted_primary": reverted,
                    "preview_screenshot": str(preview_screenshot),
                },
                "accessibility": {"page": page, "scale_control": control},
            }
        finally:
            try:
                if preview_pending:
                    self.click_in_group("reverting pending display preview during cleanup", "Revisar alterações", "Reverter", role="button")
                    self.wait_until(
                        "display preview cleanup",
                        lambda: (
                            item
                            if (item := next(
                                (monitor for monitor in self.monitors() if monitor.get("name") == "Virtual-1"),
                                None,
                            )) is not None
                            and abs(float(item.get("scale", 0)) - float(initial_primary.get("scale", 1.0))) < 0.02
                            else None
                        ),
                        timeout=20,
                    )
            finally:
                try:
                    if settings_open:
                        self.close_settings()
                finally:
                    if fixture_started:
                        self.desktop(
                            "stopping guest-only secondary output fixture",
                            "systemctl --user stop shade-vm-secondary-display.service",
                            check=False,
                        )
                        self.wait_until(
                            "secondary output cleanup",
                            lambda: not any(
                                item.get("name") == "Virtual-2" for item in self.monitors()
                            ),
                            timeout=15,
                        )
                    self.close_quick_settings()

    def active_window(self) -> dict[str, object]:
        result = self.desktop("reading focused guest client", "hyprctl activewindow -j")
        active = json.loads(result.stdout)
        return active if isinstance(active, dict) else {}

    def test_window_switcher(self) -> dict[str, object]:
        settings_open = False
        pattern_started = False
        try:
            states: list[dict[str, object]] = []
            def cancel_state(name: str) -> None:
                before = self.active_window()
                self.activate_shell_action("toggle-windowswitcher")
                self.wait_until(f"{name} switcher layer", lambda: any(
                    layer.get("namespace") == "shade-switcher" for layer in self.layers()
                ), timeout=12)
                if name == "empty":
                    self.find_accessible_node("Press Escape to close the switcher.")
                self.save_accessibility_tree(f"window-switcher-{name}")
                screenshot = self.capture(f"window-switcher-{name}")
                self.vnc(f"cancelling {name} switcher", "key", "esc")
                self.wait_until(f"{name} switcher closed", lambda: not any(
                    layer.get("namespace") == "shade-switcher" for layer in self.layers()
                ), timeout=12)
                after = self.active_window()
                if before.get("address") != after.get("address"):
                    raise RuntimeError(f"{name} cancellation changed client focus: {before} -> {after}")
                states.append({"state": name, "client_count": len(self.clients()), "screenshot": str(screenshot)})
            if not self.clients():
                cancel_state("empty")
            else:
                states.append({"state": "empty", "status": "unverified", "reason": "Guest already has clients"})
            pattern = self.start_pattern_window("Long switcher title " + "X" * 300)
            pattern_started = True
            if len(self.clients()) == 1:
                cancel_state("one-long-title")
            else:
                states.append({"state": "one-long-title", "status": "unverified", "reason": "Guest has additional clients"})
            self.open_settings()
            settings_open = True
            settings = next(
                (
                    client for client in self.clients()
                    if client.get("title") == "Configurações"
                ),
                None,
            )
            if settings is None:
                raise RuntimeError("Configurações client disappeared before switcher exercise")
            address = str(settings.get("address", ""))
            self.desktop(
                "focusing Settings before switcher selection",
                "hyprctl dispatch " + shlex.quote(f'hl.dsp.focus({{window = "address:{address}"}})'),
            )
            before_clients = self.clients()
            before_count = len(before_clients)
            before_active = self.active_window()
            before_layers = len(self.layers())
            self.activate_shell_action("toggle-windowswitcher")
            self.wait_until(
                "window switcher layer",
                lambda: len(self.layers()) > before_layers,
                timeout=12,
            )
            self.capture("window-switcher-select")
            self.vnc("selecting next switcher client", "key", "enter")
            (self.artifacts / "window-switcher-after-enter.json").write_text(
                json.dumps({"active_window": self.active_window(), "layers": self.layers()}, indent=2) + "\n"
            )
            self.capture("window-switcher-after-enter")
            self.wait_until(
                "selected guest window focus",
                lambda: (
                    active
                    if (active := self.active_window()).get("address") == pattern.get("address")
                    else None
                ),
                timeout=12,
            )
            selected_active = self.active_window()
            self.wait_until(
                "switcher closure after selection",
                lambda: len(self.layers()) <= before_layers,
                timeout=12,
            )
            selected_clients = self.clients()
            if len(selected_clients) != before_count:
                raise RuntimeError(f"Window selection changed client count: {before_count} -> {len(selected_clients)}")

            self.desktop(
                "restoring Settings focus before switcher cancel",
                "hyprctl dispatch " + shlex.quote(f'hl.dsp.focus({{window = "address:{address}"}})'),
            )
            cancel_before = self.active_window()
            cancel_layers = len(self.layers())
            self.activate_shell_action("toggle-windowswitcher")
            self.wait_until(
                "window switcher for Escape path",
                lambda: len(self.layers()) > cancel_layers,
                timeout=12,
            )
            self.vnc("cancelling switcher with Escape", "key", "esc")
            self.wait_until(
                "switcher closure after Escape",
                lambda: len(self.layers()) <= cancel_layers,
                timeout=12,
            )
            cancel_active = self.active_window()
            final_clients = self.clients()
            if cancel_active.get("address") != cancel_before.get("address"):
                raise RuntimeError(
                    f"Escape did not return focus to the original Settings client: "
                    f"{cancel_before} -> {cancel_active}"
                )
            if len(final_clients) != before_count or not any(
                item.get("address") == pattern.get("address") for item in final_clients
            ):
                raise RuntimeError(f"Escape path closed or lost a guest client: {final_clients}")
            if before_active.get("address") != address:
                raise RuntimeError(f"Switcher precondition did not focus Settings: {before_active}")
            # Keep modifier and release within one RFB connection instead of
            # relying on keyboard state across vncdotool disconnects.
            held_capture = self.artifacts / "window-switcher-super-held.png"
            self.vnc(
                "selecting actual MRU client with held Super",
                "keydown", "super", "key", "tab", "pause", "1",
                "capture", str(held_capture), "keyup", "super", "pause", "0.5",
            )
            self.wait_until(
                "real Super release selected the MRU client",
                lambda: self.active_window().get("address") == pattern.get("address")
                        and len(self.layers()) <= cancel_layers,
                timeout=12,
            )
            released_active = self.active_window()
            return {
                "ui": "Empty/long/multiple-client switcher states; Enter selects, Escape preserves focus, and actual held-Super release selects MRU.",
                "guest": {
                    "state_receipts": states,
                    "client_count_before": before_count,
                    "settings_address": address,
                    "pattern_address": pattern.get("address"),
                    "active_before": before_active,
                    "active_after_selection": selected_active,
                    "active_before_escape": cancel_before,
                    "active_after_escape": cancel_active,
                    "client_count_after": len(final_clients),
                    "active_after_super_release": released_active,
                    "super_held_screenshot": str(held_capture),
                },
            }
        finally:
            try:
                if pattern_started:
                    self.stop_pattern_window()
            finally:
                if settings_open:
                    self.close_settings()
                self.close_quick_settings()

    def portal_journal(self, since: str) -> str:
        result = self.desktop(
            "collecting guest ScreenCast portal and picker log",
            f"journalctl --user --since @{since} --no-pager",
            check=False,
        )
        return result.stdout + result.stderr

    def portal_request(self, kind: str) -> dict[str, object]:
        marker = self.desktop("marking portal request log time", "date +%s.%N").stdout.strip()
        self.desktop(
            f"starting actual ScreenCast portal requester for {kind}",
            "systemctl --user stop shade-vm-portal-fixture.target 2>/dev/null || true; "
            "systemctl --user start shade-vm-portal-fixture.target",
        )
        picker = self.wait_until(
            "actual Shade ScreenCast share picker",
            lambda: next(
                (
                    client for client in self.clients()
                    if client.get("title") == "Escolha o que compartilhar"
                ),
                None,
            ),
            timeout=20,
        )
        self.capture(f"share-picker-{kind}")
        self.save_accessibility_tree(f"share-picker-{kind}")
        def choose_source(fragment: str) -> None:
            button = self.find_accessible_node(fragment, role="button", contains=True)
            self.click_accessible_node(button, f"choosing source {fragment}")
            review_heading = "Revise a tela escolhida" if kind == "screen" else "Revise a janela escolhida"
            self.wait_until(
                f"reviewing selected source {fragment}",
                lambda: self.find_accessible_node(review_heading, role="label"),
                timeout=10,
            )
            self.click_named("confirming reviewed share source", "Compartilhar", role="button")
        if kind == "screen":
            self.click_named("show guest screen sources", "Telas", role="tab")
            primary = next((item for item in self.monitors() if item.get("name") == "Virtual-1"), None)
            if primary is None:
                raise RuntimeError("Portal screen selection has no Virtual-1 primary output")
            choose_source(str(primary["name"]))
        elif kind == "window":
            self.click_named("show guest window sources", "Janelas", role="tab")
            choose_source("org.shade.WorkflowPattern")
        elif kind == "cancel":
            self.click_named("cancelling the real Shade share picker", "Cancelar", role="button")
        else:
            raise ValueError(f"Unknown portal scenario kind: {kind}")
        self.wait_until(
            f"portal requester response after {kind}",
            lambda: (
                logs
                if (
                    (logs := self.portal_journal(marker))
                    and "PORTAL RESPONSE" in logs
                    and ("Session.Close" in logs or "portal session closed" in logs)
                )
                else None
            ),
            timeout=30,
        )
        logs = self.portal_journal(marker)
        close_acknowledged = (
            ("PORTAL RESPONSE org.freedesktop.portal.Session.Close" in logs and " closed" in logs)
            or "portal session closed" in logs
        )
        if not close_acknowledged:
            raise RuntimeError(f"Portal requester did not acknowledge session closure: {logs}")
        responses = [line for line in logs.splitlines()
                     if "PORTAL RESPONSE org.freedesktop.portal.ScreenCast.Start code=0 " in line]
        if kind in ("screen", "window"):
            source_type = 1 if kind == "screen" else 2
            if len(responses) != 1 or not re.search(
                rf"'source_type':\s*<uint32 {source_type}>", responses[0]
            ):
                raise RuntimeError(f"Portal did not return the requested native stream type: {logs}")
            if kind == "screen" and "'mapping_id': <'Virtual-1'>" not in responses[0]:
                raise RuntimeError(f"Portal selected the wrong guest screen: {responses[0]}")
            if kind == "window" and "'size': <(480, 320)>" not in responses[0]:
                raise RuntimeError(f"Portal selected the wrong guest window geometry: {responses[0]}")
            response = responses[0]
        else:
            cancelled = [line for line in logs.splitlines() if re.search(
                r"PORTAL RESPONSE org\.freedesktop\.portal\.ScreenCast\.(SelectSources|Start) code=1 ", line
            )]
            if responses or len(cancelled) != 1:
                raise RuntimeError(f"Portal cancellation returned success or no cancelled response: {logs}")
            response = cancelled[0]
        def requester_finished():
            status = dict(line.split("=", 1) for line in self.desktop(
                "reading actual portal requester completion",
                "systemctl --user show shade-vm-portal-requester.service -p ActiveState -p Result -p ExecMainStatus",
            ).stdout.splitlines() if "=" in line)
            if status.get("ActiveState") not in ("inactive", "failed"):
                return None
            if status.get("Result") != "success" or status.get("ExecMainStatus") != "0":
                raise RuntimeError(f"Portal requester failed after response: {status}")
            return status
        requester_status = self.wait_until("portal requester clean completion", requester_finished, timeout=5)
        self.desktop(
            f"stopping ScreenCast portal requester after {kind}",
            "systemctl --user stop shade-vm-portal-fixture.target",
            check=False,
        )
        log_path = self.artifacts / f"share-picker-{kind}.log"
        log_path.write_text(logs, encoding="utf-8")
        return {
            "kind": kind,
            "picker_title": picker.get("title"),
            "session_close": "confirmed in requester journal",
            "portal_response": response,
            "requester_status": requester_status,
            "requester_log": str(log_path),
        }

    def test_share_picker_portal(self) -> dict[str, object]:
        pattern_started = False
        try:
            pattern = self.start_pattern_window()
            pattern_started = True
            screen = self.portal_request("screen")
            window = self.portal_request("window")
            cancelled = self.portal_request("cancel")
            return {
                "ui": "Used the fixture ScreenCast requester to open Shade's actual Share Screen / Window picker for screen selection, window selection, and Cancel.",
                "guest": {
                    "screen": screen,
                    "window": window,
                    "cancelled": cancelled,
                    "pattern_window": {
                        "title": pattern.get("title"),
                        "address": pattern.get("address"),
                    },
                    "claim": "Guest-local portal protocol only; no stream is opened or host content shared.",
                },
            }
        finally:
            self.desktop(
                "stopping any active guest portal requester",
                "systemctl --user stop shade-vm-portal-fixture.target",
                check=False,
            )
            if pattern_started:
                self.stop_pattern_window()

    def bluetooth_metadata(self) -> dict[str, dict[str, dict[str, object]]]:
        result = self.guest(
            "reading passive BlueZ managed objects",
            "busctl --system --json=short call org.bluez / org.freedesktop.DBus.ObjectManager GetManagedObjects",
            check=False,
        )
        raw = result.stdout
        (self.artifacts / "bluetooth-managed-objects-receipt.json").write_text(
            json.dumps({"returncode": result.returncode, "stdout": raw, "stderr": result.stderr}, indent=2),
            encoding="utf-8",
        )
        try:
            if result.returncode:
                raise ValueError("GetManagedObjects failed")
            reply = json.loads(raw)
            # systemd bus-dump-json.c: message data is an argument array,
            # dictionaries are objects, and variants are {type, data}.
            if not isinstance(reply, dict) or reply.get("type") != "a{oa{sa{sv}}}":
                raise ValueError("unexpected GetManagedObjects signature")
            data = reply.get("data")
            if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
                raise ValueError("expected one managed-object dictionary")
            objects = {}
            required = {
                "org.bluez.Adapter1": {"Address": "s", "Alias": "s", "Powered": "b", "Discovering": "b"},
                "org.bluez.Device1": {"Address": "s", "Adapter": "o", "Paired": "b", "Connected": "b"},
            }
            for path, interfaces in data[0].items():
                if not isinstance(path, str) or not path.startswith("/") or not isinstance(interfaces, dict):
                    raise ValueError("invalid managed object")
                objects[path] = {}
                for interface, properties in interfaces.items():
                    if not isinstance(properties, dict):
                        raise ValueError(f"invalid properties for {path} {interface}")
                    if interface not in required:
                        continue
                    decoded = {}
                    for name, variant in properties.items():
                        if not isinstance(variant, dict) or set(variant) != {"type", "data"}:
                            raise ValueError(f"invalid variant {path} {name}")
                        signature, value = variant["type"], variant["data"]
                        expected = required[interface].get(name)
                        if expected and (signature != expected or type(value) is not (bool if expected == "b" else str)):
                            raise ValueError(f"invalid type for {path} {name}")
                        if name in ("Alias", "Name") and (signature != "s" or type(value) is not str):
                            raise ValueError(f"invalid name for {path} {name}")
                        decoded[name] = value
                    if not required[interface].keys() <= decoded.keys():
                        raise ValueError(f"missing required properties for {path} {interface}")
                    objects[path][interface] = decoded
            return objects
        except (ValueError, TypeError) as error:
            raise RuntimeError(
                f"Invalid BlueZ metadata: {error}; returncode={result.returncode}; stdout={raw!r}; stderr={result.stderr!r}"
            ) from error

    def bluetooth_controllers(self) -> dict[str, dict[str, object]]:
        return {
            path: interfaces["org.bluez.Adapter1"]
            for path, interfaces in self.bluetooth_metadata().items()
            if "org.bluez.Adapter1" in interfaces
        }

    def bluetooth_adapter(self, address: str) -> tuple[str, dict[str, object]]:
        matches = [
            (path, properties) for path, properties in self.bluetooth_controllers().items()
            if properties["Address"].casefold() == address.casefold()
        ]
        if len(matches) != 1:
            raise RuntimeError(f"Expected one BlueZ adapter for {address}: {matches}")
        return matches[0]

    def bluetooth_device(self, controller: str, address: str) -> dict[str, object] | None:
        objects = self.bluetooth_metadata()
        adapters = [
            path for path, interfaces in objects.items()
            if "org.bluez.Adapter1" in interfaces
            and interfaces["org.bluez.Adapter1"]["Address"].casefold() == controller.casefold()
        ]
        if len(adapters) != 1:
            raise RuntimeError(f"Expected one BlueZ adapter for {controller}: {objects}")
        devices = [
            {"path": path, **interfaces["org.bluez.Device1"]}
            for path, interfaces in objects.items()
            if "org.bluez.Device1" in interfaces
            and interfaces["org.bluez.Device1"]["Adapter"] == adapters[0]
            and interfaces["org.bluez.Device1"]["Address"].casefold() == address.casefold()
        ]
        if len(devices) > 1:
            raise RuntimeError(f"Ambiguous BlueZ device {controller} {address}: {objects}")
        return devices[0] if devices else None

    def bluetooth_devices(self, controller: str) -> list[dict[str, object]]:
        objects = self.bluetooth_metadata()
        adapters = [
            path for path, interfaces in objects.items()
            if "org.bluez.Adapter1" in interfaces
            and interfaces["org.bluez.Adapter1"]["Address"].casefold() == controller.casefold()
        ]
        if len(adapters) != 1:
            raise RuntimeError(f"Expected one BlueZ adapter for {controller}: {objects}")
        return [
            {"path": path, **interfaces["org.bluez.Device1"]}
            for path, interfaces in objects.items()
            if "org.bluez.Device1" in interfaces
            and interfaces["org.bluez.Device1"]["Adapter"] == adapters[0]
        ]

    @staticmethod
    def bluetooth_command(controller: str, *arguments: str) -> str:
        # BlueZ 5.87 selects adapters within a session, not via --controller.
        commands = ("select " + controller, shlex.join(arguments))
        return "printf '%s\\n' " + shlex.join(commands) + " | bluetoothctl"


    def test_bluetooth_pairing(self) -> dict[str, object]:
        fixture_started = False
        settings_open = False
        scanning = False
        transient_connection = False
        controllers: dict[str, dict[str, object]] = {}
        primary_address: str | None = None
        peer_address: str | None = None
        initial_powered: bool | None = None
        try:
            fixture_started = True
            self.guest(
                "starting guest-only Bluetooth advertising peer",
                'control=$(readlink -f "$(command -v systemctl)"); sudo -n "$control" start shade-vm-bluetooth-fixture.target',
                timeout=45,
            )
            controllers = self.wait_until(
                "guest Bluetooth fixture controllers",
                lambda: (
                    found
                    if len(found := self.bluetooth_controllers()) >= 2
                    and any(
                        properties["Alias"] == "ShadeVM-Peer"
                        and properties["Powered"] and properties["Discoverable"] and properties["Pairable"]
                        for properties in found.values()
                    )
                    else None
                ),
                timeout=30,
            )
            peers = [
                properties for properties in controllers.values()
                if properties["Alias"] == "ShadeVM-Peer"
            ]
            if len(peers) != 1:
                raise RuntimeError(f"Expected one ShadeVM-Peer adapter: {controllers}")
            peer_address = str(peers[0]["Address"])
            primary_adapters = [
                properties for properties in controllers.values()
                if properties["Address"] != peer_address
            ]
            if len(primary_adapters) != 1:
                raise RuntimeError(f"Expected one primary Bluetooth adapter: {controllers}")
            primary_address = str(primary_adapters[0]["Address"])
            initial_powered = bool(primary_adapters[0]["Powered"])
            settings_open = True
            self.open_settings()
            page = self.settings_page("Bluetooth")
            self.save_accessibility_tree("settings-bluetooth-peer")
            if not initial_powered:
                self.click_in_group("enabling guest Bluetooth from Settings", "Bluetooth", "Bluetooth", role="switch")
                self.wait_until(
                    "guest Bluetooth adapter powered",
                    lambda: bool(self.bluetooth_adapter(primary_address)[1]["Powered"]),
                    timeout=20,
                )
            self.click_in_group("starting guest Bluetooth discovery", "Dispositivos disponíveis", "Buscar dispositivos", role="button")
            scanning = True
            def active_discovery():
                adapters = self.bluetooth_controllers()
                active = [
                    properties for properties in adapters.values()
                    if properties["Discovering"]
                ]
                return (adapters, active[0]) if len(active) == 1 else None
            discovery_adapters, scanning_adapter = self.wait_until(
                "native UI Bluetooth discovery started on one adapter",
                active_discovery,
                timeout=10,
            )
            if str(scanning_adapter["Address"]).casefold() == peer_address.casefold():
                # AstalBluetooth scans its first registered adapter. Move only
                # the disposable advertiser to the other owned btvirt controller.
                stop_scan = self.find_in_group(
                    self.accessibility_tree("reading Bluetooth discovery stop control"),
                    "Dispositivos disponíveis",
                    "Parar busca",
                    role="button",
                )
                self.click_accessible_node(stop_scan, "stopping discovery before fixture adapter alignment")
                scanning = False
                primary_address = next(
                    str(properties["Address"])
                    for properties in controllers.values()
                    if str(properties["Address"]).casefold() != peer_address.casefold()
                )
                self.guest(
                    "selecting the other guest btvirt adapter for the advertiser",
                    "printf '%s' " + shlex.quote(primary_address) + " > /run/shade-vm-bluetooth/peer-address",
                )
                self.guest(
                    "restarting only the guest Bluetooth advertising peer",
                    'control=$(readlink -f "$(command -v systemctl)"); sudo -n "$control" restart shade-vm-bluetooth-peer.service',
                    timeout=45,
                )
                controllers = self.wait_until(
                    "guest Bluetooth advertiser moved to the selected controller",
                    lambda: (
                        found
                        if len(found := self.bluetooth_controllers()) == 2
                        and any(
                            properties["Alias"] == "ShadeVM-Peer"
                            and properties["Address"].casefold() == primary_address.casefold()
                            and properties["Powered"] and properties["Discoverable"] and properties["Pairable"]
                            for properties in found.values()
                        )
                        else None
                    ),
                    timeout=30,
                )
                peer_address = primary_address
                primary_address = next(
                    str(properties["Address"])
                    for properties in controllers.values()
                    if str(properties["Address"]).casefold() != peer_address.casefold()
                )
                initial_powered = bool(self.bluetooth_adapter(primary_address)[1]["Powered"])
                self.click_in_group("restarting guest Bluetooth discovery after fixture alignment", "Dispositivos disponíveis", "Buscar dispositivos", role="button")
                scanning = True
                discovery_adapters, scanning_adapter = self.wait_until(
                    "native UI Bluetooth discovery restarted",
                    active_discovery,
                    timeout=10,
                )
                if str(scanning_adapter["Address"]).casefold() != primary_address.casefold():
                    raise RuntimeError(f"UI discovery adapter did not remain the non-peer controller: {discovery_adapters}")
            (self.artifacts / "bluetooth-ui-discovery-adapters.json").write_text(
                json.dumps(discovery_adapters, indent=2), encoding="utf-8"
            )
            def discovered_peer():
                found = self.bluetooth_devices(primary_address)
                return found if any(
                    device.get("Name", device.get("Alias")) == "ShadeVM-Peer"
                    for device in found
                ) else None
            devices = self.wait_until(
                "guest-advertised ShadeVM-Peer",
                discovered_peer,
                timeout=30,
            )
            matching_devices = [
                device for device in devices
                if device.get("Name", device.get("Alias")) == "ShadeVM-Peer"
            ]
            if len(matching_devices) != 1:
                raise RuntimeError(f"Expected one advertised ShadeVM-Peer device: {devices}")
            address_match = str(matching_devices[0]["Address"])
            paired_address = address_match
            self.capture("bluetooth-discovered-peer")
            self.click_in_group("pairing discovered guest peer in Settings", "Dispositivos disponíveis", "Parear", role="button")
            paired = self.wait_until(
                "guest peer paired",
                lambda: (
                    device if (device := self.bluetooth_device(primary_address, address_match))
                    and device["Paired"] else None
                ),
                timeout=35,
            )
            self.capture("bluetooth-paired-peer")
            peer_consent = self.wait_until(
                "owned peer's reciprocal completed pairing",
                lambda: (
                    device if (device := self.bluetooth_device(peer_address, primary_address))
                    and device["Paired"] else None
                ),
                timeout=10,
            )
            # Both adapters are the fixture's owned btvirt endpoints. Authorize
            # their reciprocal services explicitly: A2DP negotiation can open
            # profiles in either direction on this single guest BlueZ daemon.
            for consenting_device in (peer_consent, paired):
                self.guest(
                    "authorizing services only between the two paired btvirt endpoints",
                    "busctl --system set-property org.bluez "
                    + shlex.quote(str(consenting_device["path"]))
                    + " org.bluez.Device1 Trusted b true",
                )
            # Pairing's temporary ACL can close while the native review receipt
            # is collected; do not decide whether to connect from the old snapshot.
            paired = self.bluetooth_device(primary_address, address_match)
            if not paired or not paired["Paired"]:
                raise RuntimeError(f"Guest peer lost its completed pairing: {paired}")
            if not paired["Connected"]:
                self.click_bluetooth_peer_action(
                    "connecting the paired guest peer", "Conectar",
                    primary_address, address_match, str(paired["path"]),
                )
                paired = self.wait_until(
                    "guest peer connection",
                    lambda: (
                        device if (device := self.bluetooth_device(primary_address, address_match))
                        and device["Connected"] else None
                    ),
                    timeout=30,
                )
            if not paired["Connected"]:
                raise RuntimeError(f"Guest-only Bluetooth peer did not connect: {paired}")
            self.capture("bluetooth-connected-peer")
            # The screenshot/tree collection above can outlive btvirt's short
            # ACL. Re-read the exact BlueZ object before attempting disconnect.
            connected_snapshot = self.bluetooth_device(primary_address, address_match)
            if not connected_snapshot or str(connected_snapshot["path"]) != str(paired["path"]):
                raise RuntimeError(f"Captured guest pairing object changed: {connected_snapshot}")
            disconnect_receipt: dict[str, object] | None = None
            if connected_snapshot["Connected"]:
                self.click_bluetooth_peer_action(
                    "disconnecting guest peer before cleanup", "Desconectar",
                    primary_address, address_match, str(connected_snapshot["path"]),
                )
                disconnected = self.wait_until(
                    "guest Bluetooth peer disconnected",
                    lambda: (
                        device if (device := self.bluetooth_device(primary_address, address_match))
                        and str(device["path"]) == str(connected_snapshot["path"])
                        and not device["Connected"] else None
                    ),
                    timeout=20,
                )
                disconnect_receipt = disconnected
            else:
                transient_connection = True
                tree = self.accessibility_tree("recording paired Bluetooth peer after its btvirt ACL closed")
                native_controls = [
                    node for node in self.walk_accessibility(tree)
                    if node.get("role") == "button"
                ]
                native_button = next(
                    (node.get("name") for node in native_controls
                     if node.get("name") in ("Conectar", "Desconectar")),
                    None,
                )
                self.review_unavailable(
                    "bluetooth-persistent-link",
                    "Transient btvirt link closed before disconnect UI action; "
                    f"native row label={next((node.get('name') for node in self.walk_accessibility(tree) if node.get('name') == 'ShadeVM-Peer'), None)!r}, "
                    f"button={native_button!r}, BlueZ object={connected_snapshot['path']!r}, "
                    f"Connected={connected_snapshot['Connected']!r}; persistent disconnect prerequisite unavailable.",
                )
            forget_object_path = str(paired["path"])
            def forget_window():
                settings_clients = [
                    client for client in self.clients()
                    if client.get("title") == "Configurações" and client.get("mapped")
                ]
                settings_tree = self.accessibility_tree("locating mapped Settings accessibility owner")
                settings_buses = {
                    str(node["bus"]) for node in self.walk_accessibility(settings_tree)
                    if node.get("name") == "Configurações" and node.get("role") == "window"
                    and node.get("bus")
                }
                windows = [
                    node for node in self.walk_accessibility(
                        self.accessibility_tree("locating native Bluetooth forget window")
                    )
                    if node.get("role") == "window" and node.get("name") == "Esquecer dispositivo?"
                ]
                if len(settings_clients) != 1 or len(settings_buses) != 1 or len(windows) != 1:
                    raise RuntimeError(
                        f"Expected unique mapped Settings owner and forget window: "
                        f"{settings_clients!r}, {settings_buses!r}, {windows!r}"
                    )
                owner = settings_clients[0]
                window = windows[0]
                if str(window.get("bus")) not in settings_buses:
                    raise RuntimeError(
                        f"Forget window and Settings owner are not the same process: "
                        f"{window!r}, {settings_buses!r}"
                    )
                clients = [
                    client for client in self.clients()
                    if client.get("title") == "Esquecer dispositivo?" and client.get("mapped")
                    and str(client.get("pid")) == str(owner.get("pid"))
                ]
                if len(clients) != 1:
                    raise RuntimeError(f"Expected one mapped native forget client: {clients!r}")
                return window, clients[0], owner

            def open_forget_review(label):
                self.click_bluetooth_peer_action(
                    "opening guest Bluetooth forget consent", "Esquecer",
                    primary_address, address_match, forget_object_path,
                )
                window, client, owner = self.wait_until(
                    "native Bluetooth forget window",
                    forget_window,
                    timeout=8,
                )
                self.capture("bluetooth-forget-" + label)
                current = self.bluetooth_device(primary_address, address_match)
                if not current or not current["Paired"] or str(current["path"]) != forget_object_path:
                    raise RuntimeError("Opening Bluetooth forget consent changed the captured pairing")
                return window, client, owner

            for dismissal in ("cancel", "escape", "window-close"):
                window, client, _owner = open_forget_review(dismissal)
                if dismissal == "cancel":
                    consent_tree = self.accessibility(
                        "reading Bluetooth forget cancellation control", "tree",
                        "--bus", str(window["bus"]), "--path", str(window["path"]),
                        "--max-depth", "12", "--max-nodes", "150",
                    )
                    cancel_buttons = [
                        node for node in self.walk_accessibility(consent_tree)
                        if node.get("role") == "button" and node.get("name") == "Cancelar"
                    ]
                    if len(cancel_buttons) != 1:
                        raise RuntimeError(f"Expected one explicit Cancel response: {cancel_buttons}")
                    self.click_accessible_node(cancel_buttons[0], "cancelling Bluetooth forget consent")
                elif dismissal == "escape":
                    self.vnc("closing Bluetooth forget window with Escape", "key", "esc")
                else:
                    address = str(client.get("address", ""))
                    if not address:
                        raise RuntimeError(f"Forget window has no compositor address: {client!r}")
                    self.desktop(
                        "closing Bluetooth forget window through the window manager",
                        "hyprctl dispatch " + shlex.quote(f'hl.dsp.window.close({{window = "address:{address}"}})'),
                    )
                self.wait_until(
                    f"Bluetooth forget window closed after {dismissal}",
                    lambda: not any(
                        c.get("title") == "Esquecer dispositivo?" and c.get("mapped")
                        for c in self.clients()
                    ),
                    timeout=8,
                )
                current = self.bluetooth_device(primary_address, address_match)
                if not current or not current["Paired"] or str(current["path"]) != forget_object_path:
                    raise RuntimeError(f"Bluetooth forget {dismissal} changed the captured pairing")

            dialog, consent_client, settings_client = open_forget_review("confirm")
            consent_tree = self.accessibility(
                "reading only the current Bluetooth consent window", "tree",
                "--bus", str(dialog["bus"]), "--path", str(dialog["path"]),
                "--max-depth", "12", "--max-nodes", "150",
            )
            consent_buttons = [
                node for node in self.walk_accessibility(consent_tree)
                if node.get("role") == "button" and node.get("name") == "Esquecer"
            ]
            if len(consent_buttons) != 1:
                raise RuntimeError(f"Expected one explicit Bluetooth consent response: {consent_buttons}")
            confirm_button = consent_buttons[0]
            measured_consent = self.accessibility(
                "measuring the current explicit Bluetooth response control", "find",
                "--name=" + str(confirm_button.get("native_name", confirm_button.get("name", ""))),
                "--role", str(confirm_button["role"]),
                "--bus", str(confirm_button["bus"]),
                "--path", str(confirm_button["path"]),
                "--window-bounds", "--include-state",
            )
            window_bounds = measured_consent.get("window_bounds")
            if not isinstance(window_bounds, list) or len(window_bounds) != 4:
                raise RuntimeError(f"Cannot measure native consent window/control: {measured_consent!r}")
            if (window_bounds[0] < 0 or window_bounds[1] < 0
                    or window_bounds[2] <= 0 or window_bounds[3] <= 0
                    or window_bounds[0] + window_bounds[2] > consent_client["size"][0]
                    or window_bounds[1] + window_bounds[3] > consent_client["size"][1]
                    or not int(measured_consent["state_words"][0]) & (1 << 25)
                    or not int(measured_consent["state_words"][0]) & (1 << 24)):
                raise RuntimeError(f"Bluetooth confirmation is outside the visible native window: {measured_consent!r}")
            current = self.bluetooth_device(primary_address, address_match)
            if not current or not current["Paired"] or str(current["path"]) != forget_object_path:
                raise RuntimeError("Explicit confirmation no longer targets the captured BlueZ object")
            self.vnc(
                "explicitly confirming guest Bluetooth forget by measured native window bounds",
                "move",
                str(int(consent_client["at"][0] + window_bounds[0] + window_bounds[2] / 2)),
                str(int(consent_client["at"][1] + window_bounds[1] + window_bounds[3] / 2)),
                "click", "1",
            )
            def forgotten_peer():
                current = self.bluetooth_device(primary_address, address_match)
                if current is None:
                    return {"removed_pairing": True, "rediscovered": False, "object_path": forget_object_path}
                if str(current["path"]) != forget_object_path:
                    return None
                if not current["Paired"] and not current["Trusted"]:
                    return {"removed_pairing": True, "rediscovered": True, "device": current}
                return None
            forgotten = self.wait_until("guest peer pairing and trust removed", forgotten_peer, timeout=20)
            result = {
                "ui": (
                    "Settings discovered and paired the guest peer; "
                    + ("the transient connection closed before native Disconnect could be exercised; " if transient_connection
                       else "Settings disconnected the guest peer; ")
                    + "opening, Cancel, Escape and WM close preserved the captured pairing, and only explicit forget consent removed pairing and trust."
                ),
                "guest": {
                    "controllers": controllers,
                    "main_controller": primary_address,
                    "peer_controller": peer_address,
                    "device_address": address_match,
                    "bluez_object_path": forget_object_path,
                    "paired_and_connected": paired,
                    "disconnected": disconnect_receipt,
                    "forgotten_device_info": forgotten,
                },
                "accessibility": {"page": page},
            }
            if transient_connection:
                raise Unsupported(
                    "btvirt connection was transient; persistent native disconnect state was unavailable "
                    "although exact-object Forget and consent assertions completed"
                )
            return result
        except Exception:
            self.capture("bluetooth-pairing-error-before-cleanup")
            self.save_accessibility_tree("settings-bluetooth-pairing-error")
            peer_log = self.guest(
                "reading the guest peer operation journal before teardown",
                'journal=$(readlink -f "$(command -v journalctl)"); sudo -n "$journal" --all --no-pager -u shade-vm-bluetooth-peer.service -u bluetooth.service -n 120',
                check=False,
            )
            (self.artifacts / "bluetooth-peer-operation.log").write_text(
                peer_log.stdout + peer_log.stderr, encoding="utf-8"
            )
            try:
                snapshot = self.bluetooth_metadata()
            except Exception as snapshot_error:
                snapshot = {"metadata_error": {"error": str(snapshot_error)}}
            (self.artifacts / "bluetooth-scan-adapters.json").write_text(
                json.dumps(
                    {
                        path: properties.get("org.bluez.Adapter1", {})
                        for path, properties in snapshot.items()
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            (self.artifacts / "bluetooth-pairing-error-info.txt").write_text(
                json.dumps(snapshot, indent=2), encoding="utf-8"
            )
            raise
        finally:
            try:
                if scanning:
                    try:
                        stop_scan = self.find_in_group(
                            self.accessibility_tree("reading Bluetooth scan cleanup control"),
                            "Dispositivos disponíveis",
                            "Parar busca",
                            role="button",
                        )
                    except (RuntimeError, Unsupported):
                        stop_scan = None
                    if stop_scan:
                        self.click_accessible_node(stop_scan, "stopping guest Bluetooth discovery")
                if paired_address and primary_address:
                    self.guest(
                        "removing guest peer pairing if still present",
                        self.bluetooth_command(primary_address, "remove", paired_address),
                        check=False,
                    )
                if primary_address and initial_powered is not None:
                    powered = bool(self.bluetooth_adapter(primary_address)[1]["Powered"])
                    if powered != initial_powered:
                        self.guest(
                            "restoring guest Bluetooth adapter power",
                            self.bluetooth_command(primary_address, "power", "on" if initial_powered else "off"),
                            check=False,
                        )
            finally:
                try:
                    if settings_open:
                        self.close_settings()
                finally:
                    if fixture_started:
                        self.guest(
                            "clearing guest Bluetooth peer selector",
                            "printf '' > /run/shade-vm-bluetooth/peer-address",
                            check=False,
                        )
                        self.guest(
                            "stopping guest-only Bluetooth peer fixture",
                            'control=$(readlink -f "$(command -v systemctl)"); sudo -n "$control" stop shade-vm-bluetooth-fixture.target',
                            check=False,
                        )
                    self.close_quick_settings()

    def backlight_state(self) -> list[dict[str, object]]:
        code = """import glob, json
items = []
for path in glob.glob('/sys/class/backlight/*/brightness'):
    root = path.rsplit('/', 1)[0]
    try:
        items.append({'device': root.rsplit('/', 1)[1], 'path': path,
                      'brightness': int(open(path).read().strip()),
                      'maximum': int(open(root + '/max_brightness').read().strip())})
    except (OSError, ValueError):
        pass
print(json.dumps(items))"""
        result = self.guest(
            "reading guest ACPI brightness endpoints",
            "python3 -c " + shlex.quote(code),
        )
        items = json.loads(result.stdout)
        return [item for item in items if isinstance(item, dict)]

    def slider_nodes(self, tree: dict[str, object]) -> list[dict[str, object]]:
        nodes = [
            node for node in self.walk_accessibility(tree)
            if str(node.get("role", "")).casefold() == "slider"
            and isinstance(node.get("bounds"), list)
            and len(node["bounds"]) == 4
            and int(node["bounds"][2]) > 20
            and int(node["bounds"][3]) > 0
        ]
        return sorted(nodes, key=lambda node: (int(node["bounds"][1]), int(node["bounds"][0])))

    def set_slider_fraction(self, node: dict[str, object], fraction: float, label: str) -> None:
        bounds = node.get("bounds")
        if not isinstance(bounds, list) or len(bounds) != 4:
            raise Unsupported(f"{label} slider has no usable bounds: {node}")
        x, y, width, height = (int(value) for value in bounds)
        fraction = min(0.95, max(0.05, fraction))
        target_x = x + round(width * fraction)
        self.vnc(
            label,
            "move", str(target_x), str(y + height // 2), "click", "1",
        )

    def test_guest_brightness(self) -> dict[str, object]:
        endpoints = self.backlight_state()
        if not endpoints:
            raise Unsupported("The guest has no ACPI video backlight endpoint under /sys/class/backlight")
        endpoint = endpoints[0]
        original = int(endpoint["brightness"])
        maximum = int(endpoint["maximum"])
        if maximum <= 0:
            raise RuntimeError(f"Guest brightness endpoint has invalid max_brightness: {endpoint}")
        opened_quick_settings = False
        restored = False
        original_fraction = original / maximum
        target_fraction = 0.35 if original_fraction > 0.55 else 0.75
        target = round(maximum * target_fraction)
        if target == original:
            target = max(1, min(maximum, round(maximum * (0.8 if original_fraction < 0.4 else 0.2))))
            target_fraction = target / maximum
        try:
            self.open_quick_settings()
            opened_quick_settings = True
            tree = self.accessibility_tree("reading guest brightness Quick Settings control")
            self.save_accessibility_tree("guest-brightness")
            sliders = self.slider_nodes(tree)
            if not sliders:
                raise Unsupported("Quick Settings exposes no accessible guest brightness slider")
            slider = sliders[0]
            self.capture("guest-brightness-before")
            self.set_slider_fraction(slider, target_fraction, "adjusting guest brightness slider")
            changed = self.wait_until(
                "guest backlight value feedback",
                lambda: next(
                    (
                        item for item in self.backlight_state()
                        if item.get("device") == endpoint["device"]
                        and abs(int(item["brightness"]) - target) <= max(1, round(maximum * 0.03))
                    ),
                    None,
                ),
                timeout=15,
            )
            self.capture("guest-brightness-adjusted")
            self.set_slider_fraction(slider, original_fraction, "restoring guest brightness slider")
            try:
                restored_endpoint = self.wait_until(
                    "guest brightness UI restoration",
                    lambda: next(
                        (
                            item for item in self.backlight_state()
                            if item.get("device") == endpoint["device"]
                            and int(item["brightness"]) == original
                        ),
                        None,
                    ),
                    timeout=10,
                )
            except RuntimeError:
                self.guest(
                    "restoring exact guest backlight value",
                    f"brightnessctl --device {shlex.quote(str(endpoint['device']))} set {original}",
                )
                restored_endpoint = self.wait_until(
                    "exact guest brightness value",
                    lambda: next(
                        (
                            item for item in self.backlight_state()
                            if item.get("device") == endpoint["device"]
                            and int(item["brightness"]) == original
                        ),
                        None,
                    ),
                    timeout=10,
                )
            restored = True
            return {
                "ui": "Adjusted the visible Quick Settings brightness slider and restored the guest endpoint value.",
                "guest": {
                    "endpoint": endpoint["device"],
                    "sysfs_path": endpoint["path"],
                    "maximum": maximum,
                    "before": original,
                    "slider_feedback": changed,
                    "restored": restored_endpoint,
                    "visual_dimming_assertion": False,
                },
                "accessibility": {"brightness_slider": slider},
            }
        finally:
            try:
                if not restored:
                    self.guest(
                        "restoring guest brightness after scenario",
                        f"brightnessctl -d {shlex.quote(str(endpoint['device']))} set {original}",
                        check=False,
                    )
                    self.wait_until(
                        "guest brightness cleanup",
                        lambda: next(
                            (
                                item for item in self.backlight_state()
                                if item.get("device") == endpoint["device"]
                                and int(item["brightness"]) == original
                            ),
                            None,
                        ),
                        timeout=10,
                    )
            finally:
                if opened_quick_settings:
                    self.close_quick_settings()

    def audio_volume_raw(self, target: str, endpoint: str) -> list[int]:
        code = """import json, re, subprocess, sys
kind, name = sys.argv[1:]
output = subprocess.check_output(['pactl', 'get-' + kind + '-volume', name], text=True)
values = [int(value) for value in re.findall(r'(?:front-left|front-right|mono|rear-left|rear-right):\\s*(\\d+)\\s*/', output)]
if not values:
    raise SystemExit('No raw channel volume found: ' + output)
print(json.dumps(values))"""
        result = self.guest(
            f"reading guest {target} endpoint raw volume",
            "python3 -c " + shlex.quote(code)
            + " " + shlex.quote(target) + " " + shlex.quote(endpoint),
        )
        values = json.loads(result.stdout)
        return [int(value) for value in values]

    def set_audio_volume_raw(self, target: str, endpoint: str, values: list[int]) -> None:
        command = "pactl set-" + target + "-volume " + shlex.quote(endpoint)
        command += " " + " ".join(str(value) for value in values)
        self.guest(f"restoring guest {target} endpoint volume", command, check=False)

    def set_sound_volume(self, group: str, fraction: float) -> dict[str, object]:
        tree = self.accessibility_tree(f"reacquiring native {group} volume")
        sliders = [node for node in self.nodes_in_group(tree, group)
                   if str(node.get("role", "")).casefold() == "slider"]
        if len(sliders) != 1:
            raise RuntimeError(f"Expected one native volume in {group}: {sliders}")
        node = sliders[0]
        # Gtk.Scale exposes AT-SPI Value in its actual adjustment units.
        # Setting the native widget emits value-changed, unlike backend writes.
        return self.accessibility(
            f"adjusting native {group} volume", "set-value",
            "--name", str(node.get("native_name", node.get("name")) or ""), "--role", "slider",
            "--bus", str(node["bus"]), "--path", str(node["path"]),
            "--fraction", str(fraction),
        )

    def test_guest_audio(self) -> dict[str, object]:
        old_sink = self.guest("snapshotting guest default output", "pactl get-default-sink").stdout.strip()
        old_source = self.guest("snapshotting guest default input", "pactl get-default-source").stdout.strip()
        fixture_started = False
        settings_open = False
        capture_started = False
        guest_files = ["/tmp/shade-vm-generated-tone.wav", "/tmp/shade-vm-captured-tone.wav"]
        test_sink = "shade_vm_test_output"
        test_source = old_source
        monitor_source = f"{test_sink}.monitor"
        sink_original: list[int] = []
        source_original: list[int] = []
        settings_sliders: list[dict[str, object]] = []
        try:
            self.desktop(
                "starting guest-only null sink and monitor fixture",
                "systemctl --user start shade-vm-audio-fixture.service",
            )
            fixture_started = True
            endpoints = self.wait_until(
                "guest null sink and monitor source",
                lambda: (
                    state
                    if (
                        (state := self.desktop(
                            "checking guest audio fixture endpoints",
                            "pactl list short sinks; pactl list short sources",
                        ).stdout)
                        and test_sink in state
                        and test_source in state
                        and monitor_source in state
                    )
                    else None
                ),
                timeout=20,
            )
            sink_original = self.audio_volume_raw("sink", test_sink)
            source_original = self.audio_volume_raw("source", test_source)
            self.guest("selecting isolated guest null sink", f"pactl set-default-sink {test_sink}")
            self.guest("selecting the virtual HDA microphone", f"pactl set-default-source {shlex.quote(test_source)}")
            self.open_settings()
            settings_open = True
            page = self.settings_page("Som")
            self.save_accessibility_tree("settings-sound-audio")
            sound_tree = self.accessibility_tree("reading guest Sound endpoint sliders")
            settings_sliders = [
                node
                for group_title in ("Saída de som", "Microfone")
                for node in self.nodes_in_group(sound_tree, group_title)
                if str(node.get("role", "")).casefold() == "slider"
                and isinstance(node.get("bounds"), list)
                and len(node["bounds"]) == 4
            ]
            if len(settings_sliders) < 2:
                raise Unsupported(f"Sound Settings did not expose output and input volume sliders: {settings_sliders}")
            self.capture("settings-sound-audio")
            self.set_sound_volume("Saída de som", 0.36)
            sink_changed = self.wait_until(
                "guest null sink volume feedback",
                lambda: (
                    values
                    if (values := self.audio_volume_raw("sink", test_sink)) != sink_original
                    else None
                ),
                timeout=12,
            )
            self.set_sound_volume("Microfone", 0.42)
            source_changed = self.wait_until(
                "guest virtual microphone volume feedback",
                lambda: (
                    values
                    if (values := self.audio_volume_raw("source", test_source)) != source_original
                    else None
                ),
                timeout=12,
            )

            wave_code = """import math, struct, wave
rate = 48000
frames = int(rate * 2.5)
with wave.open('/tmp/shade-vm-generated-tone.wav', 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(rate)
    data = bytearray()
    for index in range(frames):
        sample = int(7000 * math.sin(2 * math.pi * 440 * index / rate))
        data.extend(struct.pack('<hh', sample, sample))
    output.writeframes(data)"""
            self.guest(
                "generating guest-only 440 Hz audio signal",
                "python3 -c " + shlex.quote(wave_code),
                timeout=20,
            )
            self.desktop(
                "starting guest monitor capture",
                "systemd-run --user --no-block --collect --unit=shade-vm-audio-capture "
                f"parec --device={monitor_source} --file-format=wav {guest_files[1]}",
            )
            capture_started = True
            self.wait_until(
                "guest monitor capture stream",
                lambda: (
                    result
                    if (
                        (result := self.desktop(
                            "waiting for guest monitor capture stream",
                            "systemctl --user is-active shade-vm-audio-capture.service",
                            check=False,
                        )).stdout.strip() == "active"
                        and self.desktop(
                            "checking guest monitor capture file",
                            f"test -s {guest_files[1]} && test $(stat -c %s {guest_files[1]}) -gt 44",
                            check=False,
                        ).returncode == 0
                    )
                    else None
                ),
                timeout=12,
            )
            playback = self.guest(
                "playing generated signal to guest-only null sink",
                f"paplay --device={test_sink} {guest_files[0]}",
                timeout=15,
            )
            self.desktop(
                "stopping guest monitor capture after generated playback",
                "systemctl --user kill --signal=INT shade-vm-audio-capture.service",
                check=False,
            )
            self.wait_until(
                "guest monitor capture finalization",
                lambda: self.desktop(
                    "checking completed guest monitor capture",
                    "systemctl --user is-active shade-vm-audio-capture.service",
                    check=False,
                ).stdout.strip() != "active",
                timeout=12,
            )
            captured = self.artifacts / "guest-audio-monitor.wav"
            self.copy_guest_file(guest_files[1], captured)
            signal_stats = self.local(
                "checking generated guest audio in monitor capture",
                [
                    "python3", "-c",
                    "import json,math,struct,sys,wave; "
                    "w=wave.open(sys.argv[1],'rb'); channels=w.getnchannels(); rate=w.getframerate(); "
                    "raw=w.readframes(w.getnframes()); samples=struct.unpack('<'+str(len(raw)//2)+'h',raw); "
                    "mono=[sum(samples[i:i+channels])//channels for i in range(0,len(samples),channels)]; "
                    "peak=max(abs(v) for v in mono); assert peak>0, 'Capture contains only silence'; "
                    "start=next(i for i,v in enumerate(mono) if abs(v)>=peak*0.05); "
                    "end=next(i for i in range(len(mono)-1,-1,-1) if abs(mono[i])>=peak*0.05); "
                    "rms=(sum(mono[i]**2 for i in range(start,end+1))/(end-start+1))**0.5; "
                    "crossings=sum(1 for i in range(start,end) if mono[i]<=0<mono[i+1]); "
                    "duration=(end-start+1)/rate; "
                    "print(json.dumps({'frames':len(mono),'rate':rate,'channels':channels,'duration_s':len(mono)/rate,"
                    "'active_duration_s':duration,'rms':rms,'estimated_hz':crossings/duration}))",
                    str(captured),
                ],
            )
            signal = json.loads(signal_stats.stdout)
            if signal["rms"] < 100 or not 390 <= signal["estimated_hz"] <= 490:
                raise RuntimeError(f"Guest null-sink monitor did not capture the generated 440 Hz tone: {signal}")
            return {
                "ui": "Sound Settings adjusted the isolated guest output and virtual HDA microphone; playback was independently captured through the output monitor.",
                "guest": {
                    "sink": test_sink,
                    "source": test_source,
                    "monitor_source": monitor_source,
                    "fixture_endpoints": endpoints,
                    "sink_volume_before": sink_original,
                    "sink_volume_changed": sink_changed,
                    "source_volume_before": source_original,
                    "source_volume_changed": source_changed,
                    "playback": playback.stdout.strip(),
                    "monitor_capture": str(captured),
                    "signal": signal,
                    "host_audio_or_microphone_used": False,
                },
                "accessibility": {"page": page, "sliders": settings_sliders},
            }
        finally:
            try:
                if capture_started:
                    self.desktop(
                        "stopping guest audio capture during cleanup",
                        "systemctl --user kill --signal=INT shade-vm-audio-capture.service; "
                        "systemctl --user stop shade-vm-audio-capture.service",
                        check=False,
                    )
            finally:
                try:
                    if fixture_started:
                        if sink_original:
                            self.set_audio_volume_raw("sink", test_sink, sink_original)
                        if source_original:
                            self.set_audio_volume_raw("source", test_source, source_original)
                        self.guest(
                            "restoring original guest output device",
                            f"pactl set-default-sink {shlex.quote(old_sink)}",
                            check=False,
                        )
                        self.guest(
                            "restoring original guest input device",
                            f"pactl set-default-source {shlex.quote(old_source)}",
                            check=False,
                        )
                finally:
                    try:
                        if settings_open:
                            self.close_settings()
                    finally:
                        try:
                            if fixture_started:
                                self.desktop(
                                    "stopping guest-only audio fixture",
                                    "systemctl --user stop shade-vm-audio-fixture.service",
                                    check=False,
                                )
                        finally:
                            try:
                                self.desktop(
                                    "removing guest-generated audio files",
                                    "rm -f " + " ".join(shlex.quote(path) for path in guest_files),
                                    check=False,
                                )
                            finally:
                                self.close_quick_settings()

    def fprint_mock_journal(self) -> str:
        result = self.desktop(
            "reading private guest fprintd mock protocol log",
            "journalctl --user -u shade-vm-fprint-mock.service --invocation=0 --no-pager",
            check=False,
        )
        return result.stdout + result.stderr

    def test_fprint_private_bus(self) -> dict[str, object]:
        if not self.user_service_active("checking normal Shade service before fprint protocol test"):
            raise Unsupported("Normal Shade user service is not active for the private-bus protocol exercise")
        uid = self.guest("reading guest tester UID", "id -u").stdout.strip()
        if not uid.isdigit():
            raise RuntimeError(f"Invalid guest tester UID: {uid!r}")
        gjs = self.desktop(
            "locating the running shell's GJS interpreter",
            'pid=$(systemctl --user show shade-shell.service -p MainPID --value); readlink -f "/proc/$pid/exe"',
        ).stdout.strip()
        socket_path = f"/run/user/{uid}/shade-vm-fprintd-private.sock"
        mock_path = "/tmp/shade-vm-fprintd-mock.js"
        normal_service_stopped = False
        private_bus_started = False
        mock_started = False
        private_shell_started = False
        try:
            self.local(
                "copying fprintd mock into disposable guest",
                [
                    "sshpass", "-p", SSH_PASSWORD, "scp", "-F", "/dev/null",
                    "-P", str(self.ssh_port),
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "UserKnownHostsFile=/dev/null",
                    "-o", "LogLevel=ERROR",
                    str(ROOT / "scripts/vm-fprintd-mock.js"),
                    f"{SSH_USER}@127.0.0.1:{mock_path}",
                ],
                timeout=30,
            )
            self.desktop(
                "starting explicit private guest D-Bus daemon",
                f"rm -f {shlex.quote(socket_path)}; "
                f"systemd-run --user --no-block --collect --unit=shade-vm-fprint-private-bus "
                f"dbus-daemon --session --nofork --address=unix:path={socket_path} "
                "--nopidfile --print-address=1",
            )
            private_bus_started = True
            self.wait_until(
                "private guest D-Bus UNIX socket",
                lambda: self.desktop(
                    "checking private fprint D-Bus socket",
                    f"test -S {shlex.quote(socket_path)}",
                    check=False,
                ).returncode == 0,
                timeout=12,
            )
            self.desktop(
                "starting fprintd mock on explicit private socket",
                "systemd-run --user --no-block --collect --unit=shade-vm-fprint-mock "
                f"{shlex.quote(gjs)} -m {mock_path} --socket {shlex.quote(socket_path)} "
                "--sequence active-hold,no-match-retry,mock-match --hold-ms 10000 --retry-ms 700",
            )
            mock_started = True
            self.wait_until(
                "private fprintd mock owning its D-Bus name",
                lambda: "ready" in self.fprint_mock_journal(),
                timeout=15,
            )
            self.desktop(
                "stopping normal Shade shell before private system-bus launch",
                "systemctl --user stop shade-shell.service",
            )
            normal_service_stopped = True
            self.desktop(
                "starting isolated Shade shell with private system bus",
                "systemd-run --user --no-block --collect --unit=shade-vm-fprint-shell "
                f"--setenv=DBUS_SYSTEM_BUS_ADDRESS=unix:path={socket_path} shade-shell",
            )
            private_shell_started = True
            self.wait_until(
                "isolated Shade shell process",
                lambda: self.desktop(
                    "checking isolated Shade shell service",
                    "systemctl --user is-active shade-vm-fprint-shell.service",
                    check=False,
                ).stdout.strip() == "active",
                timeout=25,
            )
            self.desktop("locking guest for private fprint protocol", "shade-shell lockscreen")
            self.wait_until(
                "private-bus guest lockscreen",
                lambda: self.lockscreen_visible() and json.loads(
                    self.desktop("checking native lock before fingerprint verification", "hyprctl -j locked").stdout
                )["locked"],
                timeout=15,
            )
            first_start = self.wait_until(
                "fprintd discovery and first verification",
                lambda: (
                    logs
                    if "GetDevices" in (logs := self.fprint_mock_journal())
                    and "VerifyStart" in logs
                    and "verify-swipe-too-short" in logs
                    else None
                ),
                timeout=20,
            )
            self.capture("fprint-private-bus-verifying")
            self.save_accessibility_tree("fprint-private-bus-verifying")
            self.wait_until(
                "fprint no-match retry and mock match",
                lambda: (
                    logs
                    if (
                        (logs := self.fprint_mock_journal()).count('"method":"VerifyStart"') >= 2
                        and "verify-no-match" in logs
                        and "verify-match" in logs
                    )
                    else None
                ),
                timeout=35,
            )
            unlocked = self.wait_until(
                "guest UI after private mock match",
                lambda: not json.loads(
                    self.desktop("checking native unlock after mock fingerprint match", "hyprctl -j locked").stdout
                )["locked"] and not self.lockscreen_visible(),
                timeout=15,
            )
            self.capture("fprint-private-bus-unlocked")
            logs = self.fprint_mock_journal()
            log_path = self.artifacts / "fprint-private-bus-protocol.log"
            log_path.write_text(logs, encoding="utf-8")
            if "Claim" not in logs or "Release" not in logs:
                raise RuntimeError(f"Private fprintd client did not claim and release the mock device: {logs}")
            if "DBUS_SYSTEM_BUS_ADDRESS" not in self.desktop(
                "verifying isolated Shade service bus override",
                "systemctl --user show shade-vm-fprint-shell.service -p Environment --value",
            ).stdout:
                raise RuntimeError("Isolated Shade service did not retain its private DBUS_SYSTEM_BUS_ADDRESS")
            return {
                "ui": "Private-bus fprintd discovery showed the lock UI verifying, retried after a no-match, and reached the mock-match unlock transition.",
                "guest": {
                    "private_socket": socket_path,
                    "mock_log": str(log_path),
                    "protocol_events": [
                        line for line in logs.splitlines()
                        if '"event":"method"' in line or '"event":"signal"' in line
                    ],
                    "first_verification_log": first_start,
                    "normal_host_system_bus_used": False,
                    "claim": "fprintd protocol/client behavior only; no sensor, enrollment, PAM, or real biometric authentication.",
                    "unlocked": unlocked,
                },
            }
        finally:
            try:
                if private_shell_started:
                    self.desktop(
                        "stopping isolated fprint Shade process",
                        "systemctl --user stop shade-vm-fprint-shell.service",
                        check=False,
                    )
                if mock_started:
                    self.desktop(
                        "stopping private fprintd mock",
                        "systemctl --user stop shade-vm-fprint-mock.service",
                        check=False,
                    )
                if private_bus_started:
                    self.desktop(
                        "stopping private guest D-Bus daemon",
                        "systemctl --user stop shade-vm-fprint-private-bus.service",
                        check=False,
                    )
            finally:
                try:
                    self.desktop(
                        "removing private fprint socket and guest mock script",
                        f"rm -f {shlex.quote(socket_path)} {shlex.quote(mock_path)}",
                        check=False,
                    )
                finally:
                    if normal_service_stopped:
                        self.desktop(
                            "restarting normal Shade shell service",
                            "systemctl --user start shade-shell.service",
                            check=False,
                        )
                        self.wait_until(
                            "normal Shade shell service restored",
                            lambda: self.user_service_active("waiting for restored Shade service"),
                            timeout=30,
                        )

    def lockscreen_visible(self) -> bool:
        layers = self.layers()
        if any("lock" in str(layer.get("namespace") or "").casefold() for layer in layers):
            return True
        try:
            tree = self.accessibility_tree("checking for visible guest password lockscreen")
        except (RuntimeError, Unsupported):
            return False
        return any(
            str(node.get("name") or "") == "Senha da conta"
            and str(node.get("role") or "").casefold() == "text box"
            and isinstance(node.get("bounds"), list)
            and len(node["bounds"]) == 4
            and int(node["bounds"][2]) > 0
            and int(node["bounds"][3]) > 0
            for node in self.walk_accessibility(tree)
        )

    def test_lock_unlock(self) -> dict[str, object]:
        baseline_layers = len(self.layers())
        locked = False
        settings_open = False
        def native_locked() -> bool:
            return bool(json.loads(self.desktop(
                "reading compositor lock authority", "hyprctl -j locked",
            ).stdout)["locked"])
        try:
            self.open_settings()
            settings_open = True
            shell_pid = self.desktop(
                "recording shell before Settings-to-lock transition",
                "systemctl --user show shade-shell.service -p MainPID --value",
            ).stdout.strip()
            self.desktop("locking guest with its own Settings open", "shade-shell lockscreen")
            locked = True
            self.wait_until(
                "native password lock with normal Settings window suspended",
                lambda: native_locked() and self.lockscreen_visible() and not any(
                    client.get("title") == "Configurações" and client.get("mapped")
                    for client in self.clients()
                ),
                timeout=20,
            )
            locked_capture = self.capture("password-lockscreen")
            self.save_accessibility_tree("password-lockscreen")
            self.find_accessible_node("Senha da conta", role="text box")
            self.vnc("clear automatically focused lockscreen password field", "keydown", "ctrl", "key", "a", "keyup", "ctrl")
            self.vnc("submit incorrect disposable lock credential", "type", "shade-invalid", "key", "enter")
            self.wait_until(
                "real password rejection while compositor remains locked",
                lambda: self.find_accessible_node("", role="alert", contains=True),
                timeout=20,
            )
            if not native_locked():
                raise RuntimeError("Wrong password released compositor lock")
            wrong_capture = self.capture("password-lockscreen-wrong")
            self.vnc("entering correct disposable lock credential", "keydown", "ctrl", "key", "a", "keyup", "ctrl", "type", SSH_PASSWORD, "key", "enter")
            self.wait_until(
                "authenticated native unlock and restored Settings",
                lambda: not native_locked() and not self.lockscreen_visible() and any(
                    client.get("title") == "Configurações" and client.get("mapped")
                    for client in self.clients()
                ),
                timeout=30,
            )
            locked = False
            after_pid = self.desktop(
                "verify authentication did not restart shell",
                "systemctl --user show shade-shell.service -p MainPID --value",
            ).stdout.strip()
            if shell_pid != after_pid or not self.user_service_active("verify shell after password unlock"):
                raise RuntimeError("Authentication stopped or restarted the shell")
            unlocked_capture = self.capture("password-unlocked-session")
            return {
                "ui": "Settings was suspended while native lock owned keyboard input; wrong password retained the lock, correct PAM authentication unlocked without restart and restored Settings.",
                "guest": {
                    "password": "disposable guest account only",
                    "shell_pid": shell_pid,
                    "lockscreen_screenshot": str(locked_capture),
                    "rejected_password_screenshot": str(wrong_capture),
                    "unlocked_screenshot": str(unlocked_capture),
                    "baseline_layer_count": baseline_layers,
                    "unlocked_layer_count": len(self.layers()),
                },
            }
        finally:
            if locked:
                self.vnc("unlocking guest during lock test cleanup", "type", SSH_PASSWORD, "key", "enter")
                self.wait_until("native unlock cleanup", lambda: not native_locked(), timeout=30)
            if settings_open and not native_locked():
                self.close_settings()

    def test_power_confirmation_cancel(self) -> dict[str, object]:
        actions = tuple(
            (label, heading, dismissal)
            for label, heading in (
                ("Sair da sessão", "Sair da sessão?"), ("Reiniciar", "Reiniciar o computador?"),
                ("Desligar", "Desligar o computador?")
            )
            for dismissal in ("cancel", "escape", "window")
        )
        compositor = self.hyprland_pid()
        if not compositor:
            raise Unsupported("Could not identify the current compositor PID from hyprctl instances")

        def assert_session_survived(label: str) -> None:
            if not self.user_service_active(f"verifying Shade service after {label}"):
                raise RuntimeError(f"Shade service stopped after {label}")
            current = self.hyprland_pid()
            if current != compositor:
                raise RuntimeError(
                    f"Original Hyprland session changed after {label}: {compositor!r} -> {current!r}"
                )

        def dialog_visible(heading: str) -> bool:
            # Adwaita presents a separate native window for this Astal parent.
            # Closed GTK accessibility objects can remain registered until GC.
            return any(
                client.get("title") == heading and client.get("mapped") is True
                for client in self.clients()
            )

        def open_action(label: str, heading: str, dismissal: str) -> dict[str, object]:
            if not self.quick_settings_open():
                self.open_quick_settings()
            menu = self.accessibility(
                "finding native session and power menu", "find", "--name", "Sessão e energia", "--actionable",
            )
            self.click_accessible_node(menu, "opening session and power menu")
            trigger = self.wait_until(
                f"mapped native {label} power action",
                lambda: self.accessibility("finding native power action", "find", "--name", label, "--role", "button", "--actionable"),
                timeout=10,
            )
            self.click_accessible_node(trigger, f"opening {heading} confirmation")
            self.wait_until(
                f"native {heading} AlertDialog",
                lambda: self.find_accessible_node(heading, role="alert dialog"),
                timeout=5,
            )
            self.capture(f"power-{label.lower().replace(' ', '-')}-{dismissal}-confirmation")
            return trigger

        self.open_quick_settings()
        try:
            observed: list[str] = []
            rapid_activation = "not attempted"
            open_action("Reiniciar", "Reiniciar o computador?", "parent-hide")
            self.activate_shell_action("toggle-quicksettings")
            self.wait_until(
                "hidden Quick Settings cancels its pending confirmation",
                lambda: not self.quick_settings_open() and not dialog_visible("Reiniciar o computador?"),
                timeout=10,
            )
            assert_session_survived("hiding the confirmation parent")
            # The first iteration must reopen a different action successfully:
            # an unmapped fallback need not emit AlertDialog::closed.
            for label, heading, dismissal in actions:
                trigger = open_action(label, heading, dismissal)
                if label == "Reiniciar" and dismissal == "escape":
                    # Target the original native object, never a SCREEN-coordinate
                    # hit test: GTK's AT-SPI backend may report [0, 0] bounds.
                    current_trigger = self.accessibility(
                        "inspecting original power trigger while modal", "tree",
                        "--bus", str(trigger["bus"]), "--path", str(trigger["path"]),
                        "--max-depth", "1", "--max-nodes", "1", "--no-bounds",
                    )
                    current_trigger = self.accessibility(
                        "reading original power trigger visibility", "find",
                        "--name=" + str(current_trigger.get("native_name", current_trigger.get("name", ""))),
                        "--role", str(current_trigger["role"]), "--bus", str(trigger["bus"]),
                        "--path", str(trigger["path"]), "--include-state",
                    )
                    identity_matches = (
                        current_trigger.get("native_name") == trigger.get("native_name")
                        and current_trigger["role"] == trigger["role"]
                    )
                    actionable_state = int(current_trigger["state_words"][0])
                    if not identity_matches or not actionable_state & (1 << 25) or not actionable_state & (1 << 24):
                        rapid_activation = "unavailable: original trigger is no longer a matching, showing and sensitive native control while modal; no activation attempted"
                    else:
                        self.click_accessible_node(current_trigger, "rapid second Restart activation while dialog is open")
                        rapid_activation = "same dialog remained open after exact-object reactivation; Escape then dismissed it"
                    if not dialog_visible(heading):
                        raise RuntimeError("Repeated original trigger removed the pending Restart confirmation")
                    assert_session_survived("rapid second Restart activation")
                if dismissal == "cancel":
                    self.click_named(f"cancelling {heading}", "Cancelar", role="button")
                elif dismissal == "escape":
                    self.vnc(f"dismissing {heading} with Escape", "key", "esc", "pause", "0.3")
                else:
                    dialogs = [client for client in self.clients()
                               if client.get("title") == heading and client.get("mapped") is True]
                    if len(dialogs) != 1:
                        raise RuntimeError(f"Expected exactly one mapped confirmation to dismiss: {dialogs}")
                    self.desktop(
                        f"closing only the native {heading} dialog",
                        "hyprctl dispatch " + shlex.quote(
                            'hl.dsp.window.close({window = "address:' + str(dialogs[0]["address"]) + '"})'
                        ),
                    )
                self.wait_until(
                    f"native {heading} dismissal",
                    lambda: not dialog_visible(heading),
                    timeout=5,
                )
                assert_session_survived(f"{heading} dismissal")
                observed.append(f"{heading}: {dismissal}")

            return {
                "ui": "Each native Log Out, Restart, and Power Off dialog was cancelled by Cancel, Escape, and exact native-window close without invoking a destructive response.",
                "guest": {
                    "dialog_headings": [heading for _, heading, _ in actions],
                    "dismissals": observed,
                    "rapid_second_activation": rapid_activation,
                    "native_window_dismissal": "Each exact mapped Adwaita fallback dialog was closed by its compositor address and cancelled safely.",
                    "shade_service_active": True,
                    "hyprland_processes_unchanged": True,
                    "actual_power_action": False,
                },
            }
        except Exception:
            self.capture("power-confirmation-error-before-cleanup")
            self.save_accessibility_tree("power-confirmation-error")
            raise
        finally:
            self.activate_shell_action("close-all")
            self.wait_until("power review surfaces closed", lambda: not self.quick_settings_open(), timeout=12)

    def test_capture(self) -> dict[str, object]:
        screenshot_layers = lambda: [
            layer for layer in self.layers() if layer.get("namespace") == "shade-screenshot"
        ]
        before = len(screenshot_layers())
        self.vnc("open capture overlay with Print", "key", "sysrq", "pause", "1")
        self.capture("capture-overlay-open")
        overlay = len(screenshot_layers())
        if overlay <= before:
            raise RuntimeError("Print did not open the screenshot overlay layer")
        self.vnc("cancel capture overlay with Escape", "key", "esc", "pause", "1")
        if len(screenshot_layers()) != before:
            raise RuntimeError("Capture overlay remained visible after Escape")
        marker = self.desktop("marking screenshot output time", "date +%s.%N").stdout.strip()
        self.vnc("take full screenshot with Super+Shift+S", "keydown", "super", "keydown", "shift", "key", "s", "keyup", "shift", "keyup", "super", "pause", "2")
        output = self.desktop(
            "verifying screenshot artifact",
            "python3 -c 'import json,pathlib,sys; p=pathlib.Path.home()/\"Pictures/Screenshots\"; files=sorted((f for f in p.glob(\"*.png\") if f.stat().st_mtime >= float(sys.argv[1])-1), key=lambda f:f.stat().st_mtime); print(json.dumps([str(f) for f in files]))' " + shlex.quote(marker),
        )
        files = json.loads(output.stdout)
        if not files:
            raise RuntimeError("Screenshot shortcut did not create a new PNG under ~/Pictures/Screenshots")
        self.wait_until(
            "completed capture feedback after clipboard handoff",
            lambda: self.find_accessible_node("Concluir", role="button"),
            timeout=15,
        )
        clipboard_probe = """import hashlib, json, pathlib, subprocess, sys
saved = pathlib.Path(sys.argv[1]).read_bytes()
clipboard = subprocess.check_output(['wl-paste', '--type', 'image/png'], timeout=10)
if clipboard != saved:
    raise RuntimeError('Clipboard PNG differs from the saved screenshot')
print(json.dumps({'sha256': hashlib.sha256(saved).hexdigest(), 'bytes': len(saved)}))"""
        clipboard = json.loads(self.desktop(
            "verifying actual screenshot clipboard bytes",
            "python3 -c " + shlex.quote(clipboard_probe) + " " + shlex.quote(files[-1]),
            timeout=15,
        ).stdout)
        # A saved file alone did not catch the synchronous clipboard deadlock.
        self.activate_shell_action("close-all")
        self.click_named("dismissing completed capture feedback", "Concluir", role="button")
        return {
            "ui": "Print opened and Escape cancelled selection; the screenshot completed with identical clipboard PNG bytes and a responsive shell",
            "guest": {"files": files, "clipboard": clipboard},
            "layers": f"{before} -> {overlay} -> {len(screenshot_layers())}",
        }

    def test_notifications_dnd(self) -> dict[str, object]:
        before_dnd = None

        summary = f"Shade workflow smoke {time.time_ns()}"
        self.desktop(
            "sending synthetic notification",
            "notify-send --expire-time=0 --app-name=ShadeWorkflowTest "
            + shlex.quote(summary)
            + " 'Synthetic guest-only notification'",
        )
        toast = self.wait_until(
            "standalone notification popup",
            lambda: next(
                (layer for layer in self.layers() if layer.get("namespace") == "shade-notifications"),
                None,
            ),
            timeout=10,
        )
        toast_notification = self.accessibility(
            "finding standalone notification content", "find", "--max-depth", "16",
            "--max-nodes", "2000", "--name", summary,
        )
        toast_capture = self.capture("notification-toast")
        self.wait_until(
            "toast expiry without opening notification center",
            lambda: not any(layer.get("namespace") == "shade-notifications" for layer in self.layers()),
            timeout=10,
        )
        try:
            self.activate_shell_action("open-notifications")
            center = self.wait_until(
                "independent notification center compositor layer",
                lambda: next(
                    (layer for layer in self.layers() if layer.get("namespace") == "shade-notification-center"),
                    None,
                ),
                timeout=10,
            )
            self.capture("notification-center")
            self.save_accessibility_tree("notification-center")
            dnd = self.accessibility(
                "finding Do Not Disturb toggle in notification center", "find", "--max-depth", "32",
                "--max-nodes", "4000", "--include-state", "--actionable", "--name", "Não perturbe",
                "--role", "switch",
            )
            before_dnd = dnd["state_words"]
            self.click_accessible_node(dnd, "toggling Do Not Disturb in notification center")
            after = self.accessibility(
                "verifying Do Not Disturb state", "find", "--max-depth", "32", "--max-nodes", "4000",
                "--include-state", "--name", "Não perturbe", "--role", "switch",
                "--bus", str(dnd["bus"]), "--path", str(dnd["path"]),
            )
            if before_dnd == after["state_words"]:
                raise RuntimeError("Do Not Disturb native action did not change its exposed AT-SPI state words")
            self.click_accessible_node(dnd, "restoring Do Not Disturb state")
            restored = self.accessibility(
                "verifying restored Do Not Disturb state", "find", "--max-depth", "32", "--max-nodes", "4000",
                "--include-state", "--name", "Não perturbe", "--role", "switch",
                "--bus", str(dnd["bus"]), "--path", str(dnd["path"]),
            )
            if restored["state_words"] != before_dnd:
                raise RuntimeError("Restoring Do Not Disturb did not recover its initial exposed state")
            return {
                "ui": "notification appeared as a standalone toast, expired, and DND in the independent notification center toggled and restored",
                "toast": {"layer": toast, "screenshot": str(toast_capture), "accessibility": toast_notification},
                "center": center,
                "accessibility": {"dnd_before": dnd, "dnd_after": after, "dnd_restored": restored},
            }
        finally:
            if before_dnd is not None:
                current = self.accessibility(
                    "checking Do Not Disturb before cleanup", "find", "--max-depth", "32",
                    "--max-nodes", "4000", "--include-state", "--name", "Não perturbe",
                    "--role", "switch", "--bus", str(dnd["bus"]), "--path", str(dnd["path"]),
                    check=False,
                )
                if current.get("state_words") != before_dnd and current.get("bus") and current.get("path"):
                    self.click_accessible_node(dnd, "restoring Do Not Disturb after scenario")
                    restored = self.accessibility(
                        "verifying Do Not Disturb cleanup state", "find", "--max-depth", "32",
                        "--max-nodes", "4000", "--include-state", "--name", str(dnd["name"]),
                        "--role", str(dnd["role"]), "--bus", str(dnd["bus"]),
                        "--path", str(dnd["path"]),
                    )
                    if restored["state_words"] != before_dnd:
                        raise RuntimeError("Do Not Disturb cleanup did not recover its initial exposed state")
            self.activate_shell_action("close-all")

    def test_notification_history(self) -> dict[str, object]:
        history_view_open = False
        summary = f"Shade history smoke {time.time_ns()}"
        self.desktop(
            "sending synthetic notification for history",
            "notify-send --expire-time=1200 --app-name=ShadeWorkflowTest "
            + shlex.quote(summary)
            + " 'Guest-only notification history check'",
        )
        self.activate_shell_action("open-notifications")
        try:
            self.wait_until(
                "independent notification center compositor layer",
                lambda: next(
                    (layer for layer in self.layers() if layer.get("namespace") == "shade-notification-center"),
                    None,
                ),
                timeout=10,
            )
            self.save_accessibility_tree("notification-history")
            history_button = self.accessibility(
                "finding notification history control", "find", "--max-depth", "32",
                "--max-nodes", "4000", "--name", "Histórico",
                "--role", "button",
            )
            self.click_accessible_node(history_button, "opening notification history")
            history_view_open = True
            self.save_accessibility_tree("notification-history-open")
            entry = self.accessibility(
                "finding unique notification in history", "find", "--max-depth", "32",
                "--max-nodes", "4000", "--name", summary, "--role", "list item",
            )
            probe_code = (
                "import json,pathlib,sys,time\n"
                "path=pathlib.Path.home()/'.cache/shade/notifications.json'\n"
                "for _ in range(20):\n"
                " rows=json.loads(path.read_text()) if path.exists() else []\n"
                " matches=[row for row in rows if row.get('summary')==sys.argv[1]]\n"
                " if matches:\n"
                "  print(json.dumps(matches)); break\n"
                " time.sleep(.25)\n"
                "else:\n"
                " raise SystemExit('notification was not persisted in history')"
            )
            persisted = self.desktop(
                "verifying guest notification history file",
                "python3 -c " + shlex.quote(probe_code) + " " + shlex.quote(summary),
            )
            return {
                "ui": "unique synthetic notification appeared in the notification center History view",
                "accessibility": {"history_button": history_button, "entry": entry},
                "guest": json.loads(persisted.stdout),
                "summary": summary,
            }
        finally:
            try:
                if history_view_open:
                    self.accessibility(
                        "restoring active notification view", "click", "--max-depth", "32",
                        "--max-nodes", "4000",
                        "--name", "Voltar às notificações", "--role", "button",
                    )
            finally:
                self.activate_shell_action("close-all")


    def test_visual_audit(self) -> dict[str, object]:
        """Record one real UI journey; keep behavior findings separate from capture failures."""
        events: list[dict[str, object]] = []
        findings: list[str] = []
        screenshots: dict[str, str] = {}
        timeline = self.artifacts / "visual-audit-events.json"
        guest_video = "/tmp/shade-visual-audit.mp4"
        unit = "shade-visual-audit.service"
        video = self.artifacts / "visual-audit.mp4"
        screenshots["baseline"] = str(self.capture("visual-baseline"))
        self.desktop("enabling guest animations for temporal audit",
                     "hyprctl eval 'hl.config({animations = {enabled = true}})'")
        launch_ns = time.monotonic_ns()
        self.desktop(
            "starting guest compositor recording",
            "systemd-run --user --collect --unit=shade-visual-audit "
            "--setenv=WAYLAND_DISPLAY=\"$WAYLAND_DISPLAY\" "
            "--setenv=XDG_RUNTIME_DIR=\"$XDG_RUNTIME_DIR\" "
            "--setenv=HYPRLAND_INSTANCE_SIGNATURE=\"$HYPRLAND_INSTANCE_SIGNATURE\" "
            f"wf-recorder --no-damage -f {guest_video} -c libx264 -p preset=ultrafast",
        )
        recording_ready = False
        try:
            ready = self.desktop(
                "waiting for guest recorder",
                f"sleep 1; systemctl --user is-active {unit}",
                timeout=8,
                check=False,
            )
            if ready.stdout.strip() != "active":
                journal = self.desktop(
                    "reading recorder failure",
                    f"journalctl --user -u {unit} --no-pager -n 30",
                    check=False,
                )
                raise RuntimeError(f"wf-recorder did not start: {journal.stdout.strip() or journal.stderr.strip()}")
            recording_ready = True
            ready_ns = time.monotonic_ns()

            def observe(label: str, operation):
                begun = time.monotonic_ns()
                try:
                    value = operation()
                    result = "observed"
                except (RuntimeError, Unsupported, subprocess.TimeoutExpired) as exc:
                    failure_capture = None
                    try:
                        failure_capture = str(self.capture(f"visual-failure-{len(events):02d}"))
                    except Exception as capture_error:
                        findings.append(f"failure screenshot unavailable for {label}: {capture_error}")
                    value = {"failure_capture": failure_capture}
                    result = str(exc)
                    findings.append(f"{label}: {exc}")
                finished = time.monotonic_ns()
                events.append({
                    "step": label,
                    "outcome": result,
                    "video_time_window_s": [
                        round(max(0, (begun - ready_ns) / 1e9), 3),
                        round((finished - launch_ns) / 1e9, 3),
                    ],
                })
                timeline.write_text(
                    json.dumps({"events": events, "findings": findings}, indent=2) + "\n",
                    encoding="utf-8",
                )
                return value

            def radio(expected: str) -> str:
                deadline = time.monotonic() + 3
                current = ""
                while time.monotonic() < deadline:
                    current = self.guest(f"checking Wi-Fi {expected}", "nmcli radio wifi").stdout.strip()
                    if current == expected:
                        return current
                    time.sleep(0.25)
                raise RuntimeError(f"Wi-Fi expected {expected}, observed {current!r} after 3 seconds")

            observe("open Quick Settings", lambda: self.vnc(
                "opening Quick Settings for visual audit",
                "keydown", "super", "key", "n", "keyup", "super", "pause", "0.5",
            ))
            screenshots["quicksettings"] = str(self.capture("visual-quicksettings"))
            self.save_accessibility_tree("visual-quicksettings")
            panel = next((layer for layer in self.layers()
                          if layer.get("namespace") == "shade-quicksettings"), None)
            if panel is None:
                findings.append("Quick Settings layer shade-quicksettings did not open")
            else:
                initial = observe("read initial Wi-Fi state", lambda: self.guest(
                    "reading Wi-Fi radio before visual audit", "nmcli radio wifi"
                ).stdout.strip())
                if initial not in ("enabled", "disabled"):
                    findings.append(f"Initial Wi-Fi state not usable for a toggle journey: {initial!r}")
                else:
                    opposite = "disabled" if initial == "enabled" else "enabled"
                    try:
                        observe(f"toggle Wi-Fi to {opposite}", lambda: self.click_wifi_control(
                            f"toggling Wi-Fi to {opposite} during recording",
                        ))
                        observe(f"Wi-Fi {opposite} effect", lambda: radio(opposite))
                    finally:
                        observed = self.guest(
                            "checking Wi-Fi state before restoration", "nmcli radio wifi",
                        ).stdout.strip()
                        if observed != initial:
                            observe(f"restore Wi-Fi {initial}", lambda: self.click_wifi_control(
                                f"restoring Wi-Fi to {initial} during recording",
                            ))
                        observe(f"Wi-Fi {initial} restoration receipt", lambda: radio(initial))
                screenshots["wifi"] = str(self.capture("visual-wifi"))

            summary = f"Shade visual audit {time.time_ns()}"
            observe("send notification", lambda: self.desktop(
                "sending synthetic notification during recording",
                "notify-send --expire-time=30000 --app-name=ShadeWorkflowTest "
                + shlex.quote(summary) + " 'Guest-only temporal feedback'",
            ))
            observe("notification toast accessible", lambda: self.accessibility(
                "finding audit notification toast", "find", "--max-depth", "16",
                "--max-nodes", "2000", "--name", summary, "--role", "label",
            ))
            screenshots["notification"] = str(self.capture("visual-notification"))
            observe("open independent notification center", lambda: self.activate_shell_action("open-notifications"))
            self.wait_until(
                "independent notification center layer",
                lambda: next((layer for layer in self.layers()
                              if layer.get("namespace") == "shade-notification-center"), None),
                timeout=10,
            )
            screenshots["notification-center"] = str(self.capture("visual-notification-center"))
            self.save_accessibility_tree("visual-notification-center")
            def dismiss_audit_notification():
                tree = self.accessibility_tree("locating audit notification card and dismiss action")
                def locate_branch(node):
                    if node.get("name") == summary:
                        return [node]
                    for child in node.get("children", []):
                        branch = locate_branch(child)
                        if branch:
                            return [node, *branch]
                    return []
                branch = locate_branch(tree)
                if not branch:
                    raise RuntimeError(f"Audit notification {summary!r} is absent from notification center")
                for ancestor in reversed(branch[:-1]):
                    actions = [node for node in self.walk_accessibility(ancestor)
                               if node.get("name") == "Dismiss notification"
                               and node.get("role") == "button"]
                    if len(actions) == 1:
                        self.click_accessible_node(actions[0], "dismissing only audit notification")
                        return actions[0]
                raise RuntimeError(f"No unique native dismiss action found for {summary!r}")
            observe("dismiss only audit notification semantically", dismiss_audit_notification)
            def dismissed_receipt():
                tree = self.accessibility_tree("checking dismissed audit notification")
                return True if not any(node.get("name") == summary for node in self.walk_accessibility(tree)) else None
            observe("notification center dismissal receipt", lambda: self.wait_until(
                "notification center no longer contains audit notification", dismissed_receipt, timeout=8,
            ))
            screenshots["dismissed"] = str(self.capture("visual-notification-dismissed"))
            observe("close notification center", lambda: self.activate_shell_action("close-all"))
            self.wait_until(
                "notification center closed",
                lambda: not any(layer.get("namespace") == "shade-notification-center"
                                for layer in self.layers()),
                timeout=8,
            )

            observe("close Quick Settings if still open", self.close_quick_settings)
            screenshots["closed"] = str(self.capture("visual-closed"))
            self.wait_until(
                "Quick Settings layer closed",
                lambda: not any(layer.get("namespace") == "shade-quicksettings"
                                for layer in self.layers()),
                timeout=8,
            )
        finally:
            self.desktop("stopping guest recorder", f"systemctl --user kill --signal=INT {unit}", check=False)
            if recording_ready:
                self.desktop(
                    "waiting for finalized guest video",
                    f"for i in $(seq 1 20); do systemctl --user is-active --quiet {unit} || break; sleep 0.25; done; "
                    f"if systemctl --user is-active --quiet {unit}; then echo 'Recorder did not stop' >&2; exit 1; fi; test -s {guest_video}",
                    timeout=12,
                )
                self.copy_guest_file(guest_video, video)

        size = self.local(
            "measuring visual audit frame",
            ["magick", "identify", "-format", "%w %h", screenshots["baseline"]],
        ).stdout.split()
        width, height = (int(value) for value in size)
        evidence = {
            "video": str(video),
            "timeline": str(timeline),
            "timing": "Frame PTS are exact for decoded video; action windows bound host dispatch relative to uncertain recorder start, not sub-frame UI latency.",
            "events": events,
            "screenshots": screenshots,
            "findings": findings,
            "limitations": [
                "64x64 grayscale frame differences nominate large changes; they do not prove absence of tiny text/color defects.",
                "Native-resolution state captures complement the bounded transition frames.",
                "No local vision-model inference ran; review the crops using decomposed-visual-ux-audit.",
            ],
        }
        report = self.artifacts / "visual-audit.json"
        report.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        sample_times = [
            timestamp for event in events
            for timestamp in (
                event["video_time_window_s"][0],
                sum(event["video_time_window_s"]) / 2,
                event["video_time_window_s"][1],
            )
        ]
        evidence["full_screen"] = render_evidence(
            video, (0, 0, width, height), self.artifacts / "visual-full",
            label="full-screen", sample_times=sample_times,
        )
        if panel is not None:
            x, y, w, h = (int(panel[key]) for key in ("x", "y", "w", "h"))
            evidence["quicksettings"] = render_evidence(
                video, (x, y, w, h), self.artifacts / "visual-panel",
                label="quicksettings", sample_times=sample_times,
            )
            evidence["quicksettings_geometry"] = [x, y, w, h]
        report.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if findings:
            raise RuntimeError(f"{len(findings)} visual journey finding(s); see {report}")
        return evidence

    def finish(self) -> int:
        if self.qemu is not None and self.qemu.poll() is None:
            logs = self.guest(
                "collecting guest shell journal for UI diagnostics",
                "journalctl --user -u shade-shell.service -b --no-pager",
                timeout=20, check=False,
            )
            (self.artifacts / "shell-journal.log").write_text(logs.stdout + logs.stderr, encoding="utf-8")
        print(f"Artifacts: {self.artifacts}", flush=True)
        statuses = [str(item["status"]) for item in self.results]
        print("Workflow results: " + ", ".join(f"{item['scenario']}={item['status']}" for item in self.results), flush=True)
        return 1 if any(status != "PASS" for status in statuses) else 0

    def cleanup(self) -> None:
        cleanup_started = time.monotonic()
        if self.qemu is not None and self.qemu.poll() is None:
            try:
                with socket.socket(socket.AF_UNIX) as monitor:
                    monitor.settimeout(2)
                    monitor.connect(str(self.monitor))
                    monitor.recv(4096)
                    monitor.sendall(b"system_powerdown\n")
            except OSError:
                pass
            try:
                self.qemu.wait(timeout=12)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(self.qemu.pid, signal.SIGTERM)
                    self.qemu.wait(timeout=5)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        os.killpg(self.qemu.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    self.qemu.wait(timeout=5)
        shutil.rmtree(self.state, ignore_errors=True)
        self.phase_timings["qemu_shutdown"] = time.monotonic() - cleanup_started
        self.write_results()
        metrics = summarize_timing(
            self.results, self.phase_timings, self.command_timings,
            time.monotonic() - self.started_at,
        )
        print(
            "Run timing: "
            f"elapsed={metrics['elapsed_seconds']}s, "
            f"scenarios={metrics['scenario_seconds']}s, "
            f"outside-scenarios={metrics['outside_scenario_seconds']}s, "
            f"host-commands={metrics['command_seconds']}s",
            flush=True,
        )
        print(f"Phase timings: {metrics['phase_seconds']}", flush=True)
        slowest = ", ".join(
            f"{item['label']}={item['duration_seconds']}s" for item in metrics["slowest_commands"]
        )
        print(f"Slowest host commands: {slowest or 'none'}", flush=True)


def main() -> int:
    if not os.environ.get("IN_NIX_SHELL"):
        os.execvp("nix", ["nix", "develop", "-c", "python3", str(Path(__file__).resolve()), *sys.argv[1:]])
    parser = argparse.ArgumentParser(description="Run the Shade VM workflow scenarios")
    parser.add_argument("--list-scenarios", action="store_true", help="list scenario IDs for selective VM runs")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--full-suite", action="store_true")
    mode.add_argument("--visual-audit", action="store_true")
    mode.add_argument("--ui-review", action="store_true", help="capture guest UI evidence across the review matrix")
    parser.add_argument("--review-family", action="append", choices=("shell", "settings-auth", "capture-share"), default=[])
    parser.add_argument("--review-theme", action="append", choices=("light", "dark"), default=[])
    parser.add_argument("--review-viewport", action="append", choices=("wide", "compact", "short"), default=[])
    parser.add_argument(
        "--scenario",
        action="append",
        default=[],
        metavar="ID",
        help="run only this scenario (repeatable); greeter-login remains a prerequisite",
    )
    args = parser.parse_args(sys.argv[1:])
    if args.ui_review:
        if args.scenario or args.list_scenarios:
            parser.error("--ui-review cannot be combined with --scenario or --list-scenarios")
        for option, values in (
            ("--review-family", args.review_family),
            ("--review-theme", args.review_theme),
            ("--review-viewport", args.review_viewport),
        ):
            if len(values) != len(set(values)):
                parser.error(f"{option} values must be unique")
    elif args.review_family or args.review_theme or args.review_viewport:
        parser.error("--review-family/--review-theme/--review-viewport require --ui-review")
    if args.scenario and args.list_scenarios:
        raise SystemExit("--scenario cannot be combined with --list-scenarios")
    if args.list_scenarios:
        print("greeter-login")
        print("launcher quicksettings settings-bar-position wifi capture notifications-dnd settings-search-keyboard")
        print("area-recording wifi-credential-connect window-target-capture settings-page-registry window-switcher")
        print("settings-displays-preview share-picker-portal bluetooth-pairing guest-brightness")
        print("audio-capture-playback fprintd-private-bus-protocol power-confirmation-cancel lock-unlock notification-history")
        print("visual-audit")
        return 0
    if len(set(args.scenario)) != len(args.scenario):
        raise SystemExit("--scenario IDs must be unique")
    if args.visual_audit:
        if args.scenario:
            parser.error("--visual-audit cannot be combined with --scenario")
        modes = ["--visual-audit"]
    elif args.full_suite or args.scenario:
        modes = ["--full-suite"]
    else:
        modes = []
    visual_audit = modes == ["--visual-audit"]
    full_suite = modes == ["--full-suite"]
    ui_review = args.ui_review
    test = WorkflowTest()
    if ui_review:
        test.review_selection = {
            "families": args.review_family or ["shell", "settings-auth", "capture-share"],
            "themes": args.review_theme or ["light", "dark"],
            "viewports": args.review_viewport or ["wide", "compact"],
        }
    shell_scenarios = (
        ("launcher", test.test_launcher),
        ("quicksettings", test.test_quicksettings),
        ("settings-bar-position", test.test_settings_position),
        ("wifi", test.test_wifi),
        ("capture", test.test_capture),
        ("notifications-dnd", test.test_notifications_dnd),
        ("settings-search-keyboard", test.test_settings_search_keyboard),
    )
    if visual_audit:
        shell_scenarios = (("visual-audit", test.test_visual_audit),)
    elif full_suite:
        shell_scenarios = (("area-recording", test.test_area_recording),) + shell_scenarios
        shell_scenarios += (
            ("wifi-credential-connect", test.test_wifi_credentials),
            ("window-target-capture", test.test_window_target_capture),
            ("settings-page-registry", test.test_settings_page_registry),
            ("window-switcher", test.test_window_switcher),
            ("settings-displays-preview", test.test_displays_preview),
            ("share-picker-portal", test.test_share_picker_portal),
            ("bluetooth-pairing", test.test_bluetooth_pairing),
            ("guest-brightness", test.test_guest_brightness),
            ("audio-capture-playback", test.test_guest_audio),
            ("fprintd-private-bus-protocol", test.test_fprint_private_bus),
            ("power-confirmation-cancel", test.test_power_confirmation_cancel),
            ("lock-unlock", test.test_lock_unlock),
            ("notification-history", test.test_notification_history),
            ("visual-audit", test.test_visual_audit),
        )
    if args.scenario:
        selected = set(args.scenario)
        available = dict(shell_scenarios)
        unknown = selected - set(available) - {"greeter-login"}
        if unknown:
            raise SystemExit(f"Unknown scenario ID(s): {', '.join(sorted(unknown))}")
        shell_scenarios = tuple(item for item in shell_scenarios if item[0] in selected)
    unsupported_coverage = (
        ("host-device-io", "Physical host USB, Wi-Fi, Bluetooth, audio, microphone, and backlight devices are not passed through; tests use guest-local virtual fixtures."),
        ("biometric-auth", "Physical fingerprint sensors, enrollment, biometric-backed PAM, and real biometric authentication are excluded; only the isolated guest protocol/client mock is exercised."),
        ("power-actions", "Real suspend, logout, reboot, and power-off actions are excluded; only opening and cancelling the guest confirmation UI is exercised."),
    ) if full_suite and not args.scenario else ()
    try:
        test.start()
        test.scenario(
            "greeter-login",
            (lambda: test.review_run_scenario("test_greeter")) if ui_review else test.test_greeter,
        )
        if test.results[-1]["status"] != "PASS":
            reason = "Shell scenarios require a successful greeter login; prerequisite did not pass"
            if ui_review:
                test.review_family = "prerequisite"
                test.review_theme = "prelogin"
                test.review_viewport = "native"
                test.review_record(
                    "greeter-login", "failed", reason=reason,
                    evidence={"workflow_status": test.results[-1]["status"],
                              "workflow_evidence": test.results[-1]["evidence"]},
                )
                test.record_result("ui-review", "UNSUPPORTED", reason, 0.0)
            else:
                for name, _callback in shell_scenarios:
                    test.record_result(name, "UNSUPPORTED", reason, 0.0)
        elif not ui_review:
            for name, callback in shell_scenarios:
                test.scenario(name, callback)
        if ui_review and test.results[0]["status"] == "PASS":
            test.scenario(
                "ui-review",
                lambda: test.test_ui_review(
                    args.review_family or ["shell", "settings-auth", "capture-share"],
                    args.review_theme or ["light", "dark"],
                    args.review_viewport or ["wide", "compact"],
                ),
            )
        for name, reason in unsupported_coverage:
            test.record_result(name, "UNSUPPORTED", reason, 0.0)
        return test.finish()
    except Exception as exc:
        print(f"Harness failure: {exc}", file=sys.stderr)
        print(f"Artifacts: {test.artifacts}", file=sys.stderr)
        return 1
    finally:
        test.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
