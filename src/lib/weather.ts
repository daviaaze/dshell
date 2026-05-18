import GWeather from "gi://GWeather?version=4.0"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register, setter } from "gnim/gobject"
import Geolocation from "./geolocation"
import logger from "#/lib/logger"

@register({ GTypeName: "Weather" })
export default class Weather extends GObject.Object {
  static instance: Weather;

  static get_default() {
    if (!this.instance)
      this.instance = new Weather();
    return this.instance;
  }

  #weather: GWeather.Info
  #location: GWeather.Location | undefined
  #geo = Geolocation.get_default()
  #updateTimer: number | null = null

  @getter(GWeather.Info)
  get info() {
    return this.#weather
  }

  @setter(GWeather.Location)
  set location(location: GWeather.Location | undefined) {
    if (!location) return
    this.#location = location
    this.#weather.set_location(location)
    this.#weather.update()
    this.notify("location")
    this.notify("info")
  }

  updateFromCoords(lat: number, lon: number) {
    const newLoc = GWeather.Location.get_world()
      ?.find_nearest_city(lat, lon)
    if (newLoc) this.location = newLoc
  }

  detectLocation() {
    this.#geo.detect()
  }

  init(settings: { latitude: { get(): number }, longitude: { get(): number }, autoLocation: { get(): boolean, subscribe(cb: (v: boolean) => void): () => void }, setLatitude(lat: number): void, setLongitude(lon: number): void }) {
    this.#location = GWeather.Location.get_world()
      ?.find_nearest_city(
        settings.latitude.get(),
        settings.longitude.get())

    if (this.#location) {
      this.#weather.set_location(this.#location)
      this.#weather.update()
    }

    this.#updateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0.25 * 3600000, () => {
      this.#weather.update()
      return GLib.SOURCE_CONTINUE
    })

    let geoHandlerId: number | null = null

    const connectGeo = () => {
      if (geoHandlerId !== null) {
        this.#geo.disconnect(geoHandlerId)
        geoHandlerId = null
      }
      geoHandlerId = this.#geo.connect("location-changed", (_, lat, lon) => {
        settings.setLatitude(lat)
        settings.setLongitude(lon)
        this.updateFromCoords(lat, lon)
      })
    }

    // Auto-location on startup if enabled
    if (settings.autoLocation.get()) {
      connectGeo()
      this.detectLocation()
    }

    settings.autoLocation.subscribe((enabled) => {
      if (enabled) {
        connectGeo()
        this.detectLocation()
      } else if (geoHandlerId !== null) {
        this.#geo.disconnect(geoHandlerId)
        geoHandlerId = null
      }
    })
  }

  constructor() {
    super()

    this.#weather = GWeather.Info.new(null)

    this.#weather.set_application_id(import.meta.domain)
    this.#weather.set_enabled_providers(GWeather.Provider.MET_NO)
    this.#weather.set_contact_info("caiomuniz888@gmail.com")

    this.#weather.connect("updated",
      () => {
        logger.info("weather",
          `updated: valid=${this.#weather.is_valid()}` +
          ` temp=${this.#weather.get_temp_summary() || "null"}` +
          ` sky=${this.#weather.get_sky() || "null"}` +
          ` loc=${this.#weather.get_location_name() || "null"}`)
        this.notify("info")
      })
  }
}
