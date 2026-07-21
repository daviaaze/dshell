import Batery from 'gi://AstalBattery';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';

export default () => {
    const b = Batery.get_default();

    const warningStyles = createBinding(b, 'warningLevel').as(level => {
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
            visible={createBinding(b, 'isPresent')}
            iconName={createBinding(b, 'batteryIconName')}
            tooltipMarkup={createBinding(b, 'percentage').as(
                p => `${(p * 100).toFixed(0)}%`
            )}
            cssClasses={warningStyles}
            pixelSize={18}
        />
    );
};
