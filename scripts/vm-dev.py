#!/usr/bin/env python3
"""Fast edit/inspect loop against one long-lived disposable vm-vnc guest.

    scripts/vm-dev.py up                 boot once, log in, leave running
    scripts/vm-dev.py sync               nix build only shade-shell, swap it into the guest session
    scripts/vm-dev.py shot NAME          screenshot (guest grim over SSH) -> prints the PNG path
    scripts/vm-dev.py run ACTION|CMD...  activate a Shade action or run a command in the guest session
    scripts/vm-dev.py key KEY...         VNC key presses (vncdo names: super-n, ctrl-a, esc)
    scripts/vm-dev.py click X Y          VNC pointer click
    scripts/vm-dev.py status             state, liveness, lock state
    scripts/vm-dev.py down               power off the guest and remove its disk/state

All guest plumbing (QEMU launch, SSH, VNC, session environment, login readiness)
is inherited from scripts/vm-workflow-test.py's WorkflowTest; this file only adds
persistence and the quick commands. Only `up` needs `nix develop` (it re-enters
it by itself); the other commands use the tool paths recorded in the state file,
so they start in well under a second.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

_spec = importlib.util.spec_from_file_location("vm_workflow_test", SCRIPTS / "vm-workflow-test.py")
wf = importlib.util.module_from_spec(_spec)
sys.modules["vm_workflow_test"] = wf
_spec.loader.exec_module(wf)

DEV_DIR = Path(os.environ.get("DSHELL_VM_DEV_DIR", "/tmp/dshell-vm-dev"))
STATE_FILE = DEV_DIR / "state.json"
SHOTS = DEV_DIR / "shots"
TOOLS = ("sshpass", "ssh", "scp", "vncdo", "magick")
GUEST_DEV = "$HOME/.local/share/shade-dev"
ACTION_NAME = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)+$")


class VmDevError(RuntimeError):
    pass


class Dev(wf.WorkflowTest):
    """WorkflowTest relocated to a persistent directory with a shared SSH connection."""

    def __init__(self) -> None:
        super().__init__()
        shutil.rmtree(self.artifacts, ignore_errors=True)
        shutil.rmtree(self.state, ignore_errors=True)
        self.artifacts = DEV_DIR / "artifacts"
        self.state = DEV_DIR / "vm"
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self.state.mkdir(parents=True, exist_ok=True)
        self.monitor = self.state / "qemu-monitor.sock"
        self.build_log = self.artifacts / "build.log"
        self.qemu_log = self.artifacts / "qemu.log"
        self.command_log = self.artifacts / "commands.log"
        self.review_root = self.artifacts / "ui-review"
        self.review_directory = self.review_root
        self.ssh_control = DEV_DIR / "ssh.sock"

    def ssh_argv(self) -> list[str]:
        # One authenticated master connection; later calls skip the SSH handshake.
        argv = super().ssh_argv()
        at = argv.index("ssh") + 1
        return argv[:at] + [
            "-o", "ControlMaster=auto", "-o", f"ControlPath={self.ssh_control}",
            "-o", "ControlPersist=30m",
        ] + argv[at:]

    def locked(self) -> bool:
        """Compositor lock authority; refuses to guess when it cannot be read."""
        result = self.desktop("reading compositor lock authority", "hyprctl -j locked", timeout=8, check=False)
        try:
            locked = json.loads(result.stdout)["locked"]
        except (ValueError, KeyError, TypeError) as exc:
            raise VmDevError(
                "cannot determine whether the guest session is locked "
                f"(no logged-in compositor?): {(result.stderr or result.stdout).strip()[:200]}"
            ) from exc
        if result.returncode != 0 or not isinstance(locked, bool):
            raise VmDevError(
                "cannot determine whether the guest session is locked "
                f"(hyprctl exit {result.returncode}): {(result.stderr or result.stdout).strip()[:200]}"
            )
        return locked


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except FileNotFoundError:
        raise VmDevError(f"no VM is up ({STATE_FILE} missing); run `scripts/vm-dev.py up`") from None


def pid_is_vm(state: dict) -> bool:
    try:
        cmdline = Path(f"/proc/{state['pid']}/cmdline").read_bytes().decode(errors="replace")
    except OSError:
        return False
    return state["monitor"] in cmdline


def attach() -> tuple[Dev, dict]:
    state = load_state()
    if not pid_is_vm(state):
        raise VmDevError(f"VM pid {state['pid']} is gone; run `scripts/vm-dev.py down` then `up`")
    dirs = [str(Path(p).parent) for p in state["tools"].values()]
    os.environ["PATH"] = os.pathsep.join(dirs + [os.environ.get("PATH", "")])
    dev = Dev()
    dev.ssh_port, dev.vnc_port = state["ssh_port"], state["vnc_port"]
    return dev, state


def save_state(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n")
    tmp.replace(STATE_FILE)


def nix_shade_path(dev: Dev) -> str:
    out = dev.local(
        "building shade-shell", ["nix", "build", ".#default", "--no-link", "--print-out-paths"], timeout=3600,
    ).stdout.strip().splitlines()
    if not out:
        raise VmDevError("nix build .#default printed no store path")
    return out[-1]


# --- up -------------------------------------------------------------------


def cmd_up(args) -> None:
    if not os.environ.get("IN_NIX_SHELL"):
        os.execvp("nix", ["nix", "develop", "-c", "python3", str(Path(__file__).resolve()), *sys.argv[1:]])
    if STATE_FILE.exists():
        state = load_state()
        if pid_is_vm(state):
            raise VmDevError(f"VM already up (pid {state['pid']}); use `down` first")
        print("removing stale state from a dead VM", file=sys.stderr)
        STATE_FILE.unlink()
    DEV_DIR.mkdir(parents=True, exist_ok=True)
    SHOTS.mkdir(exist_ok=True)
    tools = {}
    for name in TOOLS:
        path = shutil.which(name)
        if not path:
            raise VmDevError(f"{name} not found in the development shell")
        tools[name] = path

    dev = Dev()
    shutil.rmtree(dev.state, ignore_errors=True)  # fresh disposable disk
    dev.state.mkdir(parents=True)
    dev.ssh_port, dev.vnc_port = dev.free_port(), dev.free_port()
    state = {
        "ssh_port": dev.ssh_port, "vnc_port": dev.vnc_port, "monitor": str(dev.monitor),
        "tools": tools, "pid": None, "shade_path": None, "started_at": time.time(),
    }
    t = time.monotonic()
    try:
        dev.start()  # nix build vm-vnc, launch QEMU, wait SSH + greeter, install AT-SPI helper
    finally:
        if dev.qemu is not None:
            state["pid"] = dev.qemu.pid
            save_state(state)
    print(f"[vm-dev] boot to greeter {time.monotonic() - t:.1f}s", file=sys.stderr)

    t = time.monotonic()
    state["shade_path"] = nix_shade_path(dev)
    save_state(state)
    dev.wait_until(
        "greeter PAM worker",
        lambda: int(dev.guest("greeter PAM worker", "pgrep -c -x greetd", check=False).stdout.strip() or 0) >= 3,
        timeout=30,
    )
    dev.vnc("submit test-account password", "type", wf.SSH_PASSWORD, "key", "enter", "pause", "2")
    dev.wait_shell()
    print(f"[vm-dev] login to shell {time.monotonic() - t:.1f}s", file=sys.stderr)
    print(f"up: pid={state['pid']} ssh=127.0.0.1:{dev.ssh_port} vnc=127.0.0.1:{dev.vnc_port} state={STATE_FILE}")


# --- sync -----------------------------------------------------------------

SWAP_SCRIPT = r"""set -e
d=%(dev)s
for i in $(seq 1 60); do [ -x %(path)s/bin/shade-shell ] && break; sleep 0.25; done
[ -x %(path)s/bin/shade-shell ] || { echo "%(path)s is not visible in the guest store" >&2; exit 3; }
mkdir -p "$d" "$HOME/.config/systemd/user/shade-shell.service.d"
printf %%s %(path)s > "$d/path"
cat > "$d/launch.sh" <<'EOF'
#!/bin/sh
[ -f /etc/set-environment ] && . /etc/set-environment
exec "$(cat "$HOME/.local/share/shade-dev/path")/bin/shade-shell"
EOF
chmod +x "$d/launch.sh"
conf="$HOME/.config/systemd/user/shade-shell.service.d/10-dev.conf"
if [ ! -f "$conf" ]; then
  printf '[Service]\nExecStart=\nExecStart=%%s\n' "$d/launch.sh" > "$conf"
  systemctl --user daemon-reload
