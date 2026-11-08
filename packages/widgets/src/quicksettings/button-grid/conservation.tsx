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
                domain="Saúde da bateria"
                value={conservationEnabled.as((enabled) => (enabled ? 'Ativado' : 'Desativado'))}
                actionLabel={conservationEnabled.as((enabled) =>
                    enabled
                        ? 'Desativar modo de saúde da bateria'
                        : 'Ativar modo de saúde da bateria'
                )}
                onClick={() => bus.emit('power:conservation:toggle')}
            />
        ),
    };
};
