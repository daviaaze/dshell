#!/usr/bin/env python3
import fcntl
import os
import signal
import sys

LOCK_FILE = os.environ.get("SHADE_LOCK_FILE", "/tmp/shade-touchpad-disabled.pid")


def find_touchpad():
    for evdev in sorted(os.listdir("/dev/input")):
        if not evdev.startswith("event"):
            continue
        name_path = f"/sys/class/input/{evdev}/device/name"
        try:
            with open(name_path) as f:
                name = f.read().strip().lower()
                if "touchpad" in name:
                    return f"/dev/input/{evdev}"
        except Exception:
            continue
    return None


DEVICE = find_touchpad()
EVIOCGRAB = 0x40044590


def disable():
    if not DEVICE:
        print("No touchpad found", file=sys.stderr)
        sys.exit(1)
    pid = os.fork()
    if pid > 0:
        with open(LOCK_FILE, "w") as f:
            f.write(str(pid))
        print("disabled")
        return
    os.setsid()
    for fd in (0, 1, 2):
        try:
            os.close(fd)
        except Exception:
            pass
    fd = os.open(DEVICE, os.O_RDWR | os.O_NONBLOCK)
    fcntl.ioctl(fd, EVIOCGRAB, 1)
    while True:
        signal.pause()


def enable():
    if not os.path.exists(LOCK_FILE):
        print("already enabled")
        return
    with open(LOCK_FILE) as f:
        pid = int(f.read().strip())
    try:
        os.kill(pid, signal.SIGTERM)
        os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError):
        pass
    try:
        os.remove(LOCK_FILE)
    except Exception:
        pass
    print("enabled")


if __name__ == "__main__":
    if os.path.exists(LOCK_FILE):
        enable()
    else:
        disable()
