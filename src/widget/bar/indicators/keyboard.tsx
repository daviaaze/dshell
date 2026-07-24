import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import KeyboardLayout from '#/lib/services/input/keyboard';

export default () => {
    const keyboard = KeyboardLayout.get_default();

    return (
        <Gtk.Button
            visible={bind(keyboard, 'available')}
            cssClasses={['flat']}
            label={bind(keyboard, 'layout')}
            onClicked={() => keyboard.cycle()}
            tooltipMarkup={bind(keyboard, 'layout').as(
                l => `Keyboard layout: ${l}\nClick to cycle`
            )}
        />
    );
};