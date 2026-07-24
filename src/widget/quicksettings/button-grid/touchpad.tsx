import Gtk from 'gi://Gtk?version=4.0';
import Touchpad from '#/lib/services/input/touchpad';
import {bind} from 'gnim';
import type {QuickButton} from '#/widget/quicksettings/button-grid/quickButton';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';

export default (): QuickButton => {
    const touchpad = Touchpad.get_default();

    return {
        widget: (
            <QuickToggleButton
                icon={bind(touchpad, 'enabled').as(enabled =>
                    enabled
                        ? 'input-touchpad-symbolic'
                        : 'touchpad-disabled-symbolic'
                )}
                label={bind(touchpad, 'enabled').as(enabled =>
                    enabled ? 'Touchpad' : 'Touchpad Off'
                )}
                onClick={() => touchpad.toggle()}
            />
        ) as unknown as Gtk.Widget,
    };
};
