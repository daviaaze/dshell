import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import GObject, { getter, register, setter } from "gnim/gobject"

const XDG_RUNTIME_DIR = GLib.getenv("XDG_RUNTIME_DIR") || `/run/user/${GLib.getuid()}`
const RUNTIME_DIR = `${XDG_RUNTIME_DIR}/shade`
const LOCK_FILE = `${RUNTIME_DIR}/touchpad-disabled.pid`
const SCRIPT_PATH = `${(import.meta as any).bindir || "/usr/local/bin"}/toggle-touchpad.py`

@register({ GTypeName: "Touchpad" })
export default class Touchpad extends GObject.Object {
  static instance: Touchpad

  static get_default() {
    if (!this.instance) this.instance = new Touchpad()
    return this.instance
  }

  #available = false
  #disabled = false
  #pollTimer: number | null = null

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
    if (!GLib.file_test(SCRIPT_PATH, GLib.FileTest.EXISTS)) {
      print("Touchpad toggle script not found at:", SCRIPT_PATH)
      return
    }
    AstalIO.Process.exec_async(
      `SHADE_LOCK_FILE="${LOCK_FILE}" python3 ${SCRIPT_PATH}`,
      () => {
        this.#checkState()
      }
    )
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
    if (!GLib.file_test(LOCK_FILE, GLib.FileTest.EXISTS)) {
      this.disabled = false
      return
    }
    try {
      const [, contents] = GLib.file_get_contents(LOCK_FILE)
      const pid = parseInt(new TextDecoder().decode(contents).trim(), 10)
      if (!isNaN(pid)) {
        const procDir = Gio.File.new_for_path(`/proc/${pid}`)
        if (procDir.query_exists(null)) {
          this.disabled = true
          return
        }
      }
      // Stale lock file — clean up
      GLib.unlink(LOCK_FILE)
    } catch {
      // Ignore errors, assume enabled
    }
    this.disabled = false
  }

  constructor() {
    super()
    GLib.mkdir_with_parents(RUNTIME_DIR, 0o700)
    this.#available = this.#hasTouchpad()
    this.#checkState()
    if (this.#available) {
      this.#pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        this.#checkState()
        return GLib.SOURCE_CONTINUE
      })
    }
  }

  dispose() {
    if (this.#pollTimer !== null) {
      GLib.source_remove(this.#pollTimer)
      this.#pollTimer = null
    }
  }
}
