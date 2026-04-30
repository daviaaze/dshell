import GLib from "gi://GLib?version=2.0"

export function fmtOffset(local: GLib.TimeZone, remote: GLib.TimeZone): string {
  const now = GLib.DateTime.new_now(local)
  const remoteNow = now.to_timezone(remote)
  const localOffset = now.get_utc_offset() / GLib.TIME_SPAN_HOUR
  const remoteOffset = remoteNow.get_utc_offset() / GLib.TIME_SPAN_HOUR
  const diff = remoteOffset - localOffset
  if (diff === 0) return "same time"
  const sign = diff > 0 ? "+" : ""
  return `${sign}${diff.toFixed(0)}h`
}

export function cityName(tzId: string): string {
  return tzId.split("/").pop()?.replaceAll("_", " ") ?? tzId
}
