import GObject, { getter, register, signal } from "gnim/gobject"
import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib"
import Gio from "gi://Gio"

interface GeoClueLocation {
  Latitude: GLib.Variant<number>
  Longitude: GLib.Variant<number>
  Accuracy: GLib.Variant<number>
}

@register({ GTypeName: "Geolocation" })
export default class Geolocation extends GObject.Object {
  static instance: Geolocation

  static get_default() {
    if (!this.instance) this.instance = new Geolocation()
    return this.instance
  }

  #latitude = 0
  #longitude = 0
  #available = false

  @getter(Number)
  get latitude() { return this.#latitude }

  @getter(Number)
  get longitude() { return this.#longitude }

  @getter(Boolean)
  get available() { return this.#available }

  @signal(Number, Number)
  declare locationChanged: (lat: number, lon: number) => void

  detect() {
    this.#tryGeoClue().then(found => {
      if (!found) this.#tryIpGeolocation()
    }).catch(() => this.#tryIpGeolocation())
  }

  async #tryGeoClue(): Promise<boolean> {
    try {
      const proxy = await new Promise<Gio.DBusProxy>((resolve, reject) => {
        Gio.DBusProxy.new_for_bus(
          Gio.BusType.SYSTEM,
          Gio.DBusProxyFlags.NONE,
          null,
          "org.freedesktop.GeoClue2",
          "/org/freedesktop/GeoClue2/Manager",
          "org.freedesktop.GeoClue2.Manager",
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

      const clientPath = proxy.call_sync(
        "GetClient",
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null
      )?.get_child_value(0)?.get_string()?.[0]

      if (!clientPath) return false

      const client = await new Promise<Gio.DBusProxy>((resolve, reject) => {
        Gio.DBusProxy.new_for_bus(
          Gio.BusType.SYSTEM,
          Gio.DBusProxyFlags.NONE,
          null,
          "org.freedesktop.GeoClue2",
          clientPath,
          "org.freedesktop.GeoClue2.Client",
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

      client.set_cached_property("DesktopId", new GLib.Variant("s", "com.caioasmuniz.shade_shell"))
      client.set_cached_property("RequestedAccuracyLevel", new GLib.Variant("u", 4))

      await new Promise<void>((resolve, reject) => {
        client.call(
          "Start",
          null,
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (_, res) => {
            try {
              client.call_finish(res)
              resolve()
            } catch (e) {
              reject(e)
            }
          }
        )
      })

      const locationPath = client.get_cached_property("Location")?.get_string()?.[0]
      if (!locationPath) return false

      const location = await new Promise<Gio.DBusProxy>((resolve, reject) => {
        Gio.DBusProxy.new_for_bus(
          Gio.BusType.SYSTEM,
          Gio.DBusProxyFlags.NONE,
          null,
          "org.freedesktop.GeoClue2",
          locationPath,
          "org.freedesktop.GeoClue2.Location",
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

      const lat = location.get_cached_property("Latitude")?.get_double() ?? 0
      const lon = location.get_cached_property("Longitude")?.get_double() ?? 0

      client.call_sync("Stop", null, Gio.DBusCallFlags.NONE, -1, null)

      this.#update(lat, lon)
      return true
    } catch {
      return false
    }
  }

  #tryIpGeolocation() {
    AstalIO.Process.exec_async(
      `curl -s --max-time 5 "https://ipapi.co/json/"`,
      (out) => {
        try {
          const data = JSON.parse(out)
          if (data.latitude && data.longitude) {
            this.#update(data.latitude, data.longitude)
          }
        } catch { /* ignore */ }
      }
    )
  }

  #update(lat: number, lon: number) {
    if (this.#latitude === lat && this.#longitude === lon) return
    this.#latitude = lat
    this.#longitude = lon
    this.#available = true
    this.notify("latitude")
    this.notify("longitude")
    this.notify("available")
    this.locationChanged(lat, lon)
  }
}
