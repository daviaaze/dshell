import AstalBattery from 'gi://AstalBattery';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createComputed} from 'gnim';
import {IconInfoRow} from '#/widget/common/iconInfoRow';

function fmtDuration(seconds: number): string {
    const abs = Math.abs(Math.round(seconds));
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = abs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function fmtDurationHMS(seconds: number): string {
    const abs = Math.abs(Math.round(seconds));
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = abs % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
}

export const BatteryIcon = () => {
    const battery = AstalBattery.get_default();
    const timeTo = createComputed(
        [
            createBinding(battery, 'charging'),
            createBinding(battery, 'timeToEmpty'),
            createBinding(battery, 'timeToFull'),
        ],
        (charging, timeToEmpty, timeToFull) =>
            charging ? timeToFull : timeToEmpty
    );

    return (
        <IconInfoRow
            visible={createBinding(battery, 'isPresent')}
            icon={createBinding(battery, 'iconName')}
            primary={createBinding(battery, 'percentage').as(
                p => (p * 100).toFixed(0) + '%'
            )}
            secondary={timeTo(timeTo => {
                if (timeTo === 0) return 'Full';
                const suffix = battery.get_charging() ? ' to full' : ' to empty';
                return fmtDuration(timeTo) + suffix;
            })}
        />
    );
};

export const Battery = () => {
    const battery = AstalBattery.get_default();
    const timeTo = createComputed(
        [
            createBinding(battery, 'charging'),
            createBinding(battery, 'timeToEmpty'),
            createBinding(battery, 'timeToFull'),
        ],
        (charging, timeToEmpty, timeToFull) =>
            charging ? timeToFull : timeToEmpty
    );

    const chargingLabel = createBinding(battery, 'charging').as(c =>
        c ? 'Charged in:' : 'Discharged in:'
    );

    const rateLabel = createBinding(battery, 'charging').as(c =>
        c ? 'Rate of Charge:' : 'Rate of discharge:'
    );

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['card', 'p-12']}
            spacing={4}
            visible={createBinding(battery, 'isPresent')}
        >
            <Gtk.Label
                cssClasses={['title-3']}
                label={'Battery Info'}
                halign={Gtk.Align.CENTER}
            />
            <Gtk.Box spacing={8} halign={Gtk.Align.START}>
                <Gtk.Label cssClasses={['heading']} label={chargingLabel} />
                <Gtk.Label label={timeTo.as(t => fmtDurationHMS(t))} />
            </Gtk.Box>
            <Gtk.Box spacing={8} halign={Gtk.Align.START}>
                <Gtk.Label cssClasses={['heading']} label={rateLabel} />
                <Gtk.Label
                    label={createBinding(battery, 'energyRate').as(
                        r => `${r.toFixed(2)}W`
                    )}
                />
            </Gtk.Box>
            <Gtk.Box spacing={8} halign={Gtk.Align.START}>
                <Gtk.Label cssClasses={['heading']} label={'Energy:'} />
                <Gtk.Label
                    label={createBinding(battery, 'energy').as(
                        e =>
                            `${e.toFixed(2)}/${battery.energyFull.toFixed(0)}Wh`
                    )}
                />
            </Gtk.Box>
            <Gtk.LevelBar
                value={createBinding(battery, 'percentage')}
                widthRequest={100}
                heightRequest={50}
            >
                <Gtk.Label
                    label={createBinding(battery, 'percentage').as(
                        p => `${(p * 100).toFixed(0)}%`
                    )}
                />
            </Gtk.LevelBar>
        </Gtk.Box>
    );
};
