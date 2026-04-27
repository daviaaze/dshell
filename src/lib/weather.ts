import GWeather from "gi://GWeather?version=4.0"
import GObject, { getter, register, setter } from "gnim/gobject"
import { useSettings } from "./settings";
import Geolocation from "./geolocation";

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
  }

  updateFromCoords(lat: number, lon: number) {
    const newLoc = GWeather.Location.get_world()
      ?.find_nearest_city(lat, lon)
    if (newLoc) this.location = newLoc
  }

  detectLocation() {
    this.#geo.detect()
  }

  constructor() {
    super()

    const settings = useSettings().weather

    this.#location = GWeather.Location.get_world()
      ?.find_nearest_city(
        settings.latitude.get(),
        settings.longitude.get())

    this.#weather = GWeather.Info.new(this.#location)

    this.#weather.set_application_id(import.meta.domain)
    this.#weather.set_enabled_providers(GWeather.Provider.MET_NO)
    this.#weather.set_contact_info("caiomuniz888@gmail.com")

    this.#weather.connect("updated",
      () => this.notify("info"))

    this.#weather.update()

    setInterval(() =>
      this.#weather.update(),
      0.25 * 3600000)

    // Auto-location on startup if enabled
    if (settings.autoLocation.get()) {
      this.#geo.locationChanged.connect((_, lat, lon) => {
        settings.setLatitude(lat)
        settings.setLongitude(lon)
        this.updateFromCoords(lat, lon)
      })
      this.detectLocation()
    }

    settings.autoLocation.subscribe((enabled) => {
      if (enabled) {
        this.#geo.locationChanged.connect((_, lat, lon) => {
          settings.setLatitude(lat)
          settings.setLongitude(lon)
          this.updateFromCoords(lat, lon)
        })
        this.detectLocation()
      }
    })
  }
}
