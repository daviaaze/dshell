import {
    conservationEnabled,
    startConservationMonitor,
    refreshConservation,
    toggleConservation,
    toggleConservationAsync,
} from '#/lib/services/power/batteryConservation';
import type {QuickButton} from '#/widget/quicksettings/button-grid/quickButton';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import Gtk from 'gi://Gtk?version=4.0';

export default (): QuickButton => {
    startConservationMonitor();
    // Guards against stacking multiple pkexec auth dialogs while one
    // elevation attempt is still in flight.
    let pending = false;

    return {
        widget: (
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
        ) as unknown as Gtk.Widget,
    };
};
