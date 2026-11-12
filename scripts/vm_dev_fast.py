"""Fast edit/inspect helpers for the persistent dev VM (scripts/vm-dev.py).

* ``fast_sync``   - bundle only the shell gresource on the host (seconds, no
  ``nix build``), push it into the guest and restart only ``shade-shell.service``.
* ``run_scenes``  - run a JSON list of run/key/click/sleep/shot steps in one call.
* ``capture_shot``/``compare_images`` - screenshots with a changed-pixels report.

Nothing here talks to the VM except through the ``dev`` object passed in
(``scripts/vm-dev.py``'s ``Dev``), so the logic stays unit-testable.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = "com.caioasmuniz.shade_shell"
SHELL_NAME = "shade-shell"
SHELL_ENTRY = "apps/shell/src/main.ts"
GNIM_JS = "node_modules/gnim/dist/bin/gnim.js"
FAST_MARKER = "# shade-dev-fast"
ACTION_NAME = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)+$")

# Inputs that only `nix build` can deliver to the guest (store assets, schemas,
# wrapper env, and the pre-login compositor CLI/model). Fast-sync updates only
# the UI bundle; changes to any input here require a full `sync`.
NIX_INPUT_FILES = (
    "flake.nix", "flake.lock", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "apps/shell/src/compositor.ts",
)
NIX_INPUT_DIRS = ("nix", "data", "assets", "packages/services/src/compositor", "packages/compositor-model")



class FastError(RuntimeError):
    pass


def log(message: str) -> None:
    print(f"[vm-dev] {message}", file=sys.stderr)


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip(".-") or "shot"


# --- build tools -----------------------------------------------------------


def resolve_tools(dev_dir: Path, *, run=subprocess.run, which=shutil.which) -> dict[str, str]:
    """Locate node and glib-compile-resources; ask `nix develop` once and cache it."""
    cache = dev_dir / "fast-tools.json"
    try:
        cached = json.loads(cache.read_text())
        if all(Path(cached[k]).exists() for k in ("node", "glib-compile-resources")):
            return cached
    except (OSError, ValueError, KeyError, TypeError):
        pass
    found = {name: which(name) for name in ("node", "glib-compile-resources")}
    missing = [name for name, path in found.items() if not path]
    if missing:
        script = "; ".join(f"command -v {name}" for name in missing)
        result = run(["nix", "develop", "-c", "sh", "-c", script], cwd=ROOT, text=True, capture_output=True, timeout=300)
        lines = [line for line in result.stdout.splitlines() if line.startswith("/")]
        if result.returncode or len(lines) != len(missing):
            raise FastError(f"cannot locate {', '.join(missing)} via `nix develop`: {result.stderr.strip()[-300:]}")
        found.update(zip(missing, lines))
    dev_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(found) + "\n")
    return found  # type: ignore[return-value]


def shell_version(root: Path = ROOT) -> str:
    return json.loads((root / "package.json").read_text())["version"]


def bundle_argv(tools: dict[str, str], base_path: str, outfile: Path, *, version: str, root: Path = ROOT) -> list[str]:
    """The same `gnim bundle` invocation as nix/desktop-shell.nix, pointed at the live store path."""
    defines = {
        "import.meta.name": SHELL_NAME,
        "import.meta.version": version,
        "import.meta.domain": DOMAIN,
        "import.meta.datadir": f"{base_path}/share",
        "import.meta.bindir": f"{base_path}/bin",
    }
    argv = [tools["node"], str(root / GNIM_JS), "bundle", SHELL_ENTRY, "--id", DOMAIN]
    for key, value in defines.items():
        argv += ["-d", f'{key}="{value}"']
    return argv + ["-o", str(outfile)]


def bundle_shell(tools: dict[str, str], base_path: str, outfile: Path, *, run=subprocess.run) -> float:
    outfile.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([str(Path(tools["glib-compile-resources"]).parent), env.get("PATH", "")])
    started = time.monotonic()
    result = run(
        bundle_argv(tools, base_path, outfile, version=shell_version()),
        cwd=ROOT, env=env, text=True, capture_output=True, timeout=300,
    )
    if result.returncode or not outfile.is_file() or outfile.stat().st_size < 1024:
        raise FastError(f"gnim bundle failed (exit {result.returncode}):\n{(result.stderr or result.stdout).strip()[-1500:]}")
    return time.monotonic() - started


# --- what fast-sync cannot deliver -----------------------------------------


def nix_fingerprint(root: Path = ROOT) -> str:
    """Hash of everything the guest only gets through `nix build` (not the gresource)."""
    digest = hashlib.sha256()
    paths: list[Path] = [root / name for name in NIX_INPUT_FILES]
    for directory in NIX_INPUT_DIRS:
        base = root / directory
        if base.is_dir():
            paths += sorted(p for p in base.rglob("*") if p.is_file())
    paths += sorted(p for p in (root / "packages").rglob("*.gschema.ts") if "node_modules" not in p.parts)
    for path in paths:
        if path.is_file():
            digest.update(str(path.relative_to(root)).encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


# --- guest launcher --------------------------------------------------------


def wrapper_env_ops(wrapper: bytes) -> tuple[str, list[tuple[str, ...]]]:
    """Parse makeCWrapper's embedded recipe and return its program and env ops.

    The wrapper comment contains the exact prefix/set flags needed to launch a
    host-bundled gresource with the same runtime environment as the package.
    """
    text = wrapper.decode("utf-8", "replace")
    start = text.find("makeCWrapper '")
    if start < 0:
        raise FastError("bin/shade-shell has no makeCWrapper recipe; cannot rebuild its environment (run `sync`)")
    block: list[str] = []
    for line in text[start:].splitlines():
        if not block or re.match(r"^\s+--", line):
            block.append(line.rstrip().removesuffix("\\"))
        else:
            break
    tokens = shlex.split(" ".join(block))
    program, ops, i = tokens[1], [], 2
    arity = {"--prefix": 3, "--suffix": 3, "--set": 2, "--set-default": 2, "--unset": 1}
    while i < len(tokens):
        flag = tokens[i]
        if flag == "--inherit-argv0":
            i += 1
        elif flag in arity:
            ops.append((flag[2:], *tokens[i + 1:i + 1 + arity[flag]]))
            i += 1 + arity[flag]
        else:
            raise FastError(f"unsupported makeCWrapper flag {flag}; run `sync` instead")
    return program, ops


def render_launch(ops: list[tuple[str, ...]]) -> str:
    q = shlex.quote
    lines = ["#!/bin/sh", FAST_MARKER, "[ -f /etc/set-environment ] && . /etc/set-environment"]
    for op, var, *rest in ops:
        if op == "set":
            lines.append(f"export {var}={q(rest[0])}")
        elif op == "set-default":
            lines.append(f"[ -n \"${{{var}+x}}\" ] || export {var}={q(rest[0])}")
        elif op == "unset":
            lines.append(f"unset {var}")
        elif op == "prefix":
            sep, value = rest
            lines.append(f"export {var}={q(value)}\"${{{var}:+{sep}${var}}}\"")
        elif op == "suffix":
            sep, value = rest
            lines.append(f"export {var}=\"${{{var}:+${var}{sep}}}\"{q(value)}")
    lines.append('exec "$HOME/.local/share/shade-dev/shell-wrapped.js" "$@"')
    return "\n".join(lines) + "\n"


def patch_wrapped_script(script: str, store_gresource: str) -> str:
    """Patch the UI wrapper's GJS entry, not the pre-login compositor launcher."""
    needle = f'Gio.Resource.load("{store_gresource}")'
    if script.count(needle) != 1:
        raise FastError(f"{needle} not found exactly once in .shade-shell-wrapped; run `sync` instead")
    return script.replace(
        needle, 'Gio.Resource.load(imports.gi.GLib.get_home_dir() + "/.local/share/shade-dev/fast.gresource")'
    )

