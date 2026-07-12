import Touchpad from '#/lib/services/input/touchpad';
import {createBinding} from 'gnim';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';

export default () => {
    const touchpad = Touchpad.get_default();

    return (
        <QuickToggleButton
            icon={createBinding(touchpad, 'enabled').as(enabled =>
                enabled
                    ? 'input-touchpad-symbolic'
                    : 'touchpad-disabled-symbolic'
            )}
            label={createBinding(touchpad, 'enabled').as(enabled =>
                enabled ? 'Touchpad' : 'Touchpad Off'
            )}
            onClick={() => touchpad.toggle()}
        />
    );
};
