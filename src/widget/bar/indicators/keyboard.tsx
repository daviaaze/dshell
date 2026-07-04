import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {createState, onMount, onCleanup} from 'gnim';
import KeyboardLayout from '#/lib/keyboard';
import {connectFor, cleanupNode} from '#/lib/connectFor';

export default () => {
    const [layout, setLayout] = createState('');
    const [available, setAvailable] = createState(false);

    onMount(() => {
        const _hn = {};
        // Defer KeyboardLayout D-Bus proxy to avoid blocking the main loop
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const keyboard = KeyboardLayout.get_default();
            setLayout(keyboard.layout);
            setAvailable(keyboard.available);
            connectFor(_hn, keyboard, 'notify::layout', () =>
                setLayout(keyboard.layout)
            );
            connectFor(_hn, keyboard, 'notify::available', () =>
                setAvailable(keyboard.available)
            );
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Button
            visible={available}
            cssClasses={['flat']}
            label={layout}
            onClicked={() => KeyboardLayout.get_default().cycle()}
            tooltipMarkup={layout.as(
                l => `Keyboard layout: ${l}\nClick to cycle`
            )}
        />
    );
};
