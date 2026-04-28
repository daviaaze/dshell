import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register, setter } from "gnim/gobject"

const LOCK_FILE = "/tmp/shade-touchpad-disabled.pid"
const SCRIPT_PATH = `${(import.meta as any).bindir || "/usr/local/bin"}/toggle-touchpad.py`

const TOGGLE_SCRIPT = `import fcntl, os, signal, sys

LOCK_FILE = "/tmp/shade-touchpad-disabled.pid"

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
`

@register({ GTypeName: "Touchpad" })
export default class Touchpad extends GObject.Object {
  static instance: Touchpad

  static get_default() {
    if (!this.instance) this.instance = new Touchpad()
    return this.instance
  }

  #available = false
  #disabled = false
  #scriptPath = ""

  @getter(Boolean)
  get available() {
    return this.#available
  }

  @getter(Boolean)
  get disabled() {
    return this.#disabled
  }

  @setter(Boolean)
  set disabled(value: boolean) {
    if (this.#disabled === value) return
    this.#disabled = value
    this.notify("disabled")
  }

  toggle() {
    this.#ensureScript()
    AstalIO.Process.exec_async(
      `python3 ${this.#scriptPath}`,
      () => {
        this.#checkState()
      }
    )
  }

  #ensureScript() {
    if (GLib.file_test(SCRIPT_PATH, GLib.FileTest.EXISTS)) {
      this.#scriptPath = SCRIPT_PATH
      return
    }

    const fallback = "/tmp/shade-touchpad-toggle.py"
    if (!GLib.file_test(fallback, GLib.FileTest.EXISTS)) {
      try {
        GLib.file_set_contents(fallback, TOGGLE_SCRIPT)
        AstalIO.Process.exec(`chmod +x ${fallback}`)
      } catch (e) {
        print("Failed to write touchpad toggle script:", (e as Error).message)
        return
      }
    }
    this.#scriptPath = fallback
  }

  #hasTouchpad(): boolean {
    try {
      const out = AstalIO.Process.exec(
        "bash -c 'for f in /sys/class/input/event*/device/name; do if grep -qi touchpad \"$f\" 2>/dev/null; then echo yes; break; fi; done'"
      )
      return out.trim() === "yes"
    } catch {
      return false
    }
  }

  #checkState() {
    this.disabled = GLib.file_test(LOCK_FILE, GLib.FileTest.EXISTS)
  }

  constructor() {
    super()
    this.#available = this.#hasTouchpad()
    this.#checkState()
    if (this.#available) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        this.#checkState()
        return GLib.SOURCE_CONTINUE
      })
    }
  }
}
