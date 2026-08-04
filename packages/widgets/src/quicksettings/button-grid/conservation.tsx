import {bus} from '@shade/services/bus';
import {
    conservationEnabled,
    startConservationMonitor,
} from '@shade/services/power/batteryConservation';
import {QuickToggleButton} from '../../common/quickToggleButton';
import type {QuickButton} from './quickButton';

export default (): QuickButton => {
    startConservationMonitor();

    return {
        widget: (
            <QuickToggleButton
                icon={conservationEnabled.as((e) =>
                    e ? 'battery-caution-symbolic' : 'battery-good-symbolic'
                )}
                label={conservationEnabled.as((e) => (e ? 'Conservation' : 'Full Power'))}
                active={conservationEnabled}
                onClick={() => bus.emit('power:conservation:toggle')}
            />
        ),
    };
};
