import Batery from 'gi://AstalBattery';
import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';

export default () => {
    const b = Batery.get_default();

    const warningStyles = bind(b, 'warningLevel').as(level => {
        if (
            level === Batery.WarningLevel.CRITICIAL ||
            level === Batery.WarningLevel.ACTION
        )
            return ['error'];
        if (
            level === Batery.WarningLevel.LOW ||
            level === Batery.WarningLevel.DISCHARGING
        )
            return ['warning'];
        return [];
    });

    return (
        <Gtk.Image
            visible={bind(b, 'isPresent')}
            iconName={bind(b, 'batteryIconName')}
            tooltipMarkup={bind(b, 'percentage').as(
                p => `${(p * 100).toFixed(0)}%`
            )}
            cssClasses={warningStyles}
            pixelSize={18}
        />
    );
};