def guest_payload(base_path: str, gresource: Path, sha: str) -> bytes:
    wrapper_path = Path(base_path) / "bin" / ".shade-shell-ui"
    try:
        wrapper = wrapper_path.read_bytes()
        program, ops = wrapper_env_ops(wrapper)
        script = Path(program).read_text()
    except (OSError, FastError) as error:
        raise FastError(f"UI wrapper {wrapper_path} is unavailable; run `sync` instead") from error
    store_gresource = f"{base_path}/share/{DOMAIN}/{SHELL_NAME}.gresource"
    files = {
        "fast.gresource.new": (gresource.read_bytes(), 0o644),
        "shell-wrapped.js.new": (patch_wrapped_script(script, store_gresource).encode(), 0o755),
        "launch.sh.new": (render_launch(ops).encode(), 0o755),
        "fast.sha.new": (f"{sha}:{base_path}\n".encode(), 0o644),
    }
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        for name, (data, mode) in files.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), mode, int(time.time())
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


GUEST_DIR = '"$HOME/.local/share/shade-dev"'

PROBE_SCRIPT = f"""d={GUEST_DIR}
grep -q '{FAST_MARKER}' "$d/launch.sh" 2>/dev/null && cat "$d/fast.sha" 2>/dev/null; true"""

UPLOAD_SCRIPT = f"d={GUEST_DIR}; mkdir -p \"$d\" && tar -x -C \"$d\" -f -"

