import {bus} from '@shade/services/bus';
import Touchpad from '@shade/services/input/touchpad';
import {bind} from 'gnim';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from './quickButton';

export default (): QuickButton => {
    const touchpad = Touchpad.get_default();

    return {
        widget: (
            <QuickControlButton
                intent="toggle"
                active={bind(touchpad, 'enabled')}
                icon={bind(touchpad, 'enabled').as((enabled) =>
                    enabled ? 'input-touchpad-symbolic' : 'touchpad-disabled-symbolic'
                )}
                domain="Touchpad"
                value={bind(touchpad, 'enabled').as((enabled) => enabled ? 'On' : 'Off')}
                actionLabel={bind(touchpad, 'enabled').as((enabled) =>
                    enabled ? 'Turn Touchpad off' : 'Turn Touchpad on'
                )}
                sensitive={bind(touchpad, 'available')}
                onClick={() => bus.emit('input:touchpad:toggle')}
            />
        ),
    };
};
