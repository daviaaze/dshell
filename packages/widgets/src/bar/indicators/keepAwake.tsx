import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed} from 'gnim';
import Inhibit from '@shade/services/power/inhibit';

export default () => {
    const inhibit = Inhibit.get_default();
    const idle = bind(inhibit, 'idle');
    const remaining = bind(inhibit, 'remaining');

    const tooltip = computed(() => {
        if (!idle()) return '';
        return remaining()
            ? `Keep Awake — ${remaining()} remaining`
            : 'Keep Awake';
    });

    return (
        <Gtk.Image
            visible={bind(inhibit, 'idle')}
            iconName="weather-clear-symbolic"
            tooltipMarkup={tooltip}
            pixelSize={18}
        />
    );
};
