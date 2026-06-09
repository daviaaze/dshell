import GLib from "gi://GLib?version=2.0"
import logger from "#/lib/logger"

export interface NmcliNetwork {
  inUse: boolean
  bssid: string
  ssid: string
  signal: number
  security: string
  saved: boolean
}

/** Run nmcli and return parsed access points. Bypasses GJS NM bindings to avoid
 *  corrupted NM access-point C objects that cause SIGSEGV on some systems. */
export function listNetworks(): NmcliNetwork[] {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync(
      "nmcli -t -f IN-USE,BSSID,SSID,SIGNAL,SECURITY device wifi list",
    )
    if (!ok || !stdout) return []

    const text = new TextDecoder().decode(stdout).trim()
    if (!text) return []

    return text.split("\n").map((line) => {
      const [inUse, bssid, ssid, signal, security] = line.split(":", 5)
      return {
        inUse: inUse === "*",
        bssid: bssid || "",
        ssid: (ssid || "").replace(/\\\\:/g, ":"),
        signal: parseInt(signal) || 0,
        security: security || "--",
        saved: false,
      }
    }).filter((ap) => ap.ssid !== "")
  } catch (e) {
    logger.error("nmcli", "listNetworks failed:", e)
    return []
  }
}

/** Trigger a WiFi scan via nmcli. */
export function scan(): void {
  try {
    GLib.spawn_command_line_async("nmcli device wifi rescan")
  } catch (e) {
    logger.error("nmcli", "scan failed:", e)
  }
}

/** Connect to a network via nmcli. Returns true on success. */
export function connect(ssid: string, password?: string): boolean {
  try {
    const args = ["device", "wifi", "connect", ssid]
    if (password) args.push("password", password)
    const [ok] = GLib.spawn_command_line_sync(
      `nmcli ${args.map((a) => JSON.stringify(a)).join(" ")}`,
    )
    if (!ok) return false
    return true
  } catch (e) {
    logger.error("nmcli", "connect failed:", e)
    return false
  }
}

/** Forget a saved network via nmcli. */
export function forget(ssid: string): boolean {
  try {
    const [ok] = GLib.spawn_command_line_sync(
      `nmcli connection delete id ${JSON.stringify(ssid)}`,
    )
    if (!ok) return false
    return true
  } catch (e) {
    logger.error("nmcli", "forget failed:", e)
    return false
  }
}
