#!/usr/bin/env python3
"""Run isolated Shade desktop workflows in the repository's vm-vnc guest."""

from __future__ import annotations

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
        self.artifacts = Path(tempfile.mkdtemp(prefix="shade-workflow-artifacts."))
        self.state = Path(tempfile.mkdtemp(prefix="shade-workflow-state."))
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
            label, "tree", "--max-depth", "16", "--max-nodes", "4000"
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
        bounds = node.get("bounds")
        if not isinstance(bounds, list) or len(bounds) != 4:
            raise Unsupported(f"{label} has no usable screen bounds: {node}")
        x, y, width, height = (int(value) for value in bounds)
        if width <= 0 or height <= 0:
            raise Unsupported(f"{label} has empty screen bounds: {node}")
        self.vnc(label, "move", str(x + width // 2), str(y + height // 2), "click", "1", "pause", "0.2")

    def click_named(
        self, label: str, name: str, *, role: str | None = None, contains: bool = False
    ) -> dict[str, object]:
        node = self.find_accessible_node(name, role=role, contains=contains)
        self.click_accessible_node(node, label)
        return node

    def gsetting(self, key: str, value: str | None = None) -> str:
        schema = "com.caioasmuniz.shade_shell"
        if key in {"position"}:
            schema += ".bar"
        else:
            schema += ".screen-capture"
        if value is None:
            return self.desktop(
                f"reading {schema}.{key}", f"gsettings get {schema} {key}"
            ).stdout.strip()
        self.desktop(
            f"setting {schema}.{key}", f"gsettings set {schema} {key} {shlex.quote(value)}"
        )
        return self.gsetting(key)

    def quick_settings_open(self) -> bool:
        return any(
            350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700
            for layer in self.layers()
        )

    def open_quick_settings(self) -> None:
        if self.quick_settings_open():
            return
        self.vnc("opening Quick Settings", "keydown", "super", "key", "n", "keyup", "super")
        self.wait_until("Quick Settings panel", self.quick_settings_open, timeout=12)

    def close_quick_settings(self) -> None:
        if self.quick_settings_open():
            self.vnc("closing Quick Settings", "keydown", "super", "key", "n", "keyup", "super")
            self.wait_until("Quick Settings closure", lambda: not self.quick_settings_open(), timeout=12)

    def settings_page(self, title: str) -> dict[str, object]:
        tree = self.accessibility_tree(f"reading Settings navigation for {title}")
        preferred_roles = {"page tab", "tab", "list item", "button"}
        candidates = [
            node
            for node in self.walk_accessibility(tree)
            if node.get("name") == title
            and str(node.get("role") or "").casefold() in preferred_roles
        ]
        if len(candidates) != 1:
            raise Unsupported(
                f"Settings navigation entry {title!r} is not uniquely accessible: "
                f"{[{key: node.get(key) for key in ('name', 'role', 'bounds')} for node in candidates]}"
            )
        self.click_accessible_node(candidates[0], f"select Settings page {title}")
        return self.wait_until(
            f"Settings page {title}",
            lambda: self.accessibility(
                f"verifying Settings page {title}",
                "find", "--max-depth", "16", "--max-nodes", "4000",
                "--name", title, "--role", "tab panel",
            ),
            timeout=12,
        )

    def open_settings(self) -> None:
        self.open_quick_settings()
        self.vnc("open Settings from Quick Settings", "move", "230", "406", "click", "1", "pause", "0.3")
        self.wait_until(
            "Shade Settings window",
            lambda: any(
                "settings" in str(client.get("title", "")).casefold()
                for client in self.clients()
            ),
            timeout=15,
        )

    def close_settings(self) -> None:
        settings_clients = [
            client for client in self.clients()
            if "settings" in str(client.get("title", "")).casefold()
        ]
        if settings_clients:
            self.vnc("close Settings", "move", "1251", "29", "click", "1", "pause", "0.2")
            self.wait_until(
                "Shade Settings closure",
                lambda: not any(
                    "settings" in str(client.get("title", "")).casefold()
                    for client in self.clients()
                ),
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
        if not destination.is_file() or destination.stat().st_size < 1024:
            raise RuntimeError(f"Guest recording was not copied: {destination}")

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
        ready = self.artifacts / "greeter-ready.png"
        size = self.local("reading greeter screen size", ["magick", "identify", "-format", "%wx%h", str(ready)]).stdout.strip()
        if size != "1280x800":
            raise Unsupported(f"Greeter pointer fixture requires a 1280x800 screen; got {size}")

        self.vnc("clicking the greeter Continue button", "move", "640", "491", "click", "1", "pause", "1")
        prompt = self.capture("greeter-password-prompt")
        continue_change = self.assert_visual_change(ready, prompt, "Continue to password")
        self.vnc("submit invalid greeter password", "type", "shade-invalid", "key", "enter", "pause", "2")
        invalid = self.capture("greeter-invalid-password")
        invalid_change = self.assert_visual_change(prompt, invalid, "invalid password feedback")
        if self.user_service_active("verifying invalid login did not start Shade"):
            raise RuntimeError("Invalid password unexpectedly started the tester Shade session")
        self.vnc("return from greeter password prompt", "key", "esc", "pause", "1")
        back = self.capture("greeter-back")
        back_change = self.assert_visual_change(prompt, back, "Escape to user selection")
        self.vnc("reopen greeter password prompt", "move", "640", "491", "click", "1", "pause", "1")
        retry = self.capture("greeter-password-retry")
        retry_change = self.assert_visual_change(back, retry, "Continue after Back")
        self.vnc("submit test-account password", "type", SSH_PASSWORD, "key", "enter", "pause", "2")
        self.wait_shell()
        return {
            "ui": "VNC pointer selected Continue in the fixed-size greeter; virtual keyboard submitted invalid and valid passwords, with Escape/Back between attempts",
            "visual_pixels_changed_in_form": {
                "continue": continue_change,
                "invalid_response": invalid_change,
                "back": back_change,
                "retry": retry_change,
            },
            "guest": "invalid login left the Shade service inactive; valid login started Shade and registered AT-SPI",
            "screenshots": [str(invalid), str(back)],
        }

    def test_launcher(self) -> dict[str, object]:
        before = self.layers()
        before_geometry = {tuple(layer.get(key) for key in ("x", "y", "w", "h")) for layer in before}
        self.vnc("open launcher with Super+Space", "keydown", "super", "key", "space", "keyup", "super", "pause", "3")
        self.capture("launcher-open")
        self.save_accessibility_tree("launcher-open")
        entry = self.accessibility("finding launcher search entry", "find", "--max-depth", "16", "--max-nodes", "2000", "--name", "", "--role", "text box")
        opened = self.layers()
        launcher = next(
            (
                layer
                for layer in opened
                if tuple(layer.get(key) for key in ("x", "y", "w", "h")) not in before_geometry
                and int(layer.get("w", 0)) >= 600
                and int(layer.get("h", 0)) >= 700
            ),
            None,
        )
        if launcher is None:
            raise RuntimeError(f"Super+Space did not add the launcher layer: {opened}")
        launcher_geometry = tuple(launcher.get(key) for key in ("x", "y", "w", "h"))
        self.vnc("close launcher with Escape", "key", "esc", "pause", "1")
        remaining = self.layers()
        if launcher_geometry in {tuple(layer.get(key) for key in ("x", "y", "w", "h")) for layer in remaining}:
            raise RuntimeError("Launcher layer remained after Escape")
        return {"ui": "VNC Super+Space opened the launcher; Escape removed its layer", "accessibility": entry, "guest": {"launcher_geometry": launcher_geometry, "remaining_layer_count": len(remaining)}}

    def test_quicksettings(self) -> dict[str, object]:
        before = self.layers()
        before_geometry = {tuple(layer.get(key) for key in ("x", "y", "w", "h")) for layer in before}
        self.vnc("open Quick Settings with Super+N", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")
        self.capture("quicksettings-open")
        self.save_accessibility_tree("quicksettings-open")
        wifi = self.accessibility("finding Wi-Fi tile", "find", "--max-depth", "16", "--max-nodes", "2000", "--name", "WiFi", "--role", "button")
        opened = self.layers()
        quicksettings = next(
            (
                layer
                for layer in opened
                if tuple(layer.get(key) for key in ("x", "y", "w", "h")) not in before_geometry
                and 350 <= int(layer.get("w", 0)) < 600
                and int(layer.get("h", 0)) >= 700
            ),
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

    def start_pattern_window(self) -> dict[str, object]:
        pattern = """import Gtk from 'gi://Gtk?version=4.0';
const app = new Gtk.Application({application_id: 'org.shade.WorkflowPattern'});
app.connect('activate', () => {
  const window = new Gtk.ApplicationWindow({application: app, title: 'Shade Area Recording Pattern'});
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
  window.present();
});
app.run([]);"""
        guest_script = "/tmp/shade-vm-pattern.mjs"
        self.desktop(
            "creating deterministic guest capture pattern",
            f"printf %s {shlex.quote(pattern)} > {guest_script}; "
            f"systemd-run --user --no-block --collect --unit=shade-vm-pattern gjs -m {guest_script}",
        )
        client = self.wait_until(
            "guest capture pattern window",
            lambda: next(
                (
                    item for item in self.clients()
                    if item.get("title") == "Shade Area Recording Pattern"
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
            f"hyprctl dispatch movewindowpixel "
            + shlex.quote(f"exact 100 100,address:{address}"),
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
        if argv and os.path.basename(argv[0]) in ('wf-recorder', 'wl-screenrec'):
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

    def stop_recording(self) -> None:
        try:
            node = self.accessibility(
                "finding visible recording Stop control",
                "find", "--description-match", "--name", "Stop recording",
                "--role", "button",
            )
            self.click_accessible_node(node, "stop recording from its visible control")
        except (RuntimeError, Unsupported):
            self.desktop(
                "requesting graceful recorder stop during cleanup",
                "pkill -INT -x wf-recorder 2>/dev/null || true; "
                "pkill -INT -x wl-screenrec 2>/dev/null || true",
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
                "280,20:#ffffff", "10,150:#ff8000", "55,150:#00ffff",
                "170,150:#ff00ff", "280,150:#ffff00",
            ]
        )
        return self.local(
            f"asserting decoded crop content for {video.name}",
            [
                "python3", str(ROOT / "scripts/vm-recording-frame-assert.py"),
                str(video), str(width), str(height),
                *[arg for point in points for arg in ("--sample", point)],
            ],
            timeout=40,
        )

    def test_area_recording(self) -> dict[str, object]:
        original_engine = self.gsetting("area-selection-engine").strip("'\"")
        original_boundary = self.gsetting("show-recording-boundary")
        pattern_started = False
        pattern: dict[str, object] = {}
        evidence: list[dict[str, object]] = []
        active_guest_videos: set[str] = set()
        log_marker = self.desktop("marking area recording log time", "date +%s").stdout.strip()
        try:
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
                        self.vnc(f"confirming {engine} rectangle", "key", "enter")
                    recorder = self.wait_until(
                        f"{engine} {boundary=} recorder",
                        lambda: next(iter(self.recording_processes()), None),
                        timeout=20,
                    )
                    argv = [str(arg) for arg in recorder.get("argv", [])]
                    if "-g" not in argv or argv[argv.index("-g") + 1] != f"320x200+{x0}+{y0}":
                        raise RuntimeError(
                            f"Recorder did not receive selected geometry 320x200+{x0}+{y0}: {argv}"
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
                if self.recording_processes():
                    self.stop_recording()
            finally:
                try:
                    self.gsetting("area-selection-engine", f"'{original_engine}'")
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
                            if pattern_started:
                                self.stop_pattern_window()

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
                    return {"samples": consecutive}
            else:
                consecutive.clear()
            time.sleep(0.25)
        raise RuntimeError(
            f"Bar did not converge to {position} ({raw_value}) over three stable samples: {last}"
        )

    def test_settings_position(self) -> dict[str, object]:
        saved_raw = self.gsetting("position")
        saved_position = {1: "Top", 8: "Left", 2: "Right", 4: "Bottom"}.get(int(saved_raw))
        initial_geometry = self.bar_position_from_layers(self.layers())
        opened_settings = False
        restored_raw = None
        restoration = None
        try:
            self.open_settings()
            opened_settings = True
            self.save_accessibility_tree("settings-home")
            page = self.settings_page("Bar & Dock")
            self.capture("settings-bar-position")
            self.save_accessibility_tree("settings-bar-position")
            bounds = page.get("bounds")
            if not isinstance(bounds, list) or len(bounds) != 4 or int(bounds[2]) < 400 or int(bounds[3]) < 400:
                raise RuntimeError(f"Bar & Dock page is not selected in Settings: {page}")

            self.click_named("establishing known Top bar baseline", "Top", role="toggle button")
            top = self.wait_bar_position("Top", "1")
            self.click_named("moving visible Bar position control to Bottom", "Bottom", role="toggle button")
            bottom = self.wait_bar_position("Bottom", "4")
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
                self.desktop(
                    "restoring exact raw bar position",
                    f"gsettings set com.caioasmuniz.shade_shell.bar position {shlex.quote(saved_raw)}",
                )
                restored_raw = self.gsetting("position")
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
            "ui": "Visible Bar & Dock controls established Top, moved to Bottom, and restored the exact saved position.",
            "guest": {
                "saved_raw": saved_raw,
                "saved_position": saved_position,
                "initial_geometry": initial_geometry,
                "top_stable_samples": top,
                "bottom_stable_samples": bottom,
                "bottom_layer": bottom_bar,
                "bottom_screenshot": str(bottom_capture),
                "restored_raw": restored_raw,
                "restoration": restoration,
            },
            "accessibility": {"page": page},
        }

    def test_wifi(self) -> dict[str, object]:
        self.vnc("open Wi-Fi controls", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")
        try:
            self.save_accessibility_tree("wifi-controls")
            button = self.accessibility("finding Wi-Fi tile", "find", "--max-depth", "16", "--max-nodes", "2000", "--name", "WiFi", "--role", "button")
            initial = self.guest("reading initial Wi-Fi radio", "nmcli radio wifi", timeout=30).stdout.strip()
            if initial != "enabled":
                raise RuntimeError(f"Wi-Fi test fixture must start enabled: got {initial!r}")
            self.accessibility("turning Wi-Fi off in Quick Settings", "click", "--max-depth", "16", "--max-nodes", "2000", "--name", "WiFi", "--role", "button")
            off = self.guest("verifying Wi-Fi disabled", "nmcli radio wifi", timeout=30).stdout.strip()
            if off != "disabled":
                raise RuntimeError(f"Wi-Fi UI action did not disable the radio: got {off!r}")
            self.accessibility("turning Wi-Fi on in Quick Settings", "click", "--max-depth", "16", "--max-nodes", "2000", "--name", "WiFi Off", "--role", "button")
            deadline = time.monotonic() + 10
            on = ""
            while time.monotonic() < deadline:
                on = self.guest("verifying Wi-Fi enabled", "nmcli radio wifi", timeout=30).stdout.strip()
                if on == "enabled":
                    break
                time.sleep(0.5)
            if on != "enabled":
                raise RuntimeError(f"Wi-Fi UI action did not re-enable the radio: got {on!r}")
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
                self.click_named("enabling guest Wi-Fi in Quick Settings", "WiFi Off", role="button")
                self.wait_until(
                    "guest Wi-Fi radio enabled",
                    lambda: self.guest("waiting for guest Wi-Fi radio", "nmcli radio wifi").stdout.strip() == "enabled",
                    timeout=20,
                )
            wifi = self.find_accessible_node("WiFi", role="button")
            bounds = wifi.get("bounds")
            if not isinstance(bounds, list) or len(bounds) != 4:
                raise Unsupported(f"Wi-Fi split control has no bounds: {wifi}")
            x, y, width, height = (int(value) for value in bounds)
            self.vnc("opening Wi-Fi access-point list", "move", str(x + width - 12), str(y + height // 2), "click", "1")
            self.click_named("scanning guest Wi-Fi access points", "Scan", role="button")
            self.wait_until(
                "guest-local Shade-Test AP in NetworkManager",
                lambda: "Shade-Test" in str(self.wifi_guest_state(device).get("scan", "")),
                timeout=25,
            )
            self.click_named("selecting guest-local Shade-Test network", "Shade-Test", role="label")
            self.wait_until(
                "Shade-Test credential prompt",
                lambda: self.find_accessible_node("Password", contains=True, role="text"),
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
            self.click_named("disconnecting guest Shade-Test from its visible row", "Shade-Test", role="label")
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
                        target = "WiFi" if current_radio == "enabled" else "WiFi Off"
                        self.click_named("restoring original guest Wi-Fi radio state", target, role="button")
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
        overlay_open = False
        guest_video: str | None = None
        screenshot_guest: str | None = None
        pattern_started = False
        pattern: dict[str, object] = {}
        try:
            pattern_started = True
            pattern = self.start_pattern_window()
            client_size = pattern.get("size")
            client_at = pattern.get("at")
            if client_size != [480, 320] or client_at != [100, 100]:
                raise RuntimeError(f"Window capture pattern geometry is not deterministic: {pattern}")
            before_layers = len(self.layers())
            screenshot_marker = self.desktop(
                "marking window-target screenshot artifact time", "date +%s.%N"
            ).stdout.strip()
            overlay_open = True
            self.desktop("opening Shade capture target picker", "shade-shell screenshot-overlay")
            self.wait_until(
                "Shade screenshot target picker",
                lambda: len(self.layers()) > before_layers,
                timeout=12,
            )
            self.click_named("choosing Window screenshot target", "Window", role="toggle button")
            self.vnc(
                "selecting guest pattern window for screenshot",
                "move", "340", "260", "click", "1", "key", "enter",
            )
            self.wait_until(
                "window screenshot overlay closure",
                lambda: len(self.layers()) <= before_layers,
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
            record_layers = len(self.layers())
            record_marker = self.desktop(
                "marking window-target recording time", "date +%s.%N"
            ).stdout.strip()
            overlay_open = True
            self.desktop("opening Shade recording target picker", "shade-shell screenshot-overlay")
            self.wait_until(
                "Shade recording target picker",
                lambda: len(self.layers()) > record_layers,
                timeout=12,
            )
            self.click_named("selecting Record mode", "Record", role="toggle button")
            self.click_named("selecting Window recording target", "Window", role="toggle button")
            self.vnc(
                "selecting guest pattern window for recording",
                "move", "340", "260", "click", "1", "key", "enter",
            )
            self.wait_until(
                "window recording target overlay closure",
                lambda: len(self.layers()) <= record_layers,
                timeout=12,
            )
            overlay_open = False
            recorder = self.wait_until(
                "window-target recording backend",
                lambda: next(iter(self.recording_processes()), None),
                timeout=20,
            )
            argv = [str(arg) for arg in recorder.get("argv", [])]
            expected_geometry = "480x320+100+100"
            if "-g" not in argv or argv[argv.index("-g") + 1] != expected_geometry:
                raise RuntimeError(f"Window recorder did not receive the selected window bounds: {argv}")
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
                            if pattern_started:
                                self.stop_pattern_window()

    def test_settings_page_registry(self) -> dict[str, object]:
        pages = [
            "Appearance", "Displays", "Bar & Dock", "Idle & Lock", "Notifications",
            "Screen Capture", "Network", "Bluetooth", "Clock & Weather", "Timer",
            "Sound", "Mouse & Touchpad", "Keyboard Shortcuts", "Default Apps",
            "Startup Apps", "About", "Debug",
        ]
        visited: list[dict[str, object]] = []
        opened_settings = False
        try:
            self.open_settings()
            opened_settings = True
            for title in pages:
                panel = self.settings_page(title)
                bounds = panel.get("bounds")
                if not isinstance(bounds, list) or len(bounds) != 4 or int(bounds[2]) <= 0 or int(bounds[3]) <= 0:
                    raise RuntimeError(f"Settings page {title!r} did not render usable content: {panel}")
                screenshot = self.capture(f"settings-page-{len(visited) + 1:02d}")
                visited.append({"title": title, "panel": panel, "screenshot": str(screenshot)})
            return {
                "ui": "Visited all 17 registered Settings pages by their navigation entries; page controls were not activated.",
                "guest": {"visited_pages": visited, "count": len(visited)},
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
            page = self.settings_page("Displays")
            tree = self.accessibility_tree("reading display controls before preview")
            self.save_accessibility_tree("settings-displays-preview")
            scale_controls = [
                node for node in self.walk_accessibility(tree)
                if node.get("role", "").casefold() == "spin button"
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
            control = scale_controls[0]
            self.click_accessible_node(control, "editing Virtual-1 scale in Displays settings")
            self.vnc(
                "setting a reversible Virtual-1 scale preview",
                "keydown", "ctrl", "key", "a", "keyup", "ctrl",
                "type", str(target_scale), "key", "enter",
            )
            self.click_named("applying reversible display preview", "Apply", role="button")
            preview_pending = True
            self.wait_until(
                "display preview controls",
                lambda: self.find_accessible_node("Revert", role="button"),
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
            self.click_named("reverting guest display preview", "Revert", role="button")
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
                    self.click_named("reverting pending display preview during cleanup", "Revert", role="button")
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
            self.open_settings()
            settings_open = True
            pattern = self.start_pattern_window()
            pattern_started = True
            settings = next(
                (
                    client for client in self.clients()
                    if "settings" in str(client.get("title", "")).casefold()
                ),
                None,
            )
            if settings is None:
                raise RuntimeError("Shade Settings client disappeared before switcher exercise")
            address = str(settings.get("address", ""))
            self.desktop(
                "focusing Settings before switcher selection",
                "hyprctl dispatch focuswindow " + shlex.quote(f"address:{address}"),
            )
            before_clients = self.clients()
            before_count = len(before_clients)
            before_active = self.active_window()
            before_layers = len(self.layers())
            self.desktop("opening Shade window switcher", "shade-shell toggle windowswitcher")
            self.wait_until(
                "window switcher layer",
                lambda: len(self.layers()) > before_layers,
                timeout=12,
            )
            self.capture("window-switcher-select")
            self.vnc("selecting next switcher client", "key", "enter")
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
                "hyprctl dispatch focuswindow " + shlex.quote(f"address:{address}"),
            )
            cancel_before = self.active_window()
            cancel_layers = len(self.layers())
            self.desktop("reopening Shade window switcher", "shade-shell toggle windowswitcher")
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
            return {
                "ui": "Opened the switcher with Settings and a pattern client, selected/focused the pattern, then tested Escape cancellation.",
                "guest": {
                    "client_count_before": before_count,
                    "settings_address": address,
                    "pattern_address": pattern.get("address"),
                    "active_before": before_active,
                    "active_after_selection": selected_active,
                    "active_before_escape": cancel_before,
                    "active_after_escape": cancel_active,
                    "client_count_after": len(final_clients),
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
        marker = self.desktop("marking portal request log time", "date +%s").stdout.strip()
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
                    if client.get("title") == "Share Screen / Window"
                ),
                None,
            ),
            timeout=20,
        )
        self.capture(f"share-picker-{kind}")
        self.save_accessibility_tree(f"share-picker-{kind}")
        if kind == "screen":
            self.click_named("show guest screen sources", "Screens", role="page tab")
            primary = next((item for item in self.monitors() if item.get("name") == "Virtual-1"), None)
            if primary is None:
                raise RuntimeError("Portal screen selection has no Virtual-1 primary output")
            self.click_named(
                "selecting Virtual-1 through the Shade share picker",
                str(primary.get("name")),
                role="label",
                contains=True,
            )
        elif kind == "window":
            self.click_named("show guest window sources", "Windows", role="page tab")
            self.click_named(
                "selecting the guest test window through the Shade share picker",
                "Shade Area Recording Pattern",
                role="label",
                contains=True,
            )
        elif kind == "cancel":
            self.click_named("cancelling the real Shade share picker", "Cancel", role="button")
        else:
            raise ValueError(f"Unknown portal scenario kind: {kind}")
        self.wait_until(
            f"portal requester response after {kind}",
            lambda: (
                logs
                if (
                    (logs := self.portal_journal(marker))
                    and "PORTAL RESPONSE" in logs
                    and "Session.Close" in logs
                )
                else None
            ),
            timeout=30,
        )
        logs = self.portal_journal(marker)
        if "PORTAL RESPONSE org.freedesktop.portal.Session.Close" not in logs or " closed" not in logs:
            raise RuntimeError(f"Portal requester did not close its ScreenCast session: {logs}")
        if kind == "screen":
            if "[SELECTION]/screen:" not in logs or "Start accepted" not in logs:
                raise RuntimeError(f"Guest picker did not return an accepted screen selection: {logs}")
        elif kind == "window":
            if "[SELECTION]/window:" not in logs or "Start accepted" not in logs:
                raise RuntimeError(f"Guest picker did not return an accepted window selection: {logs}")
        elif not any(
            phrase in logs
            for phrase in (
                "was cancelled in the guest share picker",
                "SelectSources was cancelled",
                "CreateSession was cancelled",
            )
        ):
            raise RuntimeError(f"Guest share picker cancellation did not cancel the portal request: {logs}")
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
            "selection_log": next(
                (line for line in logs.splitlines() if "[SELECTION]" in line),
                None,
            ),
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

    def bluetooth_controllers(self) -> list[str]:
        result = self.guest("reading guest Bluetooth controllers", "bluetoothctl list")
        return [
            fields[1]
            for line in result.stdout.splitlines()
            if len(fields := line.split()) >= 2 and fields[0] == "Controller"
        ]

    def bluetooth_info(self, controller: str, address: str) -> str:
        return self.guest(
            "reading guest Bluetooth device state",
            "bluetoothctl --controller " + shlex.quote(controller)
            + " info " + shlex.quote(address),
            check=False,
        ).stdout

    def test_bluetooth_pairing(self) -> dict[str, object]:
        controllers = self.bluetooth_controllers()
        if len(controllers) < 2:
            raise Unsupported(f"Guest Bluetooth fixture expected two virtual controllers, found {controllers}")
        primary_address, peer_controller = controllers[:2]
        fixture_started = False
        settings_open = False
        scanning = False
        paired_address: str | None = None
        initial_powered = "Powered: yes" in self.guest(
            "snapshotting guest Bluetooth adapter power",
            "bluetoothctl --controller " + shlex.quote(primary_address) + " show",
        ).stdout
        try:
            self.guest(
                "starting guest-only Bluetooth advertising peer",
                "sudo -n systemctl start shade-vm-bluetooth-fixture.target",
            )
            fixture_started = True
            self.open_settings()
            settings_open = True
            page = self.settings_page("Bluetooth")
            self.save_accessibility_tree("settings-bluetooth-peer")
            if not initial_powered:
                self.click_named("enabling guest Bluetooth from Settings", "Bluetooth", role="switch")
                self.wait_until(
                    "guest Bluetooth adapter powered",
                    lambda: "Powered: yes" in self.guest(
                        "waiting for guest Bluetooth adapter",
                        "bluetoothctl --controller " + shlex.quote(primary_address) + " show",
                    ).stdout,
                    timeout=20,
                )
            self.click_named("starting guest Bluetooth discovery", "Scan for Devices", role="button")
            scanning = True
            devices = self.wait_until(
                "guest-advertised ShadeVM-Peer",
                lambda: (
                    output
                    if "ShadeVM-Peer" in (output := self.guest(
                        "discovering on guest virtual Bluetooth controller",
                        "bluetoothctl --controller " + shlex.quote(primary_address) + " devices",
                        check=False,
                    ).stdout)
                    else None
                ),
                timeout=30,
            )
            address_match = next(
                (
                    fields[1]
                    for line in devices.splitlines()
                    if len(fields := line.split()) >= 3 and fields[2] == "ShadeVM-Peer"
                ),
                None,
            )
            if address_match is None:
                raise RuntimeError(f"Guest BlueZ did not report the advertised peer: {devices}")
            paired_address = address_match
            self.click_named("pairing discovered guest peer in Settings", "Pair", role="button")
            paired = self.wait_until(
                "guest peer paired and connected",
                lambda: (
                    info
                    if (
                        (info := self.bluetooth_info(primary_address, address_match))
                        and "Paired: yes" in info
                    )
                    else None
                ),
                timeout=35,
            )
            connected = "Connected: yes" in paired
            if not connected:
                self.click_named("connecting the paired guest peer", "Connect", role="button")
                paired = self.wait_until(
                    "guest peer connection",
                    lambda: (
                        info
                        if "Connected: yes" in (info := self.bluetooth_info(primary_address, address_match))
                        else None
                    ),
                    timeout=30,
                )
            if "Connected: yes" not in paired:
                raise RuntimeError(f"Guest-only Bluetooth peer did not connect: {paired}")
            self.click_named("disconnecting guest peer before cleanup", "Disconnect", role="button")
            self.wait_until(
                "guest Bluetooth peer disconnected",
                lambda: "Connected: no" in self.bluetooth_info(primary_address, address_match),
                timeout=20,
            )
            self.click_named("forgetting guest Bluetooth peer", "Forget", role="button")
            self.click_named("confirming guest Bluetooth forget cleanup", "Confirm", role="button")
            forgotten = self.wait_until(
                "guest Bluetooth peer forgotten",
                lambda: (
                    output
                    if not any(
                        len(fields := line.split()) >= 2 and fields[1] == address_match
                        for line in output.splitlines()
                    )
                    else None
                ) if (output := self.guest(
                    "checking guest Bluetooth device list after Forget",
                    "bluetoothctl --controller " + shlex.quote(primary_address) + " devices",
                    check=False,
                ).stdout) else "forgotten",
                timeout=20,
            )
            return {
                "ui": "Settings discovered the guest-only advertiser, paired and connected it, disconnected, then used Forget and Confirm.",
                "guest": {
                    "controllers": controllers,
                    "main_controller": primary_address,
                    "peer_controller": peer_controller,
                    "device_address": address_match,
                    "paired_and_connected": paired,
                    "forgotten_device_info": forgotten,
                },
                "accessibility": {"page": page},
            }
        finally:
            try:
                if scanning:
                    try:
                        stop_scan = self.find_accessible_node("Stop Scan", role="button")
                    except (RuntimeError, Unsupported):
                        stop_scan = None
                    if stop_scan:
                        self.click_accessible_node(stop_scan, "stopping guest Bluetooth discovery")
                if paired_address:
                    self.guest(
                        "removing guest peer pairing if still present",
                        "bluetoothctl --controller " + shlex.quote(primary_address)
                        + " remove " + shlex.quote(paired_address),
                        check=False,
                    )
                if not initial_powered and "Powered: yes" in self.guest(
                    "checking Bluetooth power before cleanup",
                    "bluetoothctl --controller " + shlex.quote(primary_address) + " show",
                    check=False,
                ).stdout:
                    self.guest(
                        "restoring guest Bluetooth adapter power",
                        "bluetoothctl --controller " + shlex.quote(primary_address) + " power off",
                        check=False,
                    )
                elif initial_powered and "Powered: no" in self.guest(
                    "checking Bluetooth power before cleanup",
                    "bluetoothctl --controller " + shlex.quote(primary_address) + " show",
                    check=False,
                ).stdout:
                    self.guest(
                        "restoring guest Bluetooth adapter power",
                        "bluetoothctl --controller " + shlex.quote(primary_address) + " power on",
                        check=False,
                    )
            finally:
                try:
                    if settings_open:
                        self.close_settings()
                finally:
                    if fixture_started:
                        self.guest(
                            "stopping guest-only Bluetooth peer fixture",
                            "sudo -n systemctl stop shade-vm-bluetooth-fixture.target",
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

    def test_guest_audio(self) -> dict[str, object]:
        old_sink = self.guest("snapshotting guest default output", "pactl get-default-sink").stdout.strip()
        old_source = self.guest("snapshotting guest default input", "pactl get-default-source").stdout.strip()
        fixture_started = False
        settings_open = False
        capture_started = False
        guest_files = ["/tmp/shade-vm-generated-tone.wav", "/tmp/shade-vm-captured-tone.wav"]
        test_sink = "shade_vm_test_output"
        test_source = "shade_vm_test_output.monitor"
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
                    )
                    else None
                ),
                timeout=20,
            )
            sink_original = self.audio_volume_raw("sink", test_sink)
            source_original = self.audio_volume_raw("source", test_source)
            self.guest("selecting isolated guest null sink", f"pactl set-default-sink {test_sink}")
            self.guest("selecting isolated guest monitor source", f"pactl set-default-source {test_source}")
            self.open_settings()
            settings_open = True
            page = self.settings_page("Sound")
            self.save_accessibility_tree("settings-sound-audio")
            settings_sliders = self.slider_nodes(
                self.accessibility_tree("reading guest Sound endpoint sliders")
            )
            if len(settings_sliders) < 2:
                raise Unsupported(f"Sound Settings did not expose output and input volume sliders: {settings_sliders}")
            self.capture("settings-sound-audio")
            self.set_slider_fraction(settings_sliders[0], 0.36, "adjusting guest null sink volume in Sound Settings")
            sink_changed = self.wait_until(
                "guest null sink volume feedback",
                lambda: (
                    values
                    if (values := self.audio_volume_raw("sink", test_sink)) != sink_original
                    else None
                ),
                timeout=12,
            )
            self.set_slider_fraction(settings_sliders[1], 0.42, "adjusting guest monitor input volume in Sound Settings")
            source_changed = self.wait_until(
                "guest monitor source volume feedback",
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
                f"parec --device={test_source} --file-format=wav {guest_files[1]}",
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
                    "rms=(sum(v*v for v in mono)/len(mono))**0.5; "
                    "crossings=sum(1 for a,b in zip(mono,mono[1:]) if a<=0<b); "
                    "duration=len(mono)/rate; "
                    "print(json.dumps({'frames':len(mono),'rate':rate,'channels':channels,'duration_s':duration,"
                    "'rms':rms,'estimated_hz':crossings/duration}))",
                    str(captured),
                ],
            )
            signal = json.loads(signal_stats.stdout)
            if signal["rms"] < 100 or not 390 <= signal["estimated_hz"] <= 490:
                raise RuntimeError(f"Guest null-sink monitor did not capture the generated 440 Hz tone: {signal}")
            return {
                "ui": "Sound Settings adjusted both the isolated guest null-sink output and its monitor source.",
                "guest": {
                    "sink": test_sink,
                    "source": test_source,
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
            "journalctl --user -u shade-vm-fprint-mock.service --no-pager",
            check=False,
        )
        return result.stdout + result.stderr

    def test_fprint_private_bus(self) -> dict[str, object]:
        if not self.user_service_active("checking normal Shade service before fprint protocol test"):
            raise Unsupported("Normal Shade user service is not active for the private-bus protocol exercise")
        uid = self.guest("reading guest tester UID", "id -u").stdout.strip()
        if not uid.isdigit():
            raise RuntimeError(f"Invalid guest tester UID: {uid!r}")
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
                    "sshpass", "-p", SSH_PASSWORD, "scp",
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
                f"gjs -m {mock_path} --socket {shlex.quote(socket_path)} "
                "--sequence active-hold,no-match-retry,mock-match --hold-ms 1200 --retry-ms 700",
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
            before_layers = len(self.layers())
            self.desktop("locking guest for private fprint protocol", "shade-shell lockscreen")
            self.wait_until(
                "private-bus guest lockscreen",
                lambda: self.lockscreen_visible(),
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
                lambda: not self.lockscreen_visible(),
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
            "password" in str(node.get("name") or "").casefold()
            and isinstance(node.get("bounds"), list)
            and len(node["bounds"]) == 4
            and int(node["bounds"][2]) > 0
            and int(node["bounds"][3]) > 0
            for node in self.walk_accessibility(tree)
        )

    def test_lock_unlock(self) -> dict[str, object]:
        baseline_layers = len(self.layers())
        locked = False
        try:
            self.desktop("locking guest session", "shade-shell lockscreen")
            self.wait_until(
                "guest password lockscreen",
                lambda: self.lockscreen_visible(),
                timeout=15,
            )
            locked = True
            locked_capture = self.capture("password-lockscreen")
            self.save_accessibility_tree("password-lockscreen")
            self.vnc("entering disposable guest password", "type", SSH_PASSWORD, "key", "enter")
            self.wait_until(
                "guest session password unlock",
                lambda: not self.lockscreen_visible(),
            )
            unlocked_capture = self.capture("password-unlocked-session")
            if not self.user_service_active("verifying Shade remains active after password unlock"):
                raise RuntimeError("Shade session service is not active after password unlock")
            locked = False
            return {
                "ui": "Locked the guest session, authenticated through the visible password field, and returned to the unlocked desktop.",
                "guest": {
                    "password": "disposable guest account only",
                    "lockscreen_screenshot": str(locked_capture),
                    "unlocked_screenshot": str(unlocked_capture),
                    "baseline_layer_count": baseline_layers,
                    "unlocked_layer_count": len(self.layers()),
                },
            }
        finally:
            if locked:
                self.vnc("unlocking guest during lock test cleanup", "type", SSH_PASSWORD, "key", "enter")
                self.wait_until(
                    "guest unlocked cleanup",
                    lambda: not self.lockscreen_visible(),
                    timeout=30,
                )

    def test_power_confirmation_cancel(self) -> dict[str, object]:
        self.open_quick_settings()
        try:
            power = self.accessibility(
                "finding Power options in Quick Settings",
                "find", "--description-match", "--name", "Power options", "--role", "button",
            )
            self.click_accessible_node(power, "opening Power options")
            self.click_named("opening reversible reboot confirmation", "Reboot", role="button")
            confirmation = self.wait_until(
                "reboot confirmation prompt",
                lambda: self.find_accessible_node("Confirm Reboot?", role="button"),
                timeout=5,
            )
            self.capture("power-reboot-confirmation")
            reverted = self.wait_until(
                "reboot confirmation cancellation by expiry",
                lambda: self.find_accessible_node("Reboot", role="button"),
                timeout=6,
                interval=0.15,
            )
            if not self.user_service_active("verifying guest remains powered after cancelled confirmation"):
                raise RuntimeError("Shade stopped after cancelling the power confirmation")
            return {
                "ui": "Opened the Reboot confirmation label and allowed its timeout to cancel it; no action was confirmed.",
                "guest": {
                    "confirmation_control": confirmation,
                    "cancelled_control": reverted,
                    "shade_service_active": True,
                    "actual_power_action": False,
                },
            }
        finally:
            self.vnc("closing power menu after cancellation", "key", "esc")
            self.close_quick_settings()
    def test_capture(self) -> dict[str, object]:
        before = len(self.layers())
        self.vnc("open capture overlay with Print", "key", "sysrq", "pause", "1")
        self.capture("capture-overlay-open")
        overlay = len(self.layers())
        if overlay <= before:
            raise RuntimeError("Print did not open the screenshot overlay layer")
        self.vnc("cancel capture overlay with Escape", "key", "esc", "pause", "1")
        if len(self.layers()) != before:
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
        return {"ui": "VNC Print opened and Escape cancelled the overlay; Super+Shift+S took a screenshot", "guest": files, "layers": f"{before} -> {overlay} -> {len(self.layers())}"}

    def test_notifications_dnd(self) -> dict[str, object]:
        before_state = None
        self.desktop("sending synthetic notification", "notify-send --app-name=ShadeWorkflowTest 'Shade workflow smoke' 'Synthetic guest-only notification'")
        self.vnc("open Quick Settings notification list", "keydown", "super", "key", "n", "keyup", "super", "pause", "2")
        try:
            quicksettings = any(350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700 for layer in self.layers())
            if not quicksettings:
                self.vnc("retry opening Quick Settings notification list", "keydown", "super", "key", "n", "keyup", "super", "pause", "2")
                quicksettings = any(350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700 for layer in self.layers())
            if not quicksettings:
                raise RuntimeError("Super+N did not open Quick Settings for the notification scenario")
            self.capture("notification-center")
            self.save_accessibility_tree("notification-center")
            notification = self.accessibility("finding synthetic notification", "find", "--max-depth", "16", "--max-nodes", "2000", "--name", "Shade workflow smoke")
            try:
                dnd = self.accessibility("finding Do Not Disturb control", "find", "--max-depth", "16", "--max-nodes", "2000", "--include-state", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
            except Unsupported as exc:
                raise Unsupported(f"Synthetic notification is visible, but the Do Not Disturb control is not accessible by its tooltip/name: {exc}")
            before_state = dnd["state_words"]
            self.accessibility("toggling Do Not Disturb", "click", "--max-depth", "16", "--max-nodes", "2000", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
            after = self.accessibility("verifying Do Not Disturb state", "find", "--max-depth", "16", "--max-nodes", "2000", "--include-state", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
            if before_state == after["state_words"]:
                raise Unsupported("Do Not Disturb click did not change its exposed AT-SPI state words")
            self.accessibility("restoring Do Not Disturb state", "click", "--max-depth", "16", "--max-nodes", "2000", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
            restored = self.accessibility("verifying restored Do Not Disturb state", "find", "--max-depth", "16", "--max-nodes", "2000", "--include-state", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
            if restored["state_words"] != before_state:
                raise RuntimeError("Restoring Do Not Disturb did not recover its initial exposed state")
            return {"ui": "synthetic notification appeared in Quick Settings; DND toggled and returned to its initial state", "accessibility": {"notification": notification, "dnd_before": dnd, "dnd_after": after, "dnd_restored": restored}}
        finally:
            try:
                panel_open = any(350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700 for layer in self.layers())
                if before_state is not None and panel_open:
                    current = self.accessibility("checking Do Not Disturb before cleanup", "find", "--max-depth", "16", "--max-nodes", "2000", "--include-state", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
                    if current["state_words"] != before_state:
                        self.accessibility("restoring Do Not Disturb after scenario", "click", "--max-depth", "16", "--max-nodes", "2000", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
                        restored = self.accessibility("verifying Do Not Disturb cleanup", "find", "--max-depth", "16", "--max-nodes", "2000", "--include-state", "--description-match", "--name", "Do Not Disturb", "--role", "toggle button")
                        if restored["state_words"] != before_state:
                            raise RuntimeError("Do Not Disturb cleanup did not restore its original exposed state")
            finally:
                if any(350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700 for layer in self.layers()):
                    self.vnc("close Quick Settings after notification test", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")

    def test_notification_history(self) -> dict[str, object]:
        history_view_open = False
        summary = f"Shade history smoke {time.time_ns()}"
        self.desktop(
            "sending synthetic notification for history",
            "notify-send --expire-time=1200 --app-name=ShadeWorkflowTest "
            + shlex.quote(summary)
            + " 'Guest-only notification history check'",
        )
        self.vnc("open Quick Settings for notification history", "keydown", "super", "key", "n", "keyup", "super", "pause", "2")
        try:
            if not any(350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700 for layer in self.layers()):
                raise RuntimeError("Quick Settings did not open for notification history")

            self.save_accessibility_tree("notification-history")
            history_button = self.accessibility(
                "finding notification history control",
                "find",
                "--max-depth", "16",
                "--max-nodes", "2000",
                "--description-match",
                "--name", "View history",
                "--role", "button",
            )
            self.accessibility(
                "opening notification history",
                "click",
                "--max-depth", "16",
                "--max-nodes", "2000",
                "--description-match",
                "--name", "View history",
                "--role", "button",
            )
            history_view_open = True
            self.save_accessibility_tree("notification-history-open")
            entry = self.accessibility(
                "finding unique notification in history",
                "find",
                "--max-depth", "16",
                "--max-nodes", "2000",
                "--name", summary,
                "--role", "list item",
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
                "ui": "unique synthetic notification appeared in the History view",
                "accessibility": {"history_button": history_button, "entry": entry},
                "guest": json.loads(persisted.stdout),
                "summary": summary,
            }
        finally:
            try:
                if history_view_open:
                    self.accessibility(
                        "restoring active notification view",
                        "click",
                        "--max-depth", "16",
                        "--max-nodes", "2000",
                        "--description-match",
                        "--name", "Back to notifications",
                        "--role", "button",
                    )
            finally:
                if any(350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700 for layer in self.layers()):
                    self.vnc("close Quick Settings after notification history", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")

    def test_visual_audit(self) -> dict[str, object]:
        """Record one real UI journey; keep behavior findings separate from capture failures."""
        events: list[dict[str, object]] = []
        findings: list[str] = []
        screenshots: dict[str, str] = {}
        timeline = self.artifacts / "visual-audit-events.json"
        guest_video = "/tmp/shade-visual-audit.mp4"
        unit = "shade-visual-audit.service"
        video = self.artifacts / "visual-audit.mp4"
        before = {tuple(layer.get(key) for key in ("x", "y", "w", "h")) for layer in self.layers()}
        screenshots["baseline"] = str(self.capture("visual-baseline"))
        self.desktop("enabling guest animations for temporal audit", "hyprctl keyword animations:enabled true")
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
                    value = None
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
            added = [layer for layer in self.layers()
                     if tuple(layer.get(key) for key in ("x", "y", "w", "h")) not in before
                     and 350 <= int(layer.get("w", 0)) < 600
                     and int(layer.get("h", 0)) >= 700]
            panel = added[0] if len(added) == 1 else None
            if panel is None:
                findings.append(f"Quick Settings panel not uniquely visible: {added}")
            else:
                initial = observe("read initial Wi-Fi state", lambda: self.guest(
                    "reading Wi-Fi radio before visual audit", "nmcli radio wifi"
                ).stdout.strip())
                if initial == "enabled":
                    observe("toggle Wi-Fi off", lambda: self.accessibility(
                        "turning Wi-Fi off during recording", "click", "--max-depth", "16",
                        "--max-nodes", "2000", "--name", "WiFi", "--role", "button",
                    ))
                    observe("Wi-Fi disabled effect", lambda: radio("disabled"))
                elif initial != "disabled":
                    findings.append(f"Initial Wi-Fi state not usable for a toggle journey: {initial!r}")
                if initial in ("enabled", "disabled"):
                    observe("toggle Wi-Fi on", lambda: self.accessibility(
                        "turning Wi-Fi on during recording", "click", "--max-depth", "16",
                        "--max-nodes", "2000", "--name", "WiFi Off", "--role", "button",
                    ))
                    observe("Wi-Fi enabled effect", lambda: radio("enabled"))
                screenshots["wifi"] = str(self.capture("visual-wifi"))

            observe("clear previous notifications", lambda: self.accessibility(
                "clearing earlier guest-only notifications",
                "click",
                "--max-depth", "16",
                "--max-nodes", "2000",
                "--description-match",
                "--name", "Clear all notifications",
                "--role", "button",
            ))
            observe("send notification", lambda: self.desktop(
                "sending synthetic notification during recording",
                "notify-send --app-name=ShadeWorkflowTest 'Shade visual audit' 'Guest-only temporal feedback'",
            ))
            screenshots["notification"] = str(self.capture("visual-notification"))
            self.save_accessibility_tree("visual-notification")
            observe("notification accessible", lambda: self.accessibility(
                "finding audit notification", "find", "--max-depth", "16",
                "--max-nodes", "2000", "--name", "Shade visual audit",
                "--role", "label",
            ))
            time.sleep(1)
            screenshots["notification-later"] = str(self.capture("visual-notification-later"))
            # The single-monitor test fixture renders the synthetic card at a stable left-panel location.
            # Its close button is unnamed in AT-SPI, so click only after the exact panel geometry check.
            if panel is not None and tuple(int(panel[key]) for key in ("x", "y", "w", "h")) == (78, 12, 444, 776):
                observe("dismiss notification", lambda: self.vnc(
                    "clicking notification close in controlled guest fixture",
                    "mousemove", "441", "596", "click", "1", "mousemove", "640", "400", "pause", "0.5",
                ))
                screenshots["dismissed"] = str(self.capture("visual-notification-dismissed"))
                def notification_removed() -> dict[str, float]:
                    coverage = {}
                    for state in ("notification", "dismissed"):
                        sample = self.local(
                            f"measuring notification title pixels {state}",
                            ["magick", screenshots[state], "-crop", "250x32+118+626", "+repage",
                             "-colorspace", "Gray", "-threshold", "50%", "-negate",
                             "-format", "%[fx:mean]", "info:"],
                        )
                        coverage[state] = float(sample.stdout)
                    if coverage["notification"] < 0.01 or coverage["dismissed"] > 0.001:
                        raise RuntimeError(f"Notification title did not clear from the light-theme fixture: {coverage}")
                    return coverage

                observe("notification removed visibly", notification_removed)
            else:
                findings.append("Notification dismissal needs the controlled left-panel fixture geometry")
            observe("close Quick Settings", lambda: self.vnc(
                "closing Quick Settings during recording",
                "keydown", "super", "key", "n", "keyup", "super", "pause", "0.5",
            ))
            screenshots["closed"] = str(self.capture("visual-closed"))
            if panel is not None:
                geometry = tuple(panel.get(key) for key in ("x", "y", "w", "h"))
                if geometry in {tuple(layer.get(key) for key in ("x", "y", "w", "h")) for layer in self.layers()}:
                    findings.append("Quick Settings remained visible after the close action")
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
            if (x, y, w, h) == (78, 12, 444, 776):
                evidence["wifi_tile"] = render_evidence(
                    video, (94, 102, 194, 44), self.artifacts / "visual-wifi-tile",
                    label="wifi-tile", sample_times=sample_times,
                )
                evidence["notification_card"] = render_evidence(
                    video, (94, 570, 388, 85), self.artifacts / "visual-notification-card",
                    label="notification-card", sample_times=sample_times,
                )
        report.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if findings:
            raise RuntimeError(f"{len(findings)} visual journey finding(s); see {report}")
        return evidence

    def finish(self) -> int:
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
    modes = sys.argv[1:]
    if modes not in ([], ["--visual-audit"], ["--full-suite"]):
        raise SystemExit("Usage: scripts/vm-workflow-test.py [--visual-audit | --full-suite]")
    visual_audit = modes == ["--visual-audit"]
    full_suite = modes == ["--full-suite"]
    test = WorkflowTest()
    shell_scenarios = (
        ("launcher", test.test_launcher),
        ("quicksettings", test.test_quicksettings),
        ("settings-bar-position", test.test_settings_position),
        ("wifi", test.test_wifi),
        ("capture", test.test_capture),
        ("notifications-dnd", test.test_notifications_dnd),
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
    unsupported_coverage = (
        ("host-device-io", "Physical host USB, Wi-Fi, Bluetooth, audio, microphone, and backlight devices are not passed through; tests use guest-local virtual fixtures."),
        ("biometric-auth", "Physical fingerprint sensors, enrollment, biometric-backed PAM, and real biometric authentication are excluded; only the isolated guest protocol/client mock is exercised."),
        ("power-actions", "Real suspend, logout, reboot, and power-off actions are excluded; only opening and cancelling the guest confirmation UI is exercised."),
    ) if full_suite else ()
    try:
        test.start()
        test.scenario("greeter-login", test.test_greeter)
        if test.results[-1]["status"] != "PASS":
            reason = "Shell scenarios require a successful greeter login; prerequisite did not pass"
            for name, _callback in shell_scenarios:
                test.record_result(name, "UNSUPPORTED", reason, 0.0)
        else:
            for name, callback in shell_scenarios:
                test.scenario(name, callback)
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
