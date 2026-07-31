import Touchpad from '@shade/services/input/touchpad';
import {bind} from 'gnim';
import {bus} from '@shade/services/bus';
import type {QuickButton} from './quickButton';
import {QuickToggleButton} from '../../common/quickToggleButton';

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
                onClick={() => bus.emit('input:touchpad:toggle')}
            />
        ),
    };
};
