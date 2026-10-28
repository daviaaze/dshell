import type Gdk from 'gi://Gdk?version=4.0';
import type Cairo from 'gi://cairo?version=1.0';

const GRID_LINES = 3;

export interface UsageGraphData {
    /** Main series, oldest first; drawn as a filled line. */
    primary: number[];
    /** Optional second series on the same scale; drawn dashed. */
    secondary: number[];
    /** Number of slots in the full window; series are right-aligned in it. */
    capacity: number;
    /** Fixed vertical scale (e.g. 1 for fractions); auto-scales when omitted. */
    max?: number;
}

/**
 * Draw a right-aligned sparkline with a faint grid. `color` is normally the
 * widget's CSS foreground, so theme classes (accent/success/…) pick the hue.
 */
export function drawUsageGraph(
    cr: Cairo.Context,
    width: number,
    height: number,
    color: Gdk.RGBA,
    {primary, secondary, capacity, max}: UsageGraphData
): void {
    const scale = max ?? Math.max(1, ...primary, ...secondary) * 1.1;
    drawGrid(cr, width, height, color);
    drawSeries(cr, primary, capacity, scale, width, height, color, false);
    if (secondary.length > 0)
        drawSeries(cr, secondary, capacity, scale, width, height, color, true);
}

function drawGrid(cr: Cairo.Context, width: number, height: number, color: Gdk.RGBA) {
    cr.setSourceRGBA(color.red, color.green, color.blue, 0.12);
    cr.setLineWidth(1);
    for (let i = 1; i <= GRID_LINES; i++) {
        const y = Math.round((height * i) / (GRID_LINES + 1)) + 0.5;
        cr.moveTo(0, y);
        cr.lineTo(width, y);
    }
    cr.stroke();
}

function drawSeries(
    cr: Cairo.Context,
    samples: number[],
    capacity: number,
    scale: number,
    width: number,
    height: number,
    color: Gdk.RGBA,
    dashed: boolean
) {
    if (samples.length < 2) return;
    const step = width / Math.max(1, capacity - 1);
    const startX = width - (samples.length - 1) * step;
    const yOf = (v: number) => height - Math.min(1, Math.max(0, v / scale)) * (height - 2) - 1;

    cr.moveTo(startX, yOf(samples[0]));
    for (let i = 1; i < samples.length; i++) cr.lineTo(startX + i * step, yOf(samples[i]));

    if (!dashed) {
        cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
        cr.setLineWidth(2);
        cr.setDash([], 0);
        cr.strokePreserve();
        cr.lineTo(width, height);
        cr.lineTo(startX, height);
        cr.closePath();
        cr.setSourceRGBA(color.red, color.green, color.blue, 0.18);
        cr.fill();
    } else {
        cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha * 0.8);
        cr.setLineWidth(1.5);
        cr.setDash([4, 3], 0);
        cr.stroke();
        cr.setDash([], 0);
    }
}