SWAP_SCRIPT = f"""set -e
d={GUEST_DIR}
for f in fast.gresource shell-wrapped.js launch.sh fast.sha; do mv -f "$d/$f.new" "$d/$f"; done
mkdir -p "$HOME/.config/systemd/user/shade-shell.service.d"
conf="$HOME/.config/systemd/user/shade-shell.service.d/10-dev.conf"
if [ ! -f "$conf" ]; then
  printf '[Service]\\nExecStart=\\nExecStart=%s\\n' "$d/launch.sh" > "$conf"
  systemctl --user daemon-reload
fi
systemctl --user restart shade-shell.service
"""


def upload(dev, payload: bytes) -> None:
    result = subprocess.run(
        dev.ssh_argv() + [UPLOAD_SCRIPT], input=payload, capture_output=True, timeout=60,
    )
    if result.returncode:
        raise FastError(f"uploading to the guest failed: {result.stderr.decode(errors='replace').strip()}")


def fast_sync(dev, state: dict, dev_dir: Path, *, locked, shell_ready, force: bool = False, ignore_nix: bool = False) -> dict:
    """Bundle on the host, swap the gresource in the guest, restart only the shell."""
    base = state.get("shade_path")
    if not base:
        raise FastError("no base build recorded in the VM state; run `scripts/vm-dev.py sync` once first")
    if locked():
        raise FastError("guest session is locked; unlock it first (restarting shade-shell would kill the lockscreen)")
    timings: dict[str, float] = {}

    started = time.monotonic()
    fingerprint = nix_fingerprint()
    fast_state_file = dev_dir / "fast-state.json"
    try:
        recorded = json.loads(fast_state_file.read_text())
    except (OSError, ValueError):
        recorded = {}
    if not ignore_nix and recorded.get("base_path") != base:
        raise FastError(
            "no Nix-input baseline for this guest build; run `scripts/vm-dev.py sync` once before fast-sync"
        )
    if not ignore_nix and recorded.get("nix_inputs") != fingerprint:
        raise FastError(
            "Nix-only inputs changed since the last full sync (flake/nix/, data/, assets/, package files or *.gschema.ts); "
            "fast-sync cannot deliver them - run the appropriate `nix build` and full `sync` "
            "(rebuild/reboot the VM too if a vm-vnc definition changed), or pass `--ignore-nix`"
        )
    timings["fingerprint"] = time.monotonic() - started

    tools = resolve_tools(dev_dir)
    outfile = dev_dir / "fast" / f"{SHELL_NAME}.gresource"
    timings["bundle"] = bundle_shell(tools, base, outfile)
    sha = hashlib.sha256(outfile.read_bytes()).hexdigest()

    probe = dev.guest("probing guest fast state", PROBE_SCRIPT, timeout=15, check=False).stdout.strip()
    if probe == f"{sha}:{base}" and not force:
        fast_state_file.write_text(json.dumps({"base_path": base, "nix_inputs": fingerprint}) + "\n")
        return {"changed": False, "timings": timings, "sha": sha}
    if locked():  # re-check: the host steps above are not instantaneous
        raise FastError("guest session became locked during the bundle; not restarting shade-shell")

    started = time.monotonic()
    upload(dev, guest_payload(base, outfile, sha))
    timings["upload"] = time.monotonic() - started

    started = time.monotonic()
    result = dev.desktop("swapping shade-shell gresource", SWAP_SCRIPT, timeout=90, check=False)
    if result.returncode:
        raise FastError(f"guest swap failed: {(result.stderr or result.stdout).strip()}")
    dev.wait_until("shade-shell to expose its actions", shell_ready, timeout=60, interval=0.25)
    timings["restart"] = time.monotonic() - started
    fast_state_file.write_text(json.dumps({"base_path": base, "nix_inputs": fingerprint}) + "\n")
    return {"changed": True, "timings": timings, "sha": sha}


