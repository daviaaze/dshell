import Gtk from 'gi://Gtk?version=4.0';
import KeyboardLayout from '@shade/services/input/keyboard';
import {bind} from 'gnim';

export default () => {
    const keyboard = KeyboardLayout.get_default();

    return (
        <Gtk.Button
            visible={bind(keyboard, 'available')}
            cssClasses={['flat']}
            label={bind(keyboard, 'layout')}
            onClicked={() => keyboard.cycle()}
            tooltipMarkup={bind(keyboard, 'layout').as(
                (l) => `Keyboard layout: ${l}\nClick to cycle`
            )}
        />
    );
};
