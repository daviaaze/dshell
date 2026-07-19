import {
    conservationEnabled,
    startConservationMonitor,
    refreshConservation,
    toggleConservation,
    toggleConservationAsync,
} from '#/lib/services/power/batteryConservation';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';

export default () => {
    startConservationMonitor();
    // Guards against stacking multiple pkexec auth dialogs while one
    // elevation attempt is still in flight.
    let pending = false;

    return (
        <QuickToggleButton
            icon={conservationEnabled.as(e =>
                e ? 'battery-caution-symbolic' : 'battery-good-symbolic'
            )}
            label={conservationEnabled.as(e =>
                e ? 'Conservation' : 'Full Power'
            )}
            active={conservationEnabled}
            onClick={() => {
                if (pending) return;
                const ok = toggleConservation();
                if (ok) {
                    refreshConservation();
                } else {
                    // Not writable — try pkexec (polkit auth dialog)
                    pending = true;
                    toggleConservationAsync()
                        .catch(() => {})
                        .finally(() => {
                            pending = false;
                            refreshConservation();
                        });
                }
            }}
        />
    );
};
