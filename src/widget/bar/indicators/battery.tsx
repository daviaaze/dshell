import Batery from 'gi://AstalBattery';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {createState, onMount, onCleanup} from 'gnim';
import {connectFor, cleanupNode} from '#/lib/core/connectFor';

export default () => {
    const [visible, setVisible] = createState(false);
    const [iconName, setIconName] = createState('');
    const [tooltip, setTooltip] = createState('');
    const [cssClasses, setCssClasses] = createState<string[]>([]);

    onMount(() => {
        const _hn = {};
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const b = Batery.get_default();
            const update = () => {
                setVisible(b.is_present);
                setIconName(b.batteryIconName ?? '');
                setTooltip(`${(b.percentage * 100).toFixed(0)}%`);
                const level = b.warning_level;
                if (
                    level === Batery.WarningLevel.CRITICIAL ||
                    level === Batery.WarningLevel.ACTION
                )
                    setCssClasses(['error']);
                else if (
                    level === Batery.WarningLevel.LOW ||
                    level === Batery.WarningLevel.DISCHARGING
                )
                    setCssClasses(['warning']);
                else setCssClasses([]);
            };
            update();
            connectFor(_hn, b, 'notify::is-present', update);
            connectFor(_hn, b, 'notify::battery-icon-name', update);
            connectFor(_hn, b, 'notify::percentage', update);
            connectFor(_hn, b, 'notify::warning-level', update);
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Image
            visible={visible}
            iconName={iconName}
            tooltipMarkup={tooltip}
            cssClasses={cssClasses}
            pixelSize={18}
        />
    );
};
