import Batery from 'gi://AstalBattery';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, effect} from 'gnim';
import {setAccessibleName} from '../../common/iconButton';

export default () => {
    const b = Batery.get_default();

    const warningStyles = bind(b, 'warning-level').as((level) => {
        if (level === Batery.WarningLevel.CRITICIAL || level === Batery.WarningLevel.ACTION)
            return ['error'];
        if (level === Batery.WarningLevel.LOW || level === Batery.WarningLevel.DISCHARGING)
            return ['warning'];
        return [];
    });

    const label = bind(b, 'percentage').as((p) => `Bateria: ${(p * 100).toFixed(0)}%`);

    return (
        <Gtk.Image
            visible={bind(b, 'is-present')}
            iconName={bind(b, 'battery-icon-name')}
            tooltipText={label}
            cssClasses={warningStyles}
            pixelSize={18}
            accessibleRole={Gtk.AccessibleRole.IMG}
            ref={(self) => effect(() => setAccessibleName(label())(self))}
        />
    );
};
