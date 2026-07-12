import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {connectFor} from '#/lib/core/connectFor';

const TIMEOUT_MS = 2000;

export default ({
    widget,
    connectable,
    signals,
}: {
    widget: GObject.Object;
    connectable: GObject.Object;
    signals: string[];
}) => (
    <Gtk.Revealer
        transitionDuration={200}
        revealChild={false}
        visible={false}
        transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
        $={self => {
            let timeoutId: number | null = null;
            let visibilityTimeoutId: number | null = null;
            const showPopup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                if (visibilityTimeoutId) clearTimeout(visibilityTimeoutId);
                self.visible = true;
                self.revealChild = true;
                timeoutId = setTimeout(() => {
                    self.revealChild = false;
                    // eslint-disable-next-line sonarjs/no-nested-functions
                    visibilityTimeoutId = setTimeout(
                        () => (self.visible = false),
                        200
                    );
                }, TIMEOUT_MS);
            };
            // Defer signal connections so OSD widget creation doesn't block
            // the main thread with Wireplumber/Brightness singleton init.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                for (const signal of signals) {
                    connectFor(self, connectable, signal, showPopup);
                }
                return GLib.SOURCE_REMOVE;
            });
        }}
    >
        {widget}
    </Gtk.Revealer>
);
