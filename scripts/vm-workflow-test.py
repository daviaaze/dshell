#!/usr/bin/env python3
"""Run isolated Shade desktop workflows in the repository's vm-vnc guest."""

from __future__ import annotations

import json
import os
import shlex
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


class WorkflowTest:
    def __init__(self) -> None:
        self.artifacts = Path(tempfile.mkdtemp(prefix="shade-workflow-artifacts."))
        self.state = Path(tempfile.mkdtemp(prefix="shade-workflow-state."))
        self.results: list[dict[str, object]] = []
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

    def record_command(self, label: str, result: subprocess.CompletedProcess[str]) -> None:
        with self.command_log.open("a", encoding="utf-8") as log:
            log.write(f"## {label} (exit {result.returncode})\n")
            log.write(result.stdout)
            if result.stderr:
                log.write(result.stderr)
            if not result.stdout.endswith("\n"):
                log.write("\n")

    def local(self, label: str, command: list[str], *, timeout: int = 120, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        self.record_command(label, result)
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

    def save_accessibility_tree(self, name: str) -> Path:
        tree = self.accessibility(
            f"capturing {name} AT-SPI tree",
            "tree",
            "--max-depth",
            "16",
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

        built = self.local(
            "building vm-vnc",
            ["nix", "build", "--no-link", "--print-out-paths", ".#nixosConfigurations.vm-vnc.config.system.build.vm"],
            timeout=3600,
        )
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
        with self.qemu_log.open("wb") as log:
            self.qemu = subprocess.Popen(
                [str(launcher)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.wait_port(self.vnc_port, BOOT_TIMEOUT, "VNC")
        self.wait_port(self.ssh_port, BOOT_TIMEOUT, "SSH")
        self.wait_guest()
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

    def layers(self) -> list[dict[str, object]]:
        result = self.desktop("reading compositor layers", "hyprctl layers -j")
        try:
            raw = json.loads(result.stdout)
            return [layer for monitor in raw.values() for level in monitor.get("levels", {}).values() for layer in level]
        except (json.JSONDecodeError, AttributeError, TypeError) as exc:
            raise RuntimeError(f"hyprctl layers returned invalid JSON: {exc}")

    def record_result(self, name: str, status: str, detail: object, duration: float) -> None:
        result = {"scenario": name, "status": status, "duration_seconds": round(duration, 2), "evidence": detail}
        self.results.append(result)
        print(f"{status} {name}: {detail}", flush=True)
        with (self.artifacts / "results.json").open("w", encoding="utf-8") as report:
            json.dump({"artifacts": str(self.artifacts), "results": self.results}, report, indent=2, ensure_ascii=False)
            report.write("\n")

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

    def select_bar_position(self, position: str, current_position: str) -> None:
        if current_position == "Left":
            coordinates = {
                "Top": ("647", "160"),
                "Left": ("725", "160"),
                "Right": ("808", "160"),
                "Bottom": ("902", "160"),
            }
        elif current_position == "Bottom":
            coordinates = {
                "Top": ("637", "160"),
                "Left": ("705", "160"),
                "Right": ("779", "160"),
                "Bottom": ("861", "160"),
            }
        else:
            raise RuntimeError(f"VM position click coordinates are not calibrated for {current_position}")
        if position not in coordinates:
            raise RuntimeError(f"Unknown Bar position control: {position}")
        x, y = coordinates[position]
        self.vnc(f"select {position} in Bar settings", "move", x, y, "click", "1", "pause", "2")

    def test_settings_position(self) -> dict[str, object]:
        self.vnc("open Quick Settings to reach Settings", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")
        self.vnc("click visible Open Settings control", "move", "230", "406", "click", "1", "pause", "3")
        settings_home = self.capture("settings-home")
        self.save_accessibility_tree("settings-home")
        self.vnc("select Bar & Dock from Settings navigation", "move", "295", "786", "click", "1", "pause", "1")
        bar_settings = self.capture("settings-bar-position")
        self.save_accessibility_tree("settings-bar-position")
        page = self.accessibility("finding Bar page", "find", "--max-depth", "16", "--max-nodes", "2000", "--name", "Bar & Dock", "--role", "tab panel")
        page_bounds = page.get("bounds")
        if not isinstance(page_bounds, list) or len(page_bounds) != 4 or int(page_bounds[2]) < 400 or int(page_bounds[3]) < 400:
            raise RuntimeError(f"Bar & Dock page is not selected in Settings: {page}")
        before = self.bar_position_from_layers(self.layers())
        if before is None:
            raise RuntimeError("Could not identify the current bar position from compositor geometry")
        changed = "selected Bottom and Left using the visible Bar position segmented control"
        current_position = before
        try:
            self.select_bar_position("Bottom", current_position)
            current_position = "Bottom"
            bottom_layers = self.layers()
            after_bottom = self.bar_position_from_layers(bottom_layers)
            if after_bottom != "Bottom" or after_bottom == before:
                raise RuntimeError(f"Bottom selection did not move the compositor bar: {before} -> {after_bottom}")
            self.select_bar_position("Left", current_position)
            current_position = "Left"
            left_layers = self.layers()
            after_left = self.bar_position_from_layers(left_layers)
            if after_left != "Left":
                raise RuntimeError(f"Left selection did not move the compositor bar to the left edge: got {after_left}")
            left_bar = next(
                (
                    layer
                    for layer in left_layers
                    if int(layer.get("x", -1)) == 4 and int(layer.get("h", 0)) > 400
                ),
                None,
            )
            if left_bar is None:
                raise RuntimeError("Left preference did not produce a full-height bar layer")
            if int(left_bar.get("w", 0)) > 100:
                raise RuntimeError(f"Vertical bar remained too wide with the four-row clock: {left_bar}")
            left_capture = self.capture("bar-left-clock")
        finally:
            try:
                self.select_bar_position(before, current_position)
                restored = self.bar_position_from_layers(self.layers())
            finally:
                self.vnc("close Settings with its visible close button", "move", "1251", "29", "click", "1", "pause", "1")
        if restored != before:
            raise RuntimeError(f"Restoring {before} failed: expected {before}, got {restored}")
        return {"ui": changed, "guest": {"settings_home_screenshot": str(settings_home), "bar_settings_screenshot": str(bar_settings), "before": before, "bottom": after_bottom, "left": after_left, "restored": restored, "left_bar_geometry": left_bar, "left_screenshot": str(left_capture)}, "accessibility": {"page": page}}

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
            if any(350 <= int(layer.get("w", 0)) < 600 and int(layer.get("h", 0)) >= 700 for layer in self.layers()):
                self.vnc("close Quick Settings after notification test", "keydown", "super", "key", "n", "keyup", "super", "pause", "1")

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

            observe("send notification", lambda: self.desktop(
                "sending synthetic notification during recording",
                "notify-send --app-name=ShadeWorkflowTest 'Shade visual audit' 'Guest-only temporal feedback'",
            ))
            screenshots["notification"] = str(self.capture("visual-notification"))
            self.save_accessibility_tree("visual-notification")
            observe("notification accessible", lambda: self.accessibility(
                "finding audit notification", "find", "--max-depth", "16",
                "--max-nodes", "2000", "--name", "Shade visual audit",
            ))
            time.sleep(1)
            screenshots["notification-later"] = str(self.capture("visual-notification-later"))
            # This fixture has one notification; its close button is unnamed in AT-SPI.
            # Use only the observed left-panel geometry, never arbitrary host coordinates.
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
                            ["magick", screenshots[state], "-crop", "250x32+118+579", "+repage",
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


def main() -> int:
    if not os.environ.get("IN_NIX_SHELL"):
        os.execvp("nix", ["nix", "develop", "-c", "python3", str(Path(__file__).resolve()), *sys.argv[1:]])
    if len(sys.argv) > 2 or (len(sys.argv) == 2 and sys.argv[1] != "--visual-audit"):
        raise SystemExit("Usage: scripts/vm-workflow-test.py [--visual-audit]")
    visual_audit = len(sys.argv) == 2
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
    try:
        test.start()
        test.scenario("greeter-login", test.test_greeter)
        if test.results[-1]["status"] != "PASS":
            reason = "Shell scenarios require a successful greeter login; prerequisite did not pass"
            for name, _callback in shell_scenarios:
                test.record_result(name, "UNSUPPORTED", reason, 0.0)
            return test.finish()
        for name, callback in shell_scenarios:
            test.scenario(name, callback)
        return test.finish()
    except Exception as exc:
        print(f"Harness failure: {exc}", file=sys.stderr)
        print(f"Artifacts: {test.artifacts}", file=sys.stderr)
        return 1
    finally:
        test.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
