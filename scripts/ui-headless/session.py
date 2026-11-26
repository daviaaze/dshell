"""Short-lived Hyprland sessions; every subprocess targets a private runtime."""
import ast
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import threading
import time

from core import (OUTPUT, SAFE_ACTIONS, capture_scale, find_layer, hyprland_config, layer_assertions,
                  layer_region, logical_size, owns_environment, read_png)

DOMAIN = "com.caioasmuniz.shade_shell"
OBJECT = "/com/caioasmuniz/shade_shell"


def owned_processes(root):
    for path in Path("/proc").glob("[0-9]*/environ"):
        try:
            data = path.read_bytes()
            if owns_environment(data, root):
                yield int(path.parent.name), dict(item.split(b"=", 1) for item in data.split(b"\0") if b"=" in item)
        except OSError:
            continue


def kill_owned(root):
    """Never kill by process name, process group or an inherited real-session PID."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid, _ in list(owned_processes(root)):
            try:
                # Recheck immediately before signalling, including possible PID reuse.
                if owns_environment(Path(f"/proc/{pid}/environ").read_bytes(), root):
                    os.kill(pid, sig)
            except OSError:
                pass
        time.sleep(0.2)
    return [pid for pid, _ in owned_processes(root)]


def atspi_launcher():
    direct = shutil.which("at-spi-bus-launcher")
    if direct:
        return direct
    for directory in os.environ.get("XDG_DATA_DIRS", "").split(":"):
        if directory:
            candidate = Path(directory).parent / "libexec/at-spi-bus-launcher"
            if candidate.is_file():
                return str(candidate)
    return None


def parse_variant(value):
    # GetAddress/GetChildren/Cache.GetItems contain tuples and arrays, not code.
    value = re.sub(r"""('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(?:\b(?:objectpath|uint32|int32|uint64|int64)|@[a-zA-Z0-9(){}]+)\s+""",
                   lambda match: match.group(1) or "", value)
    return ast.literal_eval(value)


