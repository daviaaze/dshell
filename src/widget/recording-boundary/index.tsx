import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Cairo from 'gi://cairo?version=1.0';
import {createBinding, onCleanup} from 'gnim';
import {app} from '#/App';
import {monitors} from '#/lib/monitors';
import Screenshot, {BoundaryGeometry} from '#/lib/screenshot';
import {getScreenCaptureSettings} from '#/lib/screenCaptureSettings';
import {toArray} from '#/lib/gjsUtils';

/** Check if two rectangles overlap */
function rectsOverlap(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number
): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * For a single monitor, draw the portion of the boundary border
 * that falls within this monitor's coordinate space.
 */
function drawBoundaryForMonitor(
    cr: Cairo.Context,
    monitor: Gdk.Monitor,
    geometry: BoundaryGeometry,
    color: {r: number; g: number; b: number; a: number},
    borderWidth: number
) {
    const monGeom = monitor.geometry;
    const mx = monGeom.x;
    const my = monGeom.y;
    const mw = monGeom.width;
    const mh = monGeom.height;

    // If geometry doesn't overlap this monitor at all, skip
    if (
        !rectsOverlap(
            geometry.x,
            geometry.y,
            geometry.width,
            geometry.height,
            mx,
            my,
            mw,
            mh
        )
    ) {
        return;
    }

    // Clip drawing to monitor area
    // The DrawingArea is sized to the monitor, so coordinates are relative to 0,0
    // We need to translate geometry into monitor-local coordinates
    const localX = geometry.x - mx;
    const localY = geometry.y - my;
    const localW = geometry.width;
    const localH = geometry.height;

    cr.setSourceRGBA(color.r, color.g, color.b, color.a);
    cr.setLineWidth(borderWidth);
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

export default () => {
    const ss = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();

    // Parse boundary color from settings (format: "#FF0000")
    const parseColor = (
        hex: string
    ): {r: number; g: number; b: number; a: number} => {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16) / 255;
        const g = parseInt(h.substring(2, 4), 16) / 255;
        const b = parseInt(h.substring(4, 6), 16) / 255;
        return {r, g, b, a: 1.0};
    };

    const defaultColor = parseColor(captureSettings.recordingBoundaryColor());
    const BORDER_WIDTH = 3;

    const monList = toArray<Gdk.Monitor>(monitors);

    return monList.map((monitor: Gdk.Monitor) => (
        <Astal.Window
            $={self => {
                onCleanup(() => self.destroy());
            }}
            gdkmonitor={monitor}
            application={app}
            layer={Astal.Layer.OVERLAY}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.RIGHT |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT
            }
            exclusivity={Astal.Exclusivity.IGNORE}
            visible={createBinding(ss, 'boundary-visible')}
            css={'background-color: transparent;'}
        >
            <Gtk.DrawingArea
                $={self => {
                    self.set_draw_func((_area, cr, _w, _h) => {
                        if (!ss.boundaryGeometry) return;
                        const geom =
                            ss.boundaryGeometry as BoundaryGeometry;
                        drawBoundaryForMonitor(
                            cr,
                            monitor,
                            geom,
                            defaultColor,
                            BORDER_WIDTH
                        );
                    });
                }}
                hexpand
                vexpand
            />
        </Astal.Window>
    ));
};
