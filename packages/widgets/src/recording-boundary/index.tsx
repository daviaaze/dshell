import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getApp} from '@shade/services/appHandle';
import {setBoundaryInputPassthrough} from '@shade/services/capture/boundaryInput';
import Screenshot from '@shade/services/capture/screenshot';
import {type BoundaryGeometry, visibleBoundaryEdges} from '@shade/services/capture/types';
import {monitors} from '@shade/services/monitoring/monitors';
import {getScreenCaptureSettings} from '@shade/services/settings/screenCapture';
import {bind, For, onCleanup} from 'gnim';

const BORDER_WIDTH = 3;
const BORDER_ALPHA = 0.65;

export default () => {
    const ss = Screenshot.get_default();
    const captureSettings = getScreenCaptureSettings();
    const color = new Gdk.RGBA();

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => (
                <Astal.Window
                    ref={(self) => onCleanup(() => self.close())}
                    application={getApp()}
                    namespace={'shade-recording-boundary'}
                    gdkmonitor={monitor}
                    keymode={Astal.Keymode.NONE}
                    cssClasses={[]}
                    css={'background-color: transparent;'}
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
                            self.connect('map', () => {
                                const surface = self.get_native()?.get_surface();
                                if (surface) setBoundaryInputPassthrough(surface);
                            });
                            // The "Cor do limite" setting applies to a boundary already on screen.
                            onCleanup(
                                captureSettings.recordingBoundaryColor.subscribe(() =>
                                    self.queue_draw()
                                )
                            );
                            self.set_draw_func((_area, cr, _w, _h) => {
                                if (!ss.boundaryGeometry) return;
                                const geom = ss.boundaryGeometry as BoundaryGeometry;
                                const edges = visibleBoundaryEdges(geom, monitor.geometry);
                                if (edges.length === 0) return;

                                color.parse(captureSettings.recordingBoundaryColor());
                                cr.setSourceRGBA(color.red, color.green, color.blue, BORDER_ALPHA);
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
            )}
        </For>
    );
};