fi
systemctl --user restart shade-shell.service
"""


def shell_ready(dev: Dev) -> bool:
    result = dev.desktop(
        "waiting for Shade actions", "gdbus call --session --dest com.caioasmuniz.shade_shell "
        "--object-path /com/caioasmuniz/shade_shell --method org.gtk.Actions.List",
        timeout=8, check=False,
    )
    return result.returncode == 0 and "toggle-quicksettings" in result.stdout


def cmd_sync(args) -> None:
    dev, state = attach()
    if dev.locked():
        raise VmDevError("guest session is locked; unlock it first (restarting shade-shell would kill the lockscreen)")
    t0 = time.monotonic()
    path = nix_shade_path(dev)
    built = time.monotonic()
    print(f"[vm-dev] nix build {built - t0:.1f}s -> {path}", file=sys.stderr)
    if path == state.get("shade_path") and not args.force:
        print("sync: guest already runs this build (use --force to restart anyway)")
        return
    if dev.locked():  # re-check: the build can take a while
        raise VmDevError("guest session became locked during the build; not restarting shade-shell")
    result = dev.desktop(
        "swapping shade-shell build", SWAP_SCRIPT % {"dev": GUEST_DEV, "path": shlex.quote(path)},
        timeout=90, check=False,
    )
    if result.returncode:
        raise VmDevError(f"guest swap failed: {(result.stderr or result.stdout).strip()}")
    dev.wait_until("shade-shell to expose its actions", lambda: shell_ready(dev), timeout=60, interval=0.3)
    state["shade_path"] = path
    save_state(state)
    print(f"[vm-dev] guest restart {time.monotonic() - built:.1f}s", file=sys.stderr)
    print(f"sync: guest now runs {path}")


# --- quick commands -------------------------------------------------------


def cmd_shot(args) -> None:
    dev, _ = attach()
    SHOTS.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9_.-]+", "-", args.name).strip(".-") or "shot"
    path = SHOTS / f"{name}.png"
    if not args.vnc:
        result = dev.desktop("grim screenshot", "grim -l 1 - | base64 -w0", timeout=20, check=False)
        if result.returncode == 0 and result.stdout.strip():
            import base64
            path.write_bytes(base64.b64decode(result.stdout))
            print(path)
            return
        print(f"grim failed ({(result.stderr or 'no output').strip()[:120]}); using VNC", file=sys.stderr)
    dev.vnc("VNC screenshot", "capture", str(path))
    print(path)


def cmd_run(args) -> None:
    dev, state = attach()
    argv = args.command
    if len(argv) == 1 and ACTION_NAME.match(argv[0]):
        dev.activate_shell_action(argv[0])
        print(f"activated {argv[0]}")
        return
    if argv[0] == "shade-shell" and state.get("shade_path"):
        argv = [f"{state['shade_path']}/bin/shade-shell", *argv[1:]]
    result = dev.desktop("guest command", shlex.join(argv), timeout=args.timeout, check=False)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)


def cmd_key(args) -> None:
    dev, _ = attach()
    chain: list[str] = []
    for key in args.keys:
        chain += ["key", key]
    dev.vnc("VNC key", *chain)


def cmd_click(args) -> None:
    dev, _ = attach()
    dev.vnc("VNC click", "move", str(args.x), str(args.y), "click", "1")


def cmd_status(args) -> None:
    try:
        state = load_state()
    except VmDevError as exc:
        print(exc)
        sys.exit(1)
    alive = pid_is_vm(state)
    print(json.dumps({k: v for k, v in state.items() if k != "tools"}, indent=2), f"alive={alive}")
    if alive:
        dev, _ = attach()
        try:
            print(f"locked={dev.locked()}")
        except VmDevError as exc:
            print(f"locked=unknown ({exc})")


# --- down -----------------------------------------------------------------


def cmd_down(args) -> None:
    try:
        state = load_state()
    except VmDevError:
        print("down: nothing to do (no state file)")
        return
    pid = state.get("pid")
    if pid and pid_is_vm(state):
        try:
            with socket.socket(socket.AF_UNIX) as monitor:
                monitor.settimeout(2)
                monitor.connect(state["monitor"])
                monitor.recv(4096)
                monitor.sendall(b"quit\n")  # the disk is disposable; no graceful powerdown needed
        except OSError:
            pass
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and pid_is_vm(state):
            time.sleep(0.2)
        if pid_is_vm(state):
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(pid, sig)
                except ProcessLookupError:
                    break
                time.sleep(2)
                if not pid_is_vm(state):
                    break
    sock = DEV_DIR / "ssh.sock"
    if sock.exists():
        subprocess.run(["ssh", "-O", "exit", "-o", f"ControlPath={sock}", "x"], capture_output=True)
        sock.unlink(missing_ok=True)
    shutil.rmtree(DEV_DIR / "vm", ignore_errors=True)
    STATE_FILE.unlink(missing_ok=True)
    print("down: VM stopped" if not pid_is_vm(state) else "down: VM STILL RUNNING")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("up", help="boot the VM once and log in")
    p = sub.add_parser("sync", help="build shade-shell and restart it in the guest")
    p.add_argument("--force", action="store_true", help="restart even if the build is unchanged")
    p = sub.add_parser("shot", help="screenshot to /tmp/dshell-vm-dev/shots/NAME.png")
    p.add_argument("name")
    p.add_argument("--vnc", action="store_true", help="capture over VNC (works at the greeter/lock screen)")
    p = sub.add_parser("run", help="Shade action name (e.g. toggle-quicksettings) or a guest command")
    p.add_argument("--timeout", type=int, default=30)
    p.add_argument("command", nargs=argparse.REMAINDER)
    p = sub.add_parser("key", help="VNC key presses")
    p.add_argument("keys", nargs="+")
    p = sub.add_parser("click", help="VNC click at X Y")
    p.add_argument("x", type=int)
    p.add_argument("y", type=int)
    sub.add_parser("status")
    sub.add_parser("down", help="stop the VM")
    args = parser.parse_args()
    if args.cmd == "run":
        if args.command[:1] == ["--"]:
            args.command = args.command[1:]
        if not args.command:
            parser.error("run needs an action or command")
    started = time.monotonic()
    try:
        globals()[f"cmd_{args.cmd}"](args)
    except (VmDevError, RuntimeError) as exc:
        print(f"vm-dev {args.cmd}: {exc}", file=sys.stderr)
        return 1
    finally:
        print(f"[vm-dev] {args.cmd} {time.monotonic() - started:.1f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
