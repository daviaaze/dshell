import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {connectFor} from '../../lib/core/connectFor';
import {JSX} from 'gnim';

const TIMEOUT_MS = 2000;
export default ({
    widget,
    connectable,
    signals,
    revealerRef,
}: {
    widget: JSX.Element;
    connectable: GObject.Object | null;
    signals: string[];
    revealerRef?: (revealer: Gtk.Revealer) => void;
}) => (
    <Gtk.Revealer
        transitionDuration={200}
        revealChild={false}
        visible={false}
        transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
        ref={self => {
            revealerRef?.(self);
            let timeout: GLib.Source | null = null;
            let visibilityTimeout: GLib.Source | null = null;
            const hide = () => {
                self.visible = false;
            };

            const showPopup = () => {
                if (timeout) clearTimeout(timeout);
                if (visibilityTimeout) clearTimeout(visibilityTimeout);
                self.visible = true;
                self.revealChild = true;
                timeout = setTimeout(() => {
                    self.revealChild = false;
                    visibilityTimeout = setTimeout(hide, 200);
                }, TIMEOUT_MS);
            };
            // Defer signal connections so OSD widget creation doesn't block
            // the main thread with Wireplumber/Brightness singleton init.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!connectable) return GLib.SOURCE_REMOVE;
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
