import GLib from 'gi://GLib?version=2.0';

// comply-allow-file: theme/hardcoded-color — weather-condition gradients are
// content imagery (like icons), not theme chrome; they must not follow --shade-*

// ── Condition → CSS gradient background ──────────────────────────────────
// Uses GWeather icon names (non-localized, consistent):
//   weather-clear, weather-few-clouds, weather-scattered-clouds,
//   weather-overcast, weather-showers, weather-storm, weather-snow, weather-fog

function conditionGradient(iconName: string): string {
    if (iconName.includes('storm') || iconName.includes('thunder'))
        return 'linear-gradient(135deg, #0f0f1a 0%, #2d1b4e 50%, #4a1942 100%)';
    if (iconName.includes('snow') || iconName.includes('sleet'))
        return 'linear-gradient(135deg, #dfe6e9 0%, #b2bec3 50%, #636e72 100%)';
    if (iconName.includes('shower') || iconName.includes('rain'))
        return 'linear-gradient(135deg, #1e272e 0%, #57606f 50%, #747d8c 100%)';
    if (
        iconName.includes('fog') ||
        iconName.includes('mist') ||
        iconName.includes('haze')
    )
        return 'linear-gradient(135deg, #636e72 0%, #b2bec3 100%)';
    if (iconName.includes('overcast') || iconName.includes('cloudy'))
        return 'linear-gradient(135deg, #1e272e 0%, #485460 100%)';
    if (iconName.includes('scattered'))
        return 'linear-gradient(135deg, #353b48 0%, #636e72 100%)';
    if (iconName.includes('few-clouds'))
        return 'linear-gradient(135deg, #2c3e50 0%, #5b86e5 40%, #b0c4de 100%)';
    // Clear / default
    return 'linear-gradient(135deg, #1e3a5f 0%, #4a90d9 50%, #87ceeb 100%)';
}

function conditionGradientNight(iconName: string): string {
    if (iconName.includes('storm') || iconName.includes('thunder'))
        return 'linear-gradient(135deg, #080811 0%, #1a0f2e 50%, #2e0f2a 100%)';
    if (iconName.includes('snow') || iconName.includes('sleet'))
        return 'linear-gradient(135deg, #2d3436 0%, #485460 50%, #636e72 100%)';
    if (iconName.includes('shower') || iconName.includes('rain'))
        return 'linear-gradient(135deg, #0f111a 0%, #2d3436 100%)';
    if (iconName.includes('fog') || iconName.includes('mist'))
        return 'linear-gradient(135deg, #2d3436 0%, #485460 100%)';
    if (iconName.includes('overcast') || iconName.includes('cloudy'))
        return 'linear-gradient(135deg, #0f111a 0%, #1e272e 100%)';
    if (iconName.includes('scattered') || iconName.includes('few'))
        return 'linear-gradient(135deg, #1a1a2e 0%, #2d3561 100%)';
    // Clear night / default
    return 'linear-gradient(135deg, #0c0c1a 0%, #1a1a3e 50%, #2d3561 100%)';
}

export function weatherGradient(iconName: string): string {
    if (iconName.includes('night')) return conditionGradientNight(iconName);
    return conditionGradient(iconName);
}

// ── Format helpers ───────────────────────────────────────────────────────

/** Format GLib unix timestamp → "06:12" */
export function formatTime(unixTs: number): string {
    const dt = GLib.DateTime.new_from_unix_local(unixTs);
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