# --- screenshots -----------------------------------------------------------


def png_size(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise FastError(f"{path} is not a PNG")
    return struct.unpack(">II", header[16:24])


def parse_ae(stderr: str) -> int:
    match = re.match(r"\s*([0-9.]+(?:e[+-]?[0-9]+)?)", stderr)
    if not match:
        raise FastError(f"unexpected `magick compare` output: {stderr.strip()[:200]!r}")
    return int(float(match.group(1)))


def compare_images(magick: str, old: Path, new: Path, diff_png: Path, *, fuzz: float = 1.0, run=subprocess.run) -> dict:
    """Changed-pixel percentage between two PNGs (ImageMagick AE metric, `fuzz` % colour tolerance)."""
    old_size, new_size = png_size(old), png_size(new)
    if old_size != new_size:
        return {"percent": 100.0, "changed": None, "total": new_size[0] * new_size[1], "note": f"size {old_size} -> {new_size}"}
    result = run(
        [magick, "compare", "-metric", "AE", "-fuzz", f"{fuzz}%", str(old), str(new), str(diff_png)],
        text=True, capture_output=True, timeout=30,
    )
    if result.returncode not in (0, 1):
        raise FastError(f"magick compare failed (exit {result.returncode}): {result.stderr.strip()[:200]}")
    changed, total = parse_ae(result.stderr), new_size[0] * new_size[1]
    return {"percent": 100.0 * changed / total, "changed": changed, "total": total, "note": ""}


def grab_screen(dev, path: Path, *, vnc: bool = False) -> None:
    if not vnc:
        result = dev.desktop("grim screenshot", "grim -l 1 - | base64 -w0", timeout=20, check=False)
        if result.returncode == 0 and result.stdout.strip():
            path.write_bytes(base64.b64decode(result.stdout))
            return
        log(f"grim failed ({(result.stderr or 'no output').strip()[:120]}); using VNC")
    dev.vnc("VNC screenshot", "capture", str(path))


def capture_shot(dev, shots: Path, name: str, *, vnc: bool = False, diff: bool = False, magick: str | None = None, fuzz: float = 1.0) -> dict:
    """Capture NAME.png; with `diff`, compare to the previous NAME.png and keep it as NAME.prev.png."""
    shots.mkdir(parents=True, exist_ok=True)
    stem = safe_name(name)
    path, prev, fresh = shots / f"{stem}.png", shots / f"{stem}.prev.png", shots / f"{stem}.new.png"
    grab_screen(dev, fresh, vnc=vnc)
    record: dict = {"name": stem, "path": str(path)}
    if diff:
        if path.exists():
            if not magick:
                raise FastError("--diff needs ImageMagick (`magick`) in the VM state tools")
            record["diff"] = compare_images(magick, path, fresh, shots / f"{stem}.diff.png", fuzz=fuzz)
            record["diff_png"] = str(shots / f"{stem}.diff.png")
            os.replace(path, prev)
        else:
            record["diff"] = None  # no baseline yet
    os.replace(fresh, path)
    return record


def format_shot(record: dict) -> str:
    line = record["path"]
    if "diff" in record:
        d = record["diff"]
        if d is None:
            line += "  diff: no previous capture"
        else:
            detail = f" ({d['changed']}/{d['total']} px)" if d["changed"] is not None else f" ({d['note']})"
            line += f"  diff: {d['percent']:.4f}% changed{detail}"
    return line


# --- scenes ----------------------------------------------------------------

STEP_KEYS = {
    "run": {"run", "timeout"},
    "key": {"key"},
    "click": {"click"},
    "scroll": {"scroll"},
    "sleep": {"sleep"},
    "shot": {"shot", "diff"},
}


def _check(cond: bool, where: str, message: str) -> None:
    if not cond:
        raise FastError(f"scene {where}: {message}")


def load_scenes(path: Path) -> list[dict]:
    """Parse and validate a scenes file before any VM interaction."""
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise FastError(f"cannot read scenes file {path}: {exc}") from exc
    steps = data.get("steps") if isinstance(data, dict) else data
    _check(isinstance(steps, list) and steps, "file", "expected a non-empty list of steps (or {\"steps\": [...]})")
    for index, step in enumerate(steps, 1):
        where = f"step {index}"
        _check(isinstance(step, dict), where, "must be an object")
        kinds = [k for k in step if k in STEP_KEYS]
        _check(len(kinds) == 1, where, f"needs exactly one of {sorted(STEP_KEYS)}; got keys {sorted(step)}")
        kind = kinds[0]
        extra = set(step) - STEP_KEYS[kind]
        _check(not extra, where, f"unknown key(s) {sorted(extra)} for '{kind}'")
        value = step[kind]
        if kind == "run":
            ok = (isinstance(value, str) and value.strip()) or (
                isinstance(value, list) and value and all(isinstance(v, str) for v in value)
            )
            _check(bool(ok), where, "'run' must be a command string or a non-empty list of strings")
            timeout = step.get("timeout", 30)
            _check(isinstance(timeout, (int, float)) and not isinstance(timeout, bool) and timeout > 0, where, "'timeout' must be positive")
        elif kind == "key":
            keys = [value] if isinstance(value, str) else value
            _check(isinstance(keys, list) and keys and all(isinstance(k, str) and k for k in keys), where,
                   "'key' must be a key name or a non-empty list of key names")
        elif kind == "click":
            _check(isinstance(value, list) and len(value) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in value),
                   where, "'click' must be [x, y] with non-negative integers")
        elif kind == "scroll":
            _check(isinstance(value, list) and len(value) == 3 and all(isinstance(v, int) and not isinstance(v, bool) for v in value)
                   and value[0] >= 0 and value[1] >= 0 and 1 <= abs(value[2]) <= 50,
                   where, "'scroll' must be [x, y, notches] (negative notches scroll up, |notches| 1..50)")
        elif kind == "sleep":
            _check(isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 120, where,
                   "'sleep' must be a number of seconds between 0 and 120")
        elif kind == "shot":
            _check(isinstance(value, str) and value.strip(), where, "'shot' must be a name")
            _check(isinstance(step.get("diff", False), bool), where, "'diff' must be true or false")
    return steps



