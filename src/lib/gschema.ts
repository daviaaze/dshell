import { defineSchemaList, Schema } from "gnim-schemas"

const id = import.meta.domain || "@domain@"
const datadir = import.meta.datadir || "@datadir@"
const path = `/${id.replaceAll(".", "/")}/`

export const barSchema = new Schema({
  id: id + ".bar",
  path: path + "bar/"
})
  .key("position", "i", {
    default: 8,
    summary: "The position of the bar in the screen",
  })
  .key("temp-path", "s", {
    default: "",
    summary: "Path to the temperature sensor file",
  })
  .key("system-monitor", "s", {
    default: "",
    summary: "The System Monitor to be opened when clicking systemUsage widget",
  })
  .key("show-disk-usage", "b", {
    default: false,
    summary: "Wheter to show disk use in systemUsage"
  })
  .key("show-window-title", "b", {
    default: true,
    summary: "Show the active window title in the bar"
  })
  .key("show-keyboard-layout", "b", {
    default: true,
    summary: "Show the keyboard layout indicator in the bar"
  })
  .key("show-launcher", "b", {
    default: true,
    summary: "Show the launcher button in the bar"
  })
  .key("show-workspaces", "b", {
    default: true,
    summary: "Show workspace indicators in the bar"
  })
  .key("show-system-resources", "b", {
    default: true,
    summary: "Show CPU/RAM/temperature monitors in the bar"
  })
  .key("show-clock", "b", {
    default: true,
    summary: "Show the clock in the bar"
  })
  .key("show-weather", "b", {
    default: true,
    summary: "Show the weather button in the bar"
  })
  .key("show-system-indicators", "b", {
    default: true,
    summary: "Show system indicators (network, battery, audio, etc.) in the bar"
  })
  .key("show-updates", "b", {
    default: true,
    summary: "Show pending system updates indicator in the bar"
  })
  .key("dock-enabled", "b", {
    default: false,
    summary: "Show the dock/taskbar at the bottom of the screen"
  })
  .key("dock-auto-hide", "b", {
    default: false,
    summary: "Automatically hide the dock when not in use"
  })
  .key("dock-icon-size", "i", {
    default: 48,
    summary: "Size of dock icons in pixels"
  })
  .key("dock-pinned-apps", "as", {
    default: ["firefox.desktop", "org.gnome.Nautilus.desktop", "org.gnome.Console.desktop"],
    summary: "List of desktop file IDs for pinned dock apps"
  })

export const weatherSchema = new Schema({
  id: id + ".weather",
  path: path + "weather/"
})
  .key("latitude", "d", {
    default: 0.0,
  })
  .key("longitude", "d", {
    default: 0.0,
  })
  .key("auto-location", "b", {
    default: false,
    summary: "Automatically detect location for weather"
  })

export const generalSchema = new Schema({
  id: id + ".general",
  path: path + "general/"
})
  .key("color-scheme", "i", {
    default: 0,
  })
  .key("wallpaper-day", "s", {
    default: `${datadir}/shade-shell/wp-day.jpg`,
  })
  .key("wallpaper-night", "s", {
    default: `${datadir}/shade-shell/wp-night.jpg`,
  })
  .key("timezones", "as", {
    default: ["America/Sao_Paulo", "Australia/Sydney"],
    summary: "List of IANA timezone identifiers for the world clock"
  })
  .key("night-light-enabled", "b", {
    default: false,
    summary: "Enable blue light filter (hyprsunset)"
  })
  .key("night-light-temperature", "i", {
    default: 3500,
    summary: "Night light color temperature in Kelvin (2000-6500)"
  })
  .key("night-light-auto-schedule", "b", {
    default: false,
    summary: "Automatically enable night light at sunset and disable at sunrise"
  })
  .key("auto-lock-enabled", "b", {
    default: true,
    summary: "Automatically lock screen after idle timeout"
  })
  .key("idle-timeout", "i", {
    default: 300,
    summary: "Idle time in seconds before auto-lock (60-1800)"
  })
  .key("screen-dim-enabled", "b", {
    default: true,
    summary: "Dim screen before auto-lock"
  })
  .key("screen-dim-timeout", "i", {
    default: 240,
    summary: "Seconds before lock to dim screen (must be less than idle-timeout)"
  })
  .key("notification-history-limit", "i", {
    default: 100,
    summary: "Maximum number of notifications to keep in history"
  })
  .key("notification-show-progress", "b", {
    default: true,
    summary: "Show countdown progress bar on notification popups"
  })
  .key("notification-ignored-apps", "as", {
    default: [],
    summary: "List of app names to ignore for notifications"
  })
  .key("dynamic-theming-enabled", "b", {
    default: false,
    summary: "Extract accent colors from wallpaper using matugen"
  })
  .key("cava-enabled", "b", {
    default: false,
    summary: "Show CAVA audio visualizer in media expander"
  })
  .key("cava-bars", "i", {
    default: 16,
    summary: "Number of CAVA visualizer bars (8-32)"
  })
  .key("cava-framerate", "i", {
    default: 60,
    summary: "CAVA visualizer framerate"
  })

export default defineSchemaList([barSchema, generalSchema, weatherSchema])
