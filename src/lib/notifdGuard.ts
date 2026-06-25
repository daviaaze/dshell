import Gio from "gi://Gio"
import GLib from "gi://GLib?version=2.0"
import Notifd from "gi://AstalNotifd"
import logger from "#/lib/logger"
import { DeferredSingleton } from "#/lib/deferredSingleton"

const NOTIF_BUS_NAME = "org.freedesktop.Notifications"
const NOTIF_OBJECT_PATH = "/org/freedesktop/Notifications"
const NOTIF_IFACE = "org.freedesktop.Notifications"

let _canInit: boolean | null = null

/**
 * Check whether a foreign notification daemon is already running.
 * Result is cached so concurrent callers don't do redundant D-Bus round-trips.
 */
export function canInitNotifd(): boolean {
  if (_canInit !== null) return _canInit
  _canInit = checkNotifdDaemon()
  return _canInit
}

function checkNotifdDaemon(): boolean {
  try {
    const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null)

    const ownerResult = bus.call_sync(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "NameHasOwner",
      new GLib.Variant("(s)", [NOTIF_BUS_NAME]),
      null,
      Gio.DBusCallFlags.NONE,
      200,
      null,
    )

    if (!ownerResult) return true
    const [hasOwner] = ownerResult.deepUnpack()
    if (!hasOwner) return true

    try {
      const infoResult = bus.call_sync(
        NOTIF_BUS_NAME,
        NOTIF_OBJECT_PATH,
        NOTIF_IFACE,
        "GetServerInformation",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        500,
        null,
      )

      if (infoResult) {
        const [name, vendor] = infoResult.deepUnpack()
        if (vendor === "astal") return true
        logger.warn(
          "notifd",
          `Foreign notification daemon "${name}" (${vendor}) detected. ` +
            `Skipping AstalNotifd initialization.`,
        )
        return false
      }
    } catch {
      logger.debug(
        "notifd",
        `Notification daemon at ${NOTIF_BUS_NAME} did not respond. Proceeding.`,
      )
      return true
    }

    return false
  } catch (e) {
    logger.warn(`${e}`)
    return true
  }
}

// ── Singleton ──

const notifdSingleton = new DeferredSingleton<Notifd.Notifd>(
  () => {
    if (!canInitNotifd()) throw new Error("Foreign notification daemon detected")
    return Notifd.get_default()
  },
  (e) => logger.error("notifd", "get_default() failed:", e),
)

/**
 * Safe wrapper around Notifd.get_default() that avoids the 25s D-Bus block.
 * Returns null if a foreign/unresponsive notification daemon is detected.
 *
 * Pre-initialized in widget/index.tsx services-init phase before any widget
 * mounts, so all subsequent callers hit the cache.
 */
export function getNotifdSafe(): Notifd.Notifd | null {
  return notifdSingleton.get()
}
