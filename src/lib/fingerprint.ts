import GObject, { getter, register, signal } from "gnim/gobject"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import logger from "#/lib/logger"

const FPRINTD_SERVICE = "net.reactivated.Fprint"
const FPRINTD_MANAGER = "/net/reactivated/Fprint/Manager"
const MAX_RETRIES = 3

type FingerprintState = "idle" | "initializing" | "verifying" | "error"

@register({ GTypeName: "FingerprintAuth" })
export default class FingerprintAuth extends GObject.Object {
  static instance: FingerprintAuth

  static get_default() {
    if (!this.instance) this.instance = new FingerprintAuth()
    return this.instance
  }

  #available = false
  #state: FingerprintState = "idle"
  #errorMessage = ""
  #devicePath: string | null = null
  #deviceProxy: Gio.DBusProxy | null = null
  #initialized = false
  #claimed = false
  #consecutiveFailures = 0
  #signalId = 0

  @getter(Boolean)
  get available() {
    return this.#available
  }

  @getter(String)
  get state() {
    return this.#state
  }

  @getter(String)
  get errorMessage() {
    return this.#errorMessage
  }

  @getter(Boolean)
  get verifying() {
    return this.#state === "verifying"
  }

  @signal()
  verified() {}

  @signal([GObject.TYPE_STRING], GObject.TYPE_NONE)
  failed(_reason: string) {}

  @signal([GObject.TYPE_STRING], GObject.TYPE_NONE)
  statusChanged(_status: string) {}

  #setState(state: FingerprintState) {
    if (this.#state === state) return
    this.#state = state
    this.notify("state")
    this.notify("verifying")
  }

  #setError(message: string) {
    this.#errorMessage = message
    this.notify("error-message")
    this.#setState("error")
  }

  async init() {
    if (this.#initialized) return
    this.#initialized = true
    try {
      const manager = await this.#getProxy(
        FPRINTD_MANAGER,
        "net.reactivated.Fprint.Manager",
      )
      const devices = manager
        .call_sync("GetDevices", null, Gio.DBusCallFlags.NONE, -1, null)
        ?.get_child_value(0)

      if (!devices || devices.n_children() === 0) {
        this.#available = false
        this.notify("available")
        return
      }

      this.#devicePath = devices.get_child_value(0).get_string()[0]
      this.#deviceProxy = await this.#getProxy(
        this.#devicePath,
        "net.reactivated.Fprint.Device",
      )
      this.#available = true
      this.notify("available")

      this.#signalId = this.#deviceProxy.connect(
        "g-signal",
        (_proxy, _sender, signalName, params) => {
          if (signalName === "VerifyStatus") {
            const status = params.get_child_value(0).get_string()[0]
            const done = params.get_child_value(1).get_boolean()
            this.statusChanged(status)

            if (done) {
              this.#handleVerifyDone(status)
            }
          }
        },
      )
    } catch (e) {
      logger.warn("fingerprint", "init failed:", e)
      this.#available = false
      this.notify("available")
    }
  }

  #handleVerifyDone(status: string) {
    // Ignore stale VerifyStatus signals from a previous fprintd session.
    // The signal handler connects during init(), but we only started
    // verifying via start() — stale done=true signals arrive when no
    // verification is active and must be dropped.
    if (this.#state !== "verifying" && this.#state !== "initializing") {
      return
    }

    // The VerifyStatus D-Bus signal with done=true means the hardware
    // verification already ended — calling VerifyStop would just
    // produce a spurious D-Bus error. Release and reset instead.

    this.#setState("idle")

    if (status === "verify-match") {
      this.#consecutiveFailures = 0
      this.verified()
      return
    }

    if (status === "verify-no-match") {
      this.#consecutiveFailures++
      if (this.#consecutiveFailures >= MAX_RETRIES) {
        this.#setError("Too many fingerprint attempts")
        this.failed("too-many-retries")
        return
      }
      this.#reinitAndRetry().catch((e) =>
        logger.error("fingerprint", "retry failed:", e),
      )
      return
    }

    this.#release()
    this.#setError(`Fingerprint error: ${status}`)
    this.failed(status)
  }

  async #reinitAndRetry() {
    // Don't call stop() — the VerifyStatus D-Bus signal with done=true
    // already ended verification. Just release and restart.
    this.#setState("idle")
    this.#release()
    await new Promise((resolve) => setTimeout(resolve, 500))
    this.start()
  }

  start() {
    if (!this.#available || !this.#deviceProxy) return
    this.#setState("initializing")
    try {
      if (!this.#claimed) {
        this.#deviceProxy.call_sync(
          "Claim",
          GLib.Variant.new("(s)", [GLib.get_user_name()]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
        )
        this.#claimed = true
      }
      this.#setState("verifying")
      this.#deviceProxy.call_sync(
        "VerifyStart",
        GLib.Variant.new("(s)", [""]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      )
    } catch (e) {
      logger.warn("fingerprint", "start failed:", e)
      this.#setError(`Fingerprint device error: ${String(e)}`)
      this.failed(String(e))
      this.#release()
    }
  }

  retry() {
    if (this.#state !== "error") return
    this.#consecutiveFailures = 0
    this.#errorMessage = ""
    this.notify("error-message")
    this.#setState("initializing")
    this.start()
  }

  stop() {
    if (!this.#deviceProxy) return
    // Only call VerifyStop if there's an active verification to cancel.
    // The VerifyStatus D-Bus signal with done=true already ended verification,
    // so calling VerifyStop afterward would fail with a D-Bus error.
    if (this.#state !== "verifying" && this.#state !== "initializing") {
      this.#release()
      return
    }
    try {
      this.#deviceProxy.call_sync(
        "VerifyStop",
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      )
    } catch (e) {
      logger.warn("fingerprint", "VerifyStop failed:", e)
    }
    this.#setState("idle")
    this.#release()
  }

  #release() {
    if (!this.#claimed || !this.#deviceProxy) return
    try {
      this.#deviceProxy.call_sync(
        "Release",
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      )
    } catch (e) {
      // Release can fail if there's no active session to release.
      // This happens with stale VerifyStatus signals when the device
      // was never properly claimed by us. Just log and continue.
      logger.debug("fingerprint", "Release failed:", e)
    }
    this.#claimed = false
  }

  async #getProxy(
    objectPath: string,
    interfaceName: string,
  ): Promise<Gio.DBusProxy> {
    return new Promise((resolve, reject) => {
      Gio.DBusProxy.new_for_bus(
        Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE,
        null,
        FPRINTD_SERVICE,
        objectPath,
        interfaceName,
        null,
        (_, res) => {
          try {
            resolve(Gio.DBusProxy.new_for_bus_finish(res))
          } catch (e) {
            reject(e)
          }
        },
      )
    })
  }
}
