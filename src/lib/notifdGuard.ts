import Gio from "gi://Gio"
import GLib from "gi://GLib?version=2.0"
import Notifd from "gi://AstalNotifd"
import logger from "#/lib/logger"

const NOTIF_BUS_NAME = "org.freedesktop.Notifications"
const NOTIF_OBJECT_PATH = "/org/freedesktop/Notifications"
const NOTIF_IFACE = "org.freedesktop.Notifications"

let _canInit: boolean | null = null

/**
 * Check whether a foreign notification daemon is already running.
 *
 * If the bus name is owned and the owner responds to GetServerInformation
 * within a short window, we skip our own daemon registration so we don't
 * block the main loop for 25s (AstalNotifd's default D-Bus timeout).
 *
 * Returns true if we can safely initialize our own Notifd (no foreign
 * daemon, or the foreign daemon is another shade-shell instance we
 * recognise).
 *
 * Result is cached after the first call so that concurrent callers
 * (notifications widget, QS notification list, DnD indicator,
 * NotificationHistory) don't each do redundant D-Bus round-trips.
 */
export function canInitNotifd(): boolean {
  if (_canInit !== null) return _canInit

  _canInit = checkNotifdDaemon()
  return _canInit
}

function checkNotifdDaemon(): boolean {
  try {
    const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null)

    // Quick check: does anyone own the notification bus name?
    const ownerResult = bus.call_sync(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "NameHasOwner",
      new GLib.Variant("(s)", [NOTIF_BUS_NAME]),
      null,
      Gio.DBusCallFlags.NONE,
      200, // 200ms — fast enough to not block noticeably
      null,
    )

    if (!ownerResult) return true // DBus call failed, try anyway
    const [hasOwner] = ownerResult.deepUnpack()
    if (!hasOwner) return true // No owner, safe to proceed

    // Someone owns the name. Check if it's us (stale shade-shell
    // from a previous instance) or a foreign daemon.
    // Try GetServerInformation with a short timeout.
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
        // If the running daemon is from astal/notifd, our own
        // AstalNotifd is already initialized on this or another
        // instance — proceed, get_default() returns the singleton.
        if (vendor === "astal") {
          // Our own AstalNotifd is already initialized — Notifd.get_default()
          // returns the existing singleton immediately, no 25s D-Bus block.
          return true
        }
        // Foreign daemon (dunst, mako, etc.)
        logger.warn(
          "notifd",
          `Foreign notification daemon "${name}" (${vendor}) detected. ` +
            `Skipping AstalNotifd initialization.`,
        )
        return false
      }
    } catch {
      // GetServerInformation timed out — the owner exists but doesn't
      // respond quickly. Could be a proxy daemon, portal, or slow
      // implementation. Don't skip — Notifd.get_default() will proxy
      // to the existing owner rather than block 25s trying to register.
      logger.debug(
        "notifd",
        `Notification daemon at ${NOTIF_BUS_NAME} did not respond to ` +
          `GetServerInformation. Proceeding with Notifd.get_default().`,
      )
      return true
    }

    return false
  } catch (e) {
    // Bus itself might not be available — try anyway
    return true
  }
}

let _notifdResult: Notifd.Notifd | null | undefined = undefined

/**
 * Safe wrapper around Notifd.get_default() that avoids the 25s D-Bus block.
 * Returns null if a foreign/unresponsive notification daemon is detected.
 *
 * Result is cached so that concurrent callers (notifications widget, QS
 * notification list, DnD indicator, NotificationHistory) all share the
 * same Notifd instance and don't each trigger a D-Bus registration attempt.
 */
export function getNotifdSafe(): Notifd.Notifd | null {
  if (_notifdResult !== undefined) return _notifdResult
  if (!canInitNotifd()) {
    _notifdResult = null
    return null
  }
  try {
    _notifdResult = Notifd.get_default()
    return _notifdResult
  } catch (e) {
    logger.error("notifd", "get_default() failed:", e)
    _notifdResult = null
    return null
  }
}
