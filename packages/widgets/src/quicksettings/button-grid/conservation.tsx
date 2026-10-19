import {bus} from '@shade/services/bus';
import {
    conservationEnabled,
    startConservationMonitor,
} from '@shade/services/power/batteryConservation';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from './quickButton';

export default (): QuickButton => {
    startConservationMonitor();

    return {
        widget: (
            <QuickControlButton
                intent="toggle"
                active={conservationEnabled}
                icon={conservationEnabled.as((enabled) =>
                    enabled ? 'battery-caution-symbolic' : 'battery-good-symbolic'
                )}
                domain="Battery care"
                value={conservationEnabled.as((enabled) => enabled ? 'On' : 'Off')}
                actionLabel={conservationEnabled.as((enabled) =>
                    enabled ? 'Turn battery care off' : 'Turn battery care on'
                )}
                onClick={() => bus.emit('power:conservation:toggle')}
            />
        ),
    };
};
