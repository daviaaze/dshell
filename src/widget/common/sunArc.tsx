import Cairo from 'gi://cairo?version=1.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, createComputed} from 'gnim';

const SUN_ARC_HEIGHT = 100;
const SUN_ARC_WIDTH = 280;

interface SunArcProps {
    sunrise: Accessor<number>;
    sunset: Accessor<number>;
    now: Accessor<number>;
    /** Moon phase at night (null during day) */
    moonPhase?: Accessor<{
        phase: number;
        phaseName: string;
        phaseEmoji: string;
    } | null>;
}

export const SunArc = ({sunrise, sunset, now, moonPhase}: SunArcProps) => {
    const draw = (
        _area: Gtk.DrawingArea,
        cr: Cairo.Context,
        w: number,
        h: number
    ) => {
        const sr = sunrise();
        const ss = sunset();
        const n = now();
        const moon = moonPhase?.();

        // Handle invalid/unset timestamps (initial loading)
        if (!sr || !ss || sr <= 0 || ss <= 0) {
            return;
        }

        const isDay = n >= sr && n <= ss;
        const dayLength = ss - sr;
        const fraction = dayLength > 0 ? (n - sr) / dayLength : 0;

        // Layout: circular arc centered at (cx, cy), radius = r
        // Arc spans left (π) → top → right (2π), i.e. a semicircle above the horizon
        const pad = 16;
        const arcW = w - pad * 2;
        const cx = w / 2;
        const cy = h * 0.82;
        const r = Math.min(arcW / 2, cy - 6); // radius: fit width AND stay within widget

        // ── Arc and horizon (day only) ──
        if (isDay) {
            // ── Background fill below the arc (ground area) ──
            cr.arc(cx, cy, r, Math.PI, 2 * Math.PI);
            cr.closePath();
            cr.setSourceRGBA(1.0, 0.65, 0.2, 0.12);
            cr.fill();

            // ── Arc line ──
            cr.arc(cx, cy, r, Math.PI, 2 * Math.PI);
            cr.setSourceRGBA(1, 1, 1, 0.4);
            cr.setLineWidth(1.5);
            cr.stroke();

            // ── Horizon line ──
            cr.moveTo(cx - r, cy);
            cr.lineTo(cx + r, cy);
            cr.setSourceRGBA(1, 1, 1, 0.15);
            cr.setLineWidth(1);
            cr.stroke();
        }

        // ── Sun position dot (day only) ──
        if (isDay && fraction >= 0 && fraction <= 1) {
            const angle = Math.PI - fraction * Math.PI; // PI=sunrise (left), 0=sunset (right)
            const sx = cx + r * Math.cos(angle);
            const sy = cy - r * Math.sin(angle);

            // Glow
            cr.arc(sx, sy, 10, 0, 2 * Math.PI);
            cr.setSourceRGBA(1.0, 0.7, 0.1, 0.2);
            cr.fill();

            // Sun dot
            cr.arc(sx, sy, 5, 0, 2 * Math.PI);
            cr.setSourceRGBA(1.0, 0.8, 0.1, 1.0);
            cr.fill();
        }

        // ── Sunrise time label (left of arc) ──
        const sunriseLabel = formatTimeShort(sr);
        cr.selectFontFace(
            'sans-serif',
            Cairo.FontSlant.NORMAL,
            Cairo.FontWeight.NORMAL
        );
        cr.setFontSize(9);
        cr.setSourceRGBA(1, 1, 1, 0.7);

        cr.moveTo(cx - r + 2, cy + 12);
        cr.showText(sunriseLabel);

        // Sunrise dot
        cr.arc(cx - r + 2, cy + 12 - 4, 2, 0, 2 * Math.PI);
        cr.setSourceRGBA(1.0, 0.6, 0.1, 0.7);
        cr.fill();

        // ── Sunset time label (right of arc) ──
        const sunsetLabel = formatTimeShort(ss);
        const extents = cr.textExtents(sunsetLabel);
        cr.setSourceRGBA(1, 1, 1, 0.7);
        cr.moveTo(cx + r - 2 - extents.x_advance, cy + 12);
        cr.showText(sunsetLabel);

        // Sunset dot
        cr.arc(cx + r - 2, cy + 12 - 4, 2, 0, 2 * Math.PI);
        cr.setSourceRGBA(0.8, 0.3, 0.1, 0.7);
        cr.fill();

        // ── Bottom info: day or night ──
        if (isDay) {
            // Daylight count
            if (dayLength > 0) {
                const hours = Math.floor(dayLength / 3600);
                const minutes = Math.floor((dayLength % 3600) / 60);
                const label = `Daylight: ${hours}h ${minutes}m`;
                cr.setFontSize(8);
                cr.setSourceRGBA(1, 1, 1, 0.5);
                const ext3 = cr.textExtents(label);
                cr.moveTo(cx - ext3.x_advance / 2, h - 4);
                cr.showText(label);
            }
        } else {
            // Night: show moon info (if available) + sunrise countdown
            const nextSunrise = sr + 86400; // approx same time tomorrow
            const secsUntilSunrise = Math.max(0, nextSunrise - n);
            const hrs = Math.floor(secsUntilSunrise / 3600);
            const mins = Math.floor((secsUntilSunrise % 3600) / 60);

            // Moon phase or generic moon icon
            cr.setFontSize(10);
            cr.setSourceRGBA(1, 1, 1, 0.6);
            const moonLabel = moon
                ? `${moon.phaseEmoji} ${moon.phaseName}`
                : '🌙 Night';
            const ext3 = cr.textExtents(moonLabel);
            cr.moveTo(cx - ext3.x_advance / 2, h - 14);
            cr.showText(moonLabel);

            // Sunrise countdown (always show)
            cr.setFontSize(8);
            cr.setSourceRGBA(1, 1, 1, 0.4);
            const countdown = (() => {
                if (hrs > 0) return `Sunrise in ${hrs}h ${mins}m`;
                if (secsUntilSunrise > 0) return `Sunrise in ${secsUntilSunrise}s`;
                return 'Sunrise now?';
            })();
            const ext4 = cr.textExtents(countdown);
            cr.moveTo(cx - ext4.x_advance / 2, h - 2);
            cr.showText(countdown);
        }
    };

    const area = (
        <Gtk.DrawingArea hexpand heightRequest={SUN_ARC_HEIGHT} widthRequest={SUN_ARC_WIDTH} />
    ) as Gtk.DrawingArea;

    area.set_draw_func(draw);

    // Queue redraw when dependencies change
    createComputed(() => {
        sunrise();
        sunset();
        now();
        area.queue_draw();
    });

    return area;
};

function formatTimeShort(unixTs: number): string {
    const dt = GLib.DateTime.new_from_unix_local(unixTs);
    return dt.format('%H:%M') ?? '--:--';
}
