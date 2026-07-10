import {createState, onMount, onCleanup} from 'gnim';
import Gtk from 'gi://Gtk?version=4.0';
import {isConservationEnabled, toggleConservation} from '#/lib/batteryConservation';
import {QuickToggleButton} from '#/widget/common/quickToggleButton';
import GLib from 'gi://GLib?version=2.0';

export default () => {
    const [enabled, setEnabled] = createState(isConservationEnabled());

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
            icon={enabled() ? 'battery-caution-symbolic' : 'battery-good-symbolic'}
            label={enabled() ? 'Conservation' : 'Full Power'}
            active={enabled()}
            onClick={() => {
                toggleConservation();
                // Update slightly faster to feel responsive
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    setEnabled(isConservationEnabled());
                    return GLib.SOURCE_REMOVE;
                });
            }}
        />
    );
};
