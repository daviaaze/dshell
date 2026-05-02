import GLib from "gi://GLib?version=2.0"

const formatTime = () => GLib.DateTime.new_now_local().format("%H:%M:%S.%f") || "?"

const prefix = "[Shade]"

export const logger = {
  log: (...args: unknown[]) => print(`${prefix} ${formatTime()} -`, ...args),
  warn: (...args: unknown[]) => console.warn(`${prefix} ${formatTime()} -`, ...args),
  error: (...args: unknown[]) => console.error(`${prefix} ${formatTime()} -`, ...args),
}

export default logger
