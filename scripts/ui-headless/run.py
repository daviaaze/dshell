#!/usr/bin/env python3
"""Capture real Shade panels in disposable, parallel headless Hyprland sessions."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

from core import SAFE_NAME, find_layer, load_scene, logical_size, parse_scales, parse_sizes
from session import Session, atspi_launcher, kill_owned

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def host_monitors():
    """The only real-session IPC is this read-only before/after safety check."""
    runtime, signature = os.environ.get("XDG_RUNTIME_DIR", ""), os.environ.get("HYPRLAND_INSTANCE_SIGNATURE", "")
    if not runtime.startswith("/run/user/") or not signature:
        return {"checked": False, "reason": "no real Hyprland session in the invoking environment"}
    env = os.environ.copy()
    env.update(XDG_RUNTIME_DIR=runtime, HYPRLAND_INSTANCE_SIGNATURE=signature)
    try:
        result = subprocess.run(["hyprctl", "monitors", "-j"], env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=True)
        monitors = json.loads(result.stdout)
        return {"checked": True, "monitors": monitors,
                "edp1_enabled": any(m["name"] == "eDP-1" and not m.get("disabled", False) for m in monitors)}
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        return {"checked": False, "error": str(error)}


def run_scene(session, name, scene):
    result = {"name": name, "namespace": scene["namespace"], "status": "pass", "captures": []}
    (session.output / "baselines").mkdir(exist_ok=True)
    baseline = session.capture_baseline(name)
    try:
        for step in scene["steps"]:
            operation, value = next(iter(step.items()))
            if operation == "run":
                session.action(value)
            elif operation == "wait_layer":
                session.wait_layer(value)
            elif operation == "wait_closed":
                session.wait_layer(value, False)
            elif operation == "key":
                session.key(value)
            elif operation == "type":
                session.type(value)
            elif operation == "click":
                session.click(*value)
            elif operation == "expect_text":
                def has_text():
                    tree = session.accessibility_snapshot()
                    write_json(session.output / f"{name}.a11y.json", tree)
                    return tree if any(value in node.get("text", "") for app in tree["applications"] for node in app["nodes"]) else False
                tree = session.wait(has_text, f"AT-SPI entry text {value!r}", timeout=5)
                result["typed_text_verified"] = value
            elif operation == "shot":
                capture = session.capture_panel(value, scene["namespace"], baseline)
                result["captures"].append(capture)
                write_json(session.output / f"{value}.layers.json", capture["layers"])
                if not all(capture["assertions"].values()):
                    result["status"] = "fail"
                    result["error"] = "failed assertions: " + ", ".join(key for key, passed in capture["assertions"].items() if not passed)
                    failed = {key for key, passed in capture["assertions"].items() if not passed}
                    if failed <= {"drawn_pixels", "region_not_uniform"} and scene.get("known_limitation"):
                        result["known_limitation"] = scene["known_limitation"]
                if not (session.output / f"{name}.a11y.json").exists():
                    try:
                        write_json(session.output / f"{name}.a11y.json", session.accessibility_snapshot())
                    except (RuntimeError, ValueError, SyntaxError, TypeError, subprocess.SubprocessError) as error:
                        result["accessibility_error"] = str(error)
    except (OSError, RuntimeError, ValueError, SyntaxError, TypeError, subprocess.SubprocessError) as error:
        result.update(status="fail", error=str(error))
        if not session.cancel.is_set():
            try:
                path, _ = session.capture(f"{name}-failure")
                result["failure_capture"] = str(path)
                write_json(session.output / f"{name}-failure.layers.json", session.layers())
            except (OSError, RuntimeError, subprocess.SubprocessError):
                pass
    finally:
        # A failed input/assertion must not leave a panel covering the next scene.
        if not session.cancel.is_set():
            try:
                if find_layer(session.layers(), scene["namespace"]):
                    action = next(step["run"] for step in scene["steps"] if "run" in step)
                    session.action(action)
                    session.wait_layer(scene["namespace"], False)
            except (OSError, RuntimeError, StopIteration, subprocess.SubprocessError) as error:
                result.update(status="fail", cleanup_error=str(error))
    return result


def run_worker(index, root, output, size, scale, scenes, args, cancel):
    label = f"{size[0]}x{size[1]}@{scale:g}"
    destination = output / label
    destination.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    result = {"size": list(size), "scale": scale, "label": label, "status": "fail", "scenes": []}
    if cancel.is_set():
        result.update(status="cancelled", error="run cancelled before session start")
        write_json(destination / "report.json", result)
        return result
    session = Session(root / str(index), destination, size, scale, cancel,
                      args.session_timeout, args.ready_timeout, args.wayland_debug)
    print(f"START {label}", flush=True)
    try:
        session.start(REPO)
        result.update(monitor=session.monitor, logical_size=list(logical_size(session.monitor)),
                      keyboard_devices=session.keyboard_devices,
                      capture_scale=session.capture_scale,
                      accessibility={"available": bool(session.a11y_address), "error": getattr(session, "a11y_error", None)},
                      ready_seconds=round(time.monotonic() - started, 3))
        print(f"READY {label}", flush=True)
        for name, scene in scenes:
            session.check_deadline()
            scene_result = run_scene(session, name, scene)
            result["scenes"].append(scene_result)
            print(f"{scene_result['status'].upper()} {label} {name}" + (f": {scene_result['error']}" if scene_result.get("error") else ""), flush=True)
        result["status"] = "pass" if all(scene["status"] == "pass" for scene in result["scenes"]) else "fail"
    except (OSError, RuntimeError, ValueError, SyntaxError, TypeError, subprocess.SubprocessError) as error:
        result["error"] = str(error)
        print(f"FAIL {label}: {error}", flush=True)
    finally:
        survivors = session.cleanup()
        for path in (session.runtime / "hypr").glob("*/hyprland.log"):
            shutil.copyfile(path, destination / "compositor.log")
        result["cleanup"] = {"surviving_pids": survivors, "runtime_removed": not survivors}
        if not survivors:
            shutil.rmtree(session.root, ignore_errors=True)
        else:
            result.update(status="fail", error=f"isolated processes survived cleanup: {survivors}")
        result["duration_seconds"] = round(time.monotonic() - started, 3)
        write_json(destination / "report.json", result)
    return result


def parser():
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--sizes", default="1280x720,1920x1080,2560x1440")
    command.add_argument("--scales", default="1")
    command.add_argument("--scenes", default="launcher,launcher-query,quicksettings,notifications")
    command.add_argument("--scene-dir", type=Path, default=HERE / "scenes", help="JSON scenes; run operations are restricted to safe panel GActions")
    command.add_argument("--jobs", type=int, default=2)
    command.add_argument("--out", type=Path, required=True)
    command.add_argument("--ready-timeout", type=float, default=90)
    command.add_argument("--session-timeout", type=float, default=165, help="hard per-session safety deadline, at most 170 seconds")
    command.add_argument("--wayland-debug", action="store_true", help="record Wayland buffer/configure traffic in shell.log")
    return command


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        sizes, scales = parse_sizes(args.sizes), parse_scales(args.scales)
        if args.jobs < 1 or not 1 <= args.ready_timeout < args.session_timeout <= 170:
            raise ValueError("jobs must be positive; 1 <= ready-timeout < session-timeout <= 170")
        names = args.scenes.split(",")
        if any(not SAFE_NAME.fullmatch(name) for name in names) or len(set(names)) != len(names):
            raise ValueError("scene names must be unique, simple file names")
        scenes = [(name, load_scene(args.scene_dir / f"{name}.json")) for name in names]
    except (ValueError, OSError) as error:
        parser().error(str(error))
    required = ("Hyprland", "hyprctl", "grim", "gdbus", "wtype", "wlrctl", "unshare", "dbus-run-session")
    missing = [name for name in required if not shutil.which(name)]
    if missing or not atspi_launcher():
        if not os.environ.get("IN_NIX_SHELL"):
            # Enter once, before parallel sessions. dev.sh then reuses this exact devshell.
            os.execvp("nix", ["nix", "develop", "--impure", "-c", "python3", str(HERE / "run.py"), *(sys.argv[1:] if argv is None else argv)])
        parser().error("missing devshell tools: " + ", ".join(missing + ([] if atspi_launcher() else ["at-spi-bus-launcher"])))
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if (output / "report.json").exists():
        parser().error("output already contains report.json; choose a fresh --out directory")
    # Keep paths short enough for Hyprland's long signature and Unix-domain socket limits.
    root = Path(tempfile.mkdtemp(prefix="shu-", dir="/tmp"))
    cancel, interrupted = threading.Event(), []
    def interrupt(signum, _frame):
        interrupted.append(signum)
        cancel.set()
    old_handlers = {sig: signal.signal(sig, interrupt) for sig in (signal.SIGINT, signal.SIGTERM)}
    report = {"status": "fail", "output": str(output), "jobs": args.jobs, "host_before": host_monitors(), "workers": []}
    started = time.monotonic()
    try:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(run_worker, i, root, output, size, scale, scenes, args, cancel)
                       for i, (size, scale) in enumerate((size, scale) for size in sizes for scale in scales)]
            for future in as_completed(futures):
                report["workers"].append(future.result())
    finally:
        cancel.set()
        survivors = kill_owned(root)
        if not survivors:
            shutil.rmtree(root)
        report["cleanup"] = {"surviving_pids": survivors, "runtime_root_removed": not root.exists()}
        report["host_after"] = host_monitors()
        before, after = report["host_before"], report["host_after"]
        report["real_edp1_preserved"] = (after.get("edp1_enabled", False) if before.get("edp1_enabled") else None)
        report["interrupted"] = bool(interrupted)
        report["duration_seconds"] = round(time.monotonic() - started, 3)
        report["status"] = "pass" if (not interrupted and report["workers"] and all(worker["status"] == "pass" for worker in report["workers"])
                                                and not survivors and report["real_edp1_preserved"] is not False) else "fail"
        write_json(output / "report.json", report)
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
    print(f"{report['status'].upper()} report: {output / 'report.json'}", flush=True)
    return 130 if interrupted else 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