def run_scenes(dev, steps: list[dict], shots: Path, *, state: dict, magick: str | None, fuzz: float = 1.0) -> list[dict]:
    """Execute one scene with one SSH attachment and one VNC connection per VNC segment."""
    pending: list[str] = []
    pending_shots: list[tuple[dict, Path]] = []
    results: list[dict] = []
    started = time.monotonic()

    def flush() -> None:
        if not pending:
            return
        budget = 25 + 3 * len(pending_shots) + sum(float(pending[i + 1]) for i, w in enumerate(pending) if w == "pause" and i + 1 < len(pending)) + 0.15 * pending.count("click")
        dev.vnc("VNC scene segment", *pending, timeout=int(budget))
        pending.clear()
        for record, fresh in pending_shots:
            stem = safe_name(record["name"])
            path, prev = shots / f"{stem}.png", shots / f"{stem}.prev.png"
            completed: dict = {"name": stem, "path": str(path)}
            if record.get("diff"):
                if path.exists():
                    if not magick:
                        raise FastError("scene shot diff needs ImageMagick (`magick`) in the VM state tools")
                    completed["diff"] = compare_images(magick, path, fresh, shots / f"{stem}.diff.png", fuzz=fuzz)
                    completed["diff_png"] = str(shots / f"{stem}.diff.png")
                    os.replace(path, prev)
                else:
                    completed["diff"] = None
            os.replace(fresh, path)
            record.update(completed)
            if record.get("diff") is False:
                record.pop("diff", None)
            print(format_shot(record))
        pending_shots.clear()

    shots.mkdir(parents=True, exist_ok=True)
    try:
        for index, step in enumerate(steps, 1):
            entry: dict = {"step": index}
            if "key" in step:
                keys = [step["key"]] if isinstance(step["key"], str) else step["key"]
                pending.extend(arg for key in keys for arg in ("key", key))
                entry["kind"] = "key"
            elif "click" in step:
                x, y = step["click"]
                pending.extend(["move", str(x), str(y), "click", "1"])
                entry["kind"] = "click"
            elif "scroll" in step:
                x, y, notches = step["scroll"]
                wheel = "5" if notches > 0 else "4"
                pending.extend(["move", str(x), str(y)])
                pending.extend(["click", wheel] * abs(notches))
                entry["kind"] = "scroll"
            elif "sleep" in step:
                pending.extend(["pause", str(step["sleep"])])
                entry["kind"] = "sleep"
            elif "shot" in step:
                fresh = shots / f".{safe_name(step['shot'])}.{index}.scene.png"
                pending.extend(["capture", str(fresh)])
                record = {"name": step["shot"], "diff": step.get("diff", False)}
                pending_shots.append((record, fresh))
                entry.update(kind="shot", **record)
            elif "run" in step:
                flush()
                command = step["run"]
                argv = shlex.split(command) if isinstance(command, str) else command
                entry["kind"] = "run"
                if len(argv) == 1 and ACTION_NAME.match(argv[0]):
                    dev.activate_shell_action(argv[0])
                else:
                    if argv[0] == SHELL_NAME and state.get("shade_path"):
                        argv = [f"{state['shade_path']}/bin/{SHELL_NAME}", *argv[1:]]
                    text = command if isinstance(command, str) and shlex.split(command) == argv else shlex.join(argv)
                    result = dev.desktop(f"scene run {index}", text, timeout=int(step.get("timeout", 30)), check=False)
                    entry["exit"] = result.returncode
                    if result.returncode:
                        raise FastError(f"scene step {index} (run {command!r}) exited {result.returncode}: {(result.stderr or result.stdout).strip()[:300]}")
            entry["seconds"] = round(time.monotonic() - started, 3)
            results.append(entry)
        flush()
    finally:
        for _, fresh in pending_shots:
            fresh.unlink(missing_ok=True)
    return results
