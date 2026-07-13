import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Cairo from 'gi://cairo?version=1.0';
import {createBinding, onCleanup} from 'gnim';
import {app} from '#/App';
import {monitors} from '#/lib/services/monitoring/monitors';
import Screenshot, {BoundaryGeometry} from '#/lib/services/capture/screenshot';
import {getScreenCaptureSettings} from '#/lib/settings/screenCapture';
import {toArray} from '#/lib/core/gjsUtils';

/** Check if two rectangles overlap */
function rectOverlap(
    x1: number,
    y1: number,
    w1: number,
    h1: number,
    x2: number,
    y2: number,
    w2: number,
    h2: number
): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

/**
 * For a single monitor, draw the portion of the boundary border
 * that is visible on that monitor.
 */
function drawBoundaryForMonitor(
    cr: Cairo.Context,
    monitor: Gdk.Monitor,
    geom: BoundaryGeometry,
    color: {r: number; g: number; b: number; a: number},
    borderWidth: number
): void {
    const geo = monitor.geometry;
    const mx = geo.x;
    const my = geo.y;
    const mw = geo.width;
    const mh = geo.height;

    // Check if boundary overlaps this monitor
    if (
        !rectOverlap(
            geom.x,
            geom.y,
            geom.width,
            geom.height,
            mx,
            my,
            mw,
            mh
        )
    ) {
        return;
    }

    // Clamp the boundary to the monitor's coordinate space
    const localX = geom.x - mx;
    const localY = geom.y - my;
    const localW = geom.width;
    const localH = geom.height;

    cr.setSourceRGBA(color.r, color.g, color.b, 0.65);
    cr.setLineWidth(borderWidth);
    cr.setDash([8, 4], 0);
    cr.setLineCap(Cairo.LineCap.SQUARE);

    // Only draw the visible portion of each border edge
    // Top edge
    if (localY >= 0 && localY < mh) {
        const startX = Math.max(0, localX);
        const endX = Math.min(mw, localX + localW);
        cr.moveTo(startX, localY);
        cr.lineTo(endX, localY);
    }
    // Bottom edge
    if (localY + localH >= 0 && localY + localH < mh) {
        const startX = Math.max(0, localX);
        const endX = Math.min(mw, localX + localW);
        cr.moveTo(startX, localY + localH);
        cr.lineTo(endX, localY + localH);
    }
    // Left edge
    if (localX >= 0 && localX < mw) {
        const startY = Math.max(0, localY);
        const endY = Math.min(mh, localY + localH);
        cr.moveTo(localX, startY);
        cr.lineTo(localX, endY);
    }
    // Right edge
    if (localX + localW >= 0 && localX + localW < mw) {
        const startY = Math.max(0, localY);
        const endY = Math.min(mh, localY + localH);
        cr.moveTo(localX + localW, startY);
        cr.lineTo(localX + localW, endY);
    }

    cr.stroke();
}

const parseColor = (
    hex: string
): {r: number; g: number; b: number; a: number} => {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;
    return {r, g, b, a: 1.0};
};

export default () => {
    const ss = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();
    const defaultColor = parseColor(captureSettings.recordingBoundaryColor());
    const BORDER_WIDTH = 3;
    const monList = toArray<Gdk.Monitor>(monitors.peek());

    const windows: Astal.Window[] = [];

    for (const monitor of monList) {
        const drawingArea = (
            <Gtk.DrawingArea
                hexpand
                vexpand
                $={self => {
                    self.set_draw_func((_area, cr, _w, _h) => {
                        if (!ss.boundaryGeometry) return;
                        const geom = ss.boundaryGeometry as BoundaryGeometry;
                        drawBoundaryForMonitor(
                            cr,
                            monitor,
                            geom,
                            defaultColor,
                            BORDER_WIDTH
                        );
                    });
                }}
            />
        );

        const win = (
            <Astal.Window
                application={app}
                gdkmonitor={monitor}
                layer={Astal.Layer.OVERLAY}
                anchor={
                    Astal.WindowAnchor.TOP |
                    Astal.WindowAnchor.RIGHT |
                    Astal.WindowAnchor.BOTTOM |
                    Astal.WindowAnchor.LEFT
                }
                exclusivity={Astal.Exclusivity.IGNORE}
                visible={createBinding(ss, 'boundary-visible')}
            >
                {drawingArea}
            </Astal.Window>
        );

        windows.push(win);
    }

    onCleanup(() => {
        for (const w of windows) w.destroy();
    });

    return null;
};