import {createState, onMount, onCleanup} from 'gnim';
import {isConservationEnabled, toggleConservation, toggleConservationAsync} from '#/lib/services/power/batteryConservation';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import GLib from 'gi://GLib?version=2.0';

export default () => {
    const [enabled, setEnabled] = createState(isConservationEnabled());
    // Guards against stacking multiple pkexec auth dialogs while one
    // elevation attempt is still in flight.
    let pending = false;

    onMount(() => {
        const sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            setEnabled(isConservationEnabled());
            return GLib.SOURCE_CONTINUE;
        });

        onCleanup(() => {
            GLib.source_remove(sourceId);
        });
    });

    return (
        <QuickToggleButton
            icon={enabled.as(e =>
                e ? 'battery-caution-symbolic' : 'battery-good-symbolic'
            )}
            label={enabled.as(e => (e ? 'Conservation' : 'Full Power'))}
            active={enabled}
            onClick={() => {
                if (pending) return;
                const ok = toggleConservation();
                if (ok) {
                    // Direct write succeeded — optimistic update
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        setEnabled(isConservationEnabled());
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    // Not writable — try pkexec (polkit auth dialog)
                    pending = true;
                    toggleConservationAsync()
                        .catch(() => {})
                        .finally(() => {
                            pending = false;
                            setEnabled(isConservationEnabled());
                        });
                }
            }}
        />
    );
};
