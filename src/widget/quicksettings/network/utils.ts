import Network from "gi://AstalNetwork"

export function bytesToString(value: any): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (value instanceof Uint8Array) {
    let len = value.length
    for (let i = 0; i < value.length; i++) {
      if (value[i] === 0) {
        len = i
        break
      }
    }
    if (len === 0) return ""
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(
        value.subarray(0, len),
      )
    } catch {
      return null
    }
  }
  if (typeof value.toString === "function") {
    const str = value.toString()
    if (str && !str.startsWith("[object ")) return str
  }
  return null
}

export function ssidOf(ap: Network.AccessPoint): string {
  return bytesToString(ap.ssid) ?? "Hidden Network"
}

export function bssidOf(ap: Network.AccessPoint): string | null {
  return bytesToString(ap.bssid)
}

export function bssidEquals(a: any, b: any): boolean {
  const sa = bytesToString(a)
  const sb = bytesToString(b)
  if (sa === null || sb === null) return false
  return sa.toLowerCase() === sb.toLowerCase()
}
