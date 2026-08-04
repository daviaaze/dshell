import Gtk from 'gi://Gtk?version=4.0';
import Inhibit from '@shade/services/power/inhibit';
import {bind, computed} from 'gnim';

export default () => {
    const inhibit = Inhibit.get_default();
    const idle = bind(inhibit, 'idle');
    const remaining = bind(inhibit, 'remaining');

    const tooltip = computed(() => {
        if (!idle()) return '';
        return remaining() ? `Keep Awake — ${remaining()} remaining` : 'Keep Awake';
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
