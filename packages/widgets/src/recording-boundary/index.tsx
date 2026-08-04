import Astal from 'gi://Astal?version=4.0';
import type Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {toArray} from '@shade/core/gjsUtils';
import {getApp} from '@shade/services/appHandle';
import Screenshot from '@shade/services/capture/screenshot';
import {
    type BoundaryGeometry,
    parseColor,
    visibleBoundaryEdges,
} from '@shade/services/capture/types';
import {monitors} from '@shade/services/monitoring/monitors';
import {getScreenCaptureSettings} from '@shade/services/settings/screenCapture';
import {bind, onCleanup} from 'gnim';

export default () => {
    const ss = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();
    const defaultColor = parseColor(captureSettings.recordingBoundaryColor());
    const BORDER_WIDTH = 3;
    const BORDER_ALPHA = 0.65;
    const monList = toArray<Gdk.Monitor>(monitors.peek());

    const windowRefs: Astal.Window[] = [];
    const windows = monList.map((monitor) => (
        <Astal.Window
            ref={(self) => {
                if (self) windowRefs.push(self);
            }}
            application={getApp()}
            gdkmonitor={monitor}
            layer={Astal.Layer.OVERLAY}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.RIGHT |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT
            }
            exclusivity={Astal.Exclusivity.IGNORE}
            visible={bind(ss, 'boundaryVisible')}
        >
            <Gtk.DrawingArea
                hexpand
                vexpand
                ref={(self) => {
                    self.set_draw_func((_area, cr, _w, _h) => {
                        if (!ss.boundaryGeometry) return;
                        const geom = ss.boundaryGeometry as BoundaryGeometry;
                        const edges = visibleBoundaryEdges(geom, monitor.geometry);
                        if (edges.length === 0) return;

                        cr.setSourceRGBA(
                            defaultColor.r,
                            defaultColor.g,
                            defaultColor.b,
                            BORDER_ALPHA
                        );
                        cr.setLineWidth(BORDER_WIDTH);
                        cr.setDash([8, 4], 0);
                        cr.setLineCap(2); // Cairo.LineCap.SQUARE
                        for (const e of edges) {
                            cr.moveTo(e.x1, e.y1);
                            cr.lineTo(e.x2, e.y2);
                        }
                        cr.stroke();
                    });
                }}
            />
        </Astal.Window>
    ));

    onCleanup(() => {
        for (const w of windowRefs) {
            w.close();
        }
    });

    return windows;
};
