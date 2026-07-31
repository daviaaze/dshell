import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import Touchpad from '@shade/services/input/touchpad';

export default () => {
    const touchpad = Touchpad.get_default();

    return (
        <Gtk.Box spacing={8}>
            <Gtk.Image
                iconName={bind(touchpad, 'enabled').as(enabled =>
                    enabled
                        ? 'input-touchpad-symbolic'
                        : 'touchpad-disabled-symbolic'
                )}
                pixelSize={20}
            />
            <Gtk.Label
                hexpand
                cssClasses={['heading']}
                label={bind(touchpad, 'enabled').as(enabled =>
                    enabled ? 'Touchpad On' : 'Touchpad Off'
                )}
            />
        </Gtk.Box>
    );
};
