import GLib from 'gi://GLib?version=2.0';

// ── Format helpers ───────────────────────────────────────────────────────

/** Format GLib unix timestamp → "06:12" */
export function formatTime(unixTs: number): string {
    const dt = GLib.DateTime.new_from_unix_local(unixTs)!;
    return dt.format('%H:%M') ?? '--:--';
}

/** Format temperature with degree symbol, e.g. 24 → "24°" */
export function formatTemp(celsius: number): string {
    return `${Math.round(celsius)}°`;
}

// ── Wind direction ───────────────────────────────────────────────────────
// GWeatherWindDirection enum: INVALID=-1, VARIABLE=0, N=1, NNE=2, ..., NNW=16
// https://gjs-docs.gnome.org/gweather40~4.0/gweather.winddirection

const WIND_DIRS = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
];

export function windDirectionLabel(windEnum: number): string {
    if (windEnum <= 0) return '—'; // INVALID (-1) or VARIABLE (0)
    if (windEnum >= 1 && windEnum <= 16) return WIND_DIRS[windEnum - 1];
    return '—';
}

// ── Sun position ─────────────────────────────────────────────────────────

/**
 * Returns the sine of the daylight fraction (0 at sunrise/sunset, 1 at noon).
 * Returns -1 if `now` is outside daylight hours or if sunrise/sunset are invalid.
 */
export function sunAngle(sunrise: number, sunset: number, now: number): number {
    if (sunrise <= 0 || sunset <= 0) return -1;
    const dayLength = sunset - sunrise;
    if (dayLength <= 0) return -1;
    const elapsed = now - sunrise;
    if (elapsed < 0 || elapsed > dayLength) return -1; // before sunrise or after sunset
    // Map to semicircle: 0→π where 0=sunrise, π=sunset
    const fraction = elapsed / dayLength;
    return Math.sin(Math.PI * fraction); // 0 at edges, 1 at noon
}

/** Check if currently within daylight hours */
export function isDaytime(
    sunrise: number,
    sunset: number,
    now: number
): boolean {
    return now >= sunrise && now <= sunset;
}