class Session:
    def __init__(self, root, output, size, scale, cancel, timeout=165, ready_timeout=90, wayland_debug=False):
        self.root, self.output = Path(root), Path(output)
        self.runtime = self.root / "r"
        self.size, self.scale, self.cancel = size, scale, cancel
        self.timeout, self.ready_timeout = timeout, ready_timeout
        self.wayland_debug = wayland_debug
        self.process = self.timer = None
        self.started = None
        self.bus_address = self.a11y_address = None
        self.cleanup_lock = threading.Lock()
        self.env = os.environ.copy()
        for key in ("WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "AT_SPI_BUS_ADDRESS", "NO_AT_BRIDGE", "LD_PRELOAD"):
            self.env.pop(key, None)
        self.env.update(XDG_RUNTIME_DIR=str(self.runtime), AQ_DRM_DEVICES="/dev/dri/card1",
                        AQ_NO_KMS_REQUIREMENT="1", LIBSEAT_BACKEND="noop", XDG_SESSION_TYPE="wayland",
                        HYPRLAND_NO_CRASHREPORTER="1", HYPRLAND_NO_SD_NOTIFY="1", GSETTINGS_BACKEND="memory",
                        GTK_A11Y="atspi", TMPDIR=str(self.root),
                        XDG_CONFIG_HOME=str(self.root / "config"), XDG_STATE_HOME=str(self.root / "state"),
                        XDG_CACHE_HOME=str(self.root / "cache"), XDG_DATA_HOME=str(self.root / "data"))

    def check_deadline(self):
        if self.cancel.is_set():
            raise InterruptedError("run cancelled")
        if self.started is not None and time.monotonic() - self.started >= self.timeout:
            raise TimeoutError(f"session exceeded its {self.timeout}s safety deadline")

    def command(self, *args, timeout=6, bus_address=None):
        self.check_deadline()
        # Refuse a command if discovery has not found this instance's sockets.
        if args[0] in ("hyprctl", "grim", "wtype", "wlrctl") and not self.env.get("HYPRLAND_INSTANCE_SIGNATURE"):
            raise RuntimeError("isolated compositor has not been discovered")
        environment = self.env if bus_address is None else {**self.env, "DBUS_SESSION_BUS_ADDRESS": bus_address}
        result = subprocess.run(args, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=min(timeout, max(.1, self.timeout - (time.monotonic() - self.started))))
        if result.returncode:
            raise RuntimeError(f"{' '.join(map(str, args))}: exit {result.returncode}: {result.stderr.strip() or result.stdout.strip()}")
        return result.stdout

    def wait(self, predicate, description, timeout=8):
        end, last_error = time.monotonic() + timeout, None
        while time.monotonic() < end:
            self.check_deadline()
            if self.process is not None and self.process.poll() is not None:
                raise RuntimeError(f"Hyprland exited {self.process.returncode}; see {self.output / 'hyprland.log'}")
            try:
                result = predicate()
                if result:
                    return result
            except (RuntimeError, subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError) as error:
                last_error = str(error)
            self.cancel.wait(.15)
        raise TimeoutError(f"timed out waiting for {description}" + (f": {last_error}" if last_error else ""))

    def discover(self):
        for path in (self.runtime / "hypr").glob("*"):
            if (path / ".socket.sock").is_socket():
                self.env["HYPRLAND_INSTANCE_SIGNATURE"] = path.name
        for path in self.runtime.glob("wayland-*"):
            if path.is_socket():
                self.env["WAYLAND_DISPLAY"] = path.name
        for pid, environment in owned_processes(self.root):
            try:
                if "Hyprland" in Path(f"/proc/{pid}/comm").read_text():
                    bus = environment.get(b"DBUS_SESSION_BUS_ADDRESS")
                    if bus:
                        # Deliberately obtain this from the Hyprland process, never the host bus.
                        self.bus_address = bus.decode()
                        self.env["DBUS_SESSION_BUS_ADDRESS"] = self.bus_address
            except OSError:
                pass
        return self.bus_address and self.env.get("WAYLAND_DISPLAY") and self.env.get("HYPRLAND_INSTANCE_SIGNATURE")

    def start(self, repo):
        # sockaddr_un.sun_path is 108 bytes, including the terminating NUL.
        # Hyprland appends /hypr/<62-byte signature>/.socket2.sock.
        if len(os.fsencode(self.runtime)) + 6 + 64 + 14 >= 108:
            raise ValueError(f"private runtime path is too long for Hyprland IPC: {self.runtime}")
        self.root.mkdir(mode=0o700, parents=True)
        self.runtime.mkdir(mode=0o700)
        self.output.mkdir(parents=True, exist_ok=True)
        for name in ("config", "state", "cache", "data"):
            (self.root / name).mkdir()
        launcher = atspi_launcher()
        if not launcher:
            raise RuntimeError("at-spi-bus-launcher missing; run inside nix develop")
        shell = self.root / "shell.sh"
        preload = shlex.quote(os.environ.get("LD_PRELOAD", ""))
        # Resolve the instance again in the child; nix/launchers must not supply a stale signature.
        shell.write_text(f'''#!/usr/bin/env bash
set -eu
exec >{shlex.quote(str(self.output / 'shell.log'))} 2>&1
cd {shlex.quote(str(repo))}
export GSETTINGS_BACKEND=memory
export XDG_RUNTIME_DIR={shlex.quote(str(self.runtime))}
for socket in "$XDG_RUNTIME_DIR"/hypr/*/.socket2.sock; do
    if test -S "$socket"; then
        signature="${{socket%/.socket2.sock}}"
        export HYPRLAND_INSTANCE_SIGNATURE="${{signature##*/}}"
    fi
done
export LD_PRELOAD={preload}
{('export WAYLAND_DEBUG=1' if self.wayland_debug else 'unset WAYLAND_DEBUG')}
{shlex.quote(launcher)} --launch-immediately >{shlex.quote(str(self.output / 'a11y.log'))} 2>&1 &
{shlex.quote(str(Path(launcher).with_name('at-spi2-registryd')))} >{shlex.quote(str(self.output / 'a11y-registry.log'))} 2>&1 &
wtype -s {int(self.timeout * 1000)} >{shlex.quote(str(self.output / 'input.log'))} 2>&1 &
trap 'printf "%s" "$?" >{shlex.quote(str(self.runtime / 'shell-status'))}' EXIT
bash scripts/dev.sh
''')
        config = self.root / "hypr.lua"
        config.write_text(hyprland_config(self.size, self.scale, shell))
        shutil.copyfile(config, self.output / "hypr.lua")
        self.started = time.monotonic()
        with (self.output / "hyprland.log").open("w") as log:
            self.process = subprocess.Popen(
                ["unshare", "-Urm", "bash", "-eu", "-c",
                 'mount -t tmpfs tmpfs /dev/input; exec dbus-run-session -- Hyprland -c "$1" --i-am-really-stupid',
                 "shade-ui-headless", str(config)], env=self.env, stdout=log, stderr=subprocess.STDOUT)
        self.timer = threading.Timer(self.timeout, self.cleanup)
        self.timer.daemon = True
        self.timer.start()
        self.wait(self.discover, "private Hyprland sockets and session bus", timeout=min(25, self.ready_timeout))
        def bar_ready():
            status = self.runtime / "shell-status"
            if status.exists():
                raise ChildProcessError(f"shade-shell exited {status.read_text()}; see {self.output / 'shell.log'}")
            return find_layer(self.layers(), "shade-bar")
        self.wait(bar_ready, "shade-bar layer (real scripts/dev.sh)", timeout=self.ready_timeout)
        monitors = json.loads(self.command("hyprctl", "monitors", "-j"))
        if len(monitors) != 1 or monitors[0]["name"] != OUTPUT:
            raise RuntimeError(f"unsafe/unexpected outputs in private session: {[m['name'] for m in monitors]}")
        self.monitor = monitors[0]
        self.capture_scale = capture_scale(self.monitor)
        if (self.monitor["width"], self.monitor["height"], self.monitor["scale"]) != (*self.size, self.scale):
            raise RuntimeError(f"compositor did not apply requested size/scale: {self.monitor}")
        self.command("hyprctl", "cursorpos", "-j")
        def keyboard_ready():
            devices = self.command("hyprctl", "devices")
            return devices if "wtype" in devices else None
        self.keyboard_devices = self.wait(keyboard_ready, "persistent virtual keyboard on private seat", timeout=3)
        (self.output / "devices.txt").write_text(self.keyboard_devices)
        self.a11y_error = None
        try:
            self.init_accessibility()
        except (OSError, RuntimeError, ValueError, SyntaxError, subprocess.SubprocessError) as error:
            self.a11y_address = None
            self.a11y_error = str(error)

    def layers(self):
        return json.loads(self.command("hyprctl", "layers", "-j"))

    def wait_layer(self, namespace, present=True):
        return self.wait(lambda: (layer if present else not layer)
                         if (layer := find_layer(self.layers(), namespace)) is not None else not present,
                         f"{namespace} {'mapped' if present else 'closed'}")

    def action(self, name):
        if name not in SAFE_ACTIONS:
            raise ValueError(f"refusing non-panel action: {name}")
        return self.command("gdbus", "call", "--session", "--dest", DOMAIN, "--object-path", OBJECT,
                            "--method", "org.gtk.Actions.Activate", name, "[]", "{}")

    def key(self, name):
        aliases = {"esc": "Escape", "ctrl": "ctrl", "alt": "alt", "shift": "shift", "super": "logo"}
        parts = name.split("+")
        modifiers = [aliases.get(part.lower(), part.lower()) for part in parts[:-1]]
        args = ["wtype"]
        for modifier in modifiers:
            if modifier not in ("ctrl", "alt", "shift", "logo"):
                raise ValueError(f"unsupported modifier: {modifier}")
            args += ["-M", modifier]
        args += ["-k", aliases.get(parts[-1].lower(), parts[-1])]
        for modifier in reversed(modifiers):
            args += ["-m", modifier]
        return self.command(*args)

    def type(self, text):
        return self.command("wtype", "-d", "30", "--", text)

    def click(self, x, y):
        width, height = logical_size(self.monitor)
        if not (0 <= x < width and 0 <= y < height):
            raise ValueError(f"click outside logical monitor: {(x, y)}")
        position = json.loads(self.command("hyprctl", "cursorpos", "-j"))
        self.command("wlrctl", "pointer", "move", str(x - position["x"]), str(y - position["y"]))
        self.command("wlrctl", "pointer", "click")
        actual = json.loads(self.command("hyprctl", "cursorpos", "-j"))
        if abs(actual["x"] - x) > 2 or abs(actual["y"] - y) > 2:
            raise RuntimeError(f"virtual pointer missed target: expected {(x, y)}, got {actual}")

    def bus_call(self, address, destination, path, method, *args):
        if not address:
            raise RuntimeError(f"private accessibility bus unavailable: {getattr(self, 'a11y_error', None)}")
        return self.command("gdbus", "call", "--session", "--dest", destination,
                            "--object-path", path, "--method", method, "--", *map(str, args), bus_address=address)

    def init_accessibility(self):
        def get_address():
            result = self.bus_call(self.bus_address, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus.GetAddress")
            return parse_variant(result)[0]
        self.a11y_address = self.wait(get_address, "private AT-SPI bus", timeout=6)
        if str(self.runtime) not in self.a11y_address:
            raise RuntimeError(f"AT-SPI bus escaped private runtime: {self.a11y_address}")
        self.bus_call(self.a11y_address, "org.a11y.atspi.Registry", "/org/a11y/atspi/accessible/root",
                      "org.a11y.atspi.Accessible.GetChildren")

    def accessibility_snapshot(self):
        root = "/org/a11y/atspi/accessible/root"
        children = parse_variant(self.bus_call(self.a11y_address, "org.a11y.atspi.Registry", root,
                                               "org.a11y.atspi.Accessible.GetChildren"))[0]
        applications = []
        for destination, app_root in children:
            def cache():
                return parse_variant(self.bus_call(self.a11y_address, destination,
                                     "/org/a11y/atspi/cache", "org.a11y.atspi.Cache.GetItems"))[0]
            # GTK exports descendants lazily: Cache.GetItems alone is NOT a tree.
            pending = [app_root] + [item[0][1] for item in cache()]
            visited = set()
            truncated = False
            while pending:
                path = pending.pop()
                if path in visited or path.endswith("/null"):
                    continue
                if len(visited) >= 2000:
                    truncated = True
                    break
                visited.add(path)
                refs = parse_variant(self.bus_call(self.a11y_address, destination, path,
                                                   "org.a11y.atspi.Accessible.GetChildren"))[0]
                pending.extend(child_path for child_bus, child_path in refs if child_bus == destination)
            nodes = []
            for item in cache():
                reference, _, parent, _, _, interfaces, name, role, description, *_ = item
                node = {"path": reference[1], "parent": parent[1], "name": name, "role": role,
                        "description": description, "interfaces": interfaces}
                if "org.a11y.atspi.Text" in interfaces:
                    text = self.bus_call(self.a11y_address, destination, reference[1],
                                         "org.a11y.atspi.Text.GetText", "0", "-1")
                    node["text"] = parse_variant(text)[0]
                nodes.append(node)
            applications.append({"bus": destination, "nodes": nodes, "truncated": truncated})
        return {"applications": applications}

    def capture(self, name):
        path = self.output / f"{name}.png"
        # Level 0 also disables PNG filters in grim, avoiding Python Paeth
        # reconstruction on every full-resolution frame in parallel workers.
        self.command("grim", "-l", "0", "-s", str(self.capture_scale), "-o", OUTPUT, str(path))
        return path, read_png(path)

    def capture_baseline(self, name):
        previous, unchanged_since = None, None
        deadline = time.monotonic() + 8
        thumbnail_scale = self.scale / 8
        path = self.runtime / "settle.png"
        reserved = self.monitor.get("reserved", [0, 0, 0, 0])
        left, top, right, bottom = (round(value * thumbnail_scale) for value in reserved)
        while time.monotonic() < deadline:
            self.command("grim", "-l", "0", "-s", f"{thumbnail_scale:g}", "-o", OUTPUT, str(path))
            image = read_png(path)
            # Ignore the live bar; settle tiny frames, then decode only one
            # full baseline. Full PNG reconstruction dominated parallel boots.
            region = (left + 2, top + 2, image.width - left - right - 4, image.height - top - bottom - 4)
            if previous is not None and image.changed_pixels(previous, region, tolerance=3) == 0:
                unchanged_since = unchanged_since or time.monotonic()
                if time.monotonic() - unchanged_since >= .5:
                    return self.capture(f"baselines/{name}")[1]
            else:
                unchanged_since = None
            previous = image
            self.cancel.wait(.15)
        raise TimeoutError("wallpaper/background did not settle before opening the panel")

    def capture_panel(self, name, namespace, baseline):
        end, last = time.monotonic() + 7, None
        while time.monotonic() < end:
            self.check_deadline()
            data = self.layers()
            layer = find_layer(data, namespace)
            assertions = layer_assertions(layer, self.monitor)
            path, image = self.capture(name)
            assertions["png_dimensions"] = (image.width, image.height) == self.size
            changed, region = 0, None
            if layer:
                region = layer_region(layer, self.monitor)
                assertions["region_not_uniform"] = image.region_nonuniform(region)
                changed = image.changed_pixels(baseline, region, tolerance=3)
                # Nonuniform wallpaper alone is not proof that a layer painted.
                assertions["drawn_pixels"] = changed >= region[2] * region[3] * .8
            else:
                assertions.update(region_not_uniform=False, drawn_pixels=False)
            last = {"path": str(path), "layer": layer, "layers": data, "assertions": assertions,
                    "physical_region": region, "changed_pixels": changed, "png_size": [image.width, image.height]}
            if all(assertions.values()):
                return last
            # Geometry overflow cannot be repaired by waiting; retain the failed capture.
            if layer and not assertions["inside_monitor"]:
                break
            self.cancel.wait(.2)
        return last

    def cleanup(self):
        with self.cleanup_lock:
            if self.timer is not None:
                self.timer.cancel()
            survivors = kill_owned(self.root)
            if self.process is not None:
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    survivors.append(self.process.pid)
            return survivors
