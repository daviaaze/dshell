import GLib from 'gi://GLib?version=2.0';

export function fmtOffset(local: GLib.TimeZone, remote: GLib.TimeZone): string {
    const now = GLib.DateTime.new_now(local)!;
    const remoteNow = now.to_timezone(remote);
    const localOffset =
        Number(now.get_utc_offset()) / Number(GLib.TIME_SPAN_HOUR);
    const remoteOffset = remoteNow
        ? Number(remoteNow.get_utc_offset()) / Number(GLib.TIME_SPAN_HOUR)
        : 0;
    const diff = remoteOffset - localOffset;
    if (diff === 0) return 'same time';
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(0)}h`;
}

export function cityName(tzId: string): string {
    return tzId.split('/').pop()?.replaceAll('_', ' ') ?? tzId;
}

/** Relative age of a unix timestamp (e.g. "now", "42s ago", "5m ago"). */
export function relativeTime(unix: number): string {
    const now = GLib.DateTime.new_now_local()!;
    const then = GLib.DateTime.new_from_unix_local(unix)!;
    const diff = now.difference(then);
    const seconds = Number(diff.valueOf()) / 1_000_000;

    if (seconds < 10) return 'now';
    if (seconds < 60) return `${Math.floor(seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/** Wall-clock time of a unix timestamp ("%H:%M:%S"). */
export function fullTimestamp(unix: number): string {
    return (
        GLib.DateTime.new_from_unix_local(unix)!.format('%H:%M:%S') || 'ERROR'
    );
}

/** Format milliseconds as a human-readable duration (e.g. "1:05:30", "5:00"). */
export function fmtDuration(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0)
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
