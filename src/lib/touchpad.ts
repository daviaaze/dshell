import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import GObject, { getter, register, setter } from "gnim/gobject"

const LOCK_FILE = "/tmp/shade-touchpad-disabled.pid"

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
        except:
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
        except:
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
    except:
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
      "python3 /tmp/shade-touchpad-toggle.py",
      (out: string) => {
        print("touchpad toggle:", out.trim())
        this.#checkState()
      }
    )
  }

  #ensureScript() {
    if (GLib.file_test("/tmp/shade-touchpad-toggle.py", GLib.FileTest.EXISTS)) return

    try {
      const file = Gio.File.new_for_path("/tmp/shade-touchpad-toggle.py")
      file.replace_contents(
        TOGGLE_SCRIPT,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      )
      const info = file.query_info("unix::mode", Gio.FileQueryInfoFlags.NONE, null)
      info.set_attribute_uint32("unix::mode", 0o755)
      file.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null)
    } catch (e) {
      print("Failed to write touchpad toggle script:", (e as Error).message)
    }
  }

  #hasTouchpad(): boolean {
    const dir = Gio.File.new_for_path("/sys/class/input")
    try {
      const enumerator = dir.enumerate_children(
        "standard::name",
        Gio.FileQueryInfoFlags.NONE,
        null
      )
      let fileInfo
      while ((fileInfo = enumerator.next_file(null)) !== null) {
        const name = fileInfo.get_name()
        if (!name.startsWith("event")) continue
        const nameFile = Gio.File.new_for_path(`/sys/class/input/${name}/device/name`)
        try {
          const [, contents] = nameFile.load_contents(null)
          const deviceName = new TextDecoder().decode(contents).trim().toLowerCase()
          if (deviceName.includes("touchpad")) {
            enumerator.close(null)
            return true
          }
        } catch {
          continue
        }
      }
      enumerator.close(null)
    } catch {
      // directory doesn't exist or no access
    }
    return false
  }

  #checkState() {
    this.disabled = GLib.file_test(LOCK_FILE, GLib.FileTest.EXISTS)
  }

  constructor() {
    super()
    this.#available = this.#hasTouchpad()
    this.#checkState()
    if (this.#available) {
      this.#ensureScript()
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        this.#checkState()
        return GLib.SOURCE_CONTINUE
      })
    }
  }
}
