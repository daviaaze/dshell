import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {createState, onMount, onCleanup} from 'gnim';
import {getNotifdSafe} from '#/lib/services/notifications/guard';
import {connectFor, cleanupNode} from '#/lib/core/connectFor';

export default () => {
    const [visible, setVisible] = createState(false);

    onMount(() => {
        const _hn = {};
        // Defer Notifd initialization — AstalNotifd blocks 25s if another
        // notification daemon (dunst, mako) is already registered.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const notifd = getNotifdSafe();
            if (!notifd) return GLib.SOURCE_REMOVE;
            setVisible(notifd.dontDisturb);
            connectFor(_hn, notifd, 'notify::dontDisturb', () => {
                setVisible(notifd.dontDisturb);
            });
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Image
            visible={visible}
            iconName="notifications-disabled-symbolic"
            pixelSize={18}
        />
    );
};
