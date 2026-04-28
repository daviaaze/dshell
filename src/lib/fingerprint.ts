import GObject, { getter, register, signal } from "gnim/gobject"
import Gio from "gi://Gio"
import GLib from "gi://GLib"

const FPRINTD_SERVICE = "net.reactivated.Fprint"
const FPRINTD_MANAGER = "/net/reactivated/Fprint/Manager"

@register({ GTypeName: "FingerprintAuth" })
export default class FingerprintAuth extends GObject.Object {
  static instance: FingerprintAuth

  static get_default() {
    if (!this.instance) this.instance = new FingerprintAuth()
    return this.instance
  }

  #available = false
  #verifying = false
  #devicePath: string | null = null
  #deviceProxy: Gio.DBusProxy | null = null

  @getter(Boolean)
  get available() { return this.#available }

  @getter(Boolean)
  get verifying() { return this.#verifying }

  @signal()
  verified() {}

  @signal(String)
  failed(_reason: string) {}

  @signal(String)
  statusChanged(_status: string) {}

  async init() {
    try {
      const manager = await this.#getProxy(FPRINTD_MANAGER, "net.reactivated.Fprint.Manager")
      const devices = manager.call_sync(
        "GetDevices",
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null
      )?.get_child_value(0)

      if (!devices || devices.n_children() === 0) {
        this.#available = false
        this.notify("available")
        return
      }

      this.#devicePath = devices.get_child_value(0).get_string()[0]
      this.#deviceProxy = await this.#getProxy(this.#devicePath, "net.reactivated.Fprint.Device")
      this.#available = true
      this.notify("available")

      this.#deviceProxy.connect("g-signal", (_proxy, _sender, signalName, params) => {
        if (signalName === "VerifyStatus") {
          const status = params.get_child_value(0).get_string()[0]
          const done = params.get_child_value(1).get_boolean()
          this.statusChanged(status)

          if (done) {
            if (status === "verify-match") {
              this.#verifying = false
              this.notify("verifying")
              this.verified()
            } else {
              this.#verifying = false
              this.notify("verifying")
              this.failed(status)
            }
          }
        }
      })
    } catch {
      this.#available = false
      this.notify("available")
    }
  }

  start() {
    if (!this.#available || !this.#deviceProxy) return
    try {
      this.#verifying = true
      this.notify("verifying")
      this.#deviceProxy.call_sync(
        "VerifyStart",
        GLib.Variant.new("(s)", ["any"]),
        Gio.DBusCallFlags.NONE,
        -1,
        null
      )
    } catch (e) {
      this.#verifying = false
      this.notify("verifying")
      this.failed(String(e))
    }
  }

  stop() {
    if (!this.#deviceProxy) return
    try {
      this.#deviceProxy.call_sync(
        "VerifyStop",
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null
      )
    } catch { /* ignore */ }
    this.#verifying = false
    this.notify("verifying")
  }

  async #getProxy(objectPath: string, interfaceName: string): Promise<Gio.DBusProxy> {
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
        }
      )
    })
  }
}
