import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed} from 'gnim';
import Inhibit from '#/lib/services/power/inhibit';

export default () => {
    const inhibit = Inhibit.get_default();

    const tooltip = computed(
        [bind(inhibit, 'idle'), bind(inhibit, 'remaining')],
        (idle, remaining) => {
            if (!idle) return '';
            return remaining
                ? `Keep Awake — ${remaining} remaining`
                : 'Keep Awake';
        }
    );

    return (
        <Gtk.Image
            visible={bind(inhibit, 'idle')}
            iconName="weather-clear-symbolic"
            tooltipMarkup={tooltip}
            pixelSize={18}
        />
    );
};
