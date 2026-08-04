import AstalBattery from 'gi://AstalBattery';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed} from 'gnim';
import {IconInfoRow} from '../../common/iconInfoRow';

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
    const charging = bind(battery, 'charging');
    const timeToEmpty = bind(battery, 'time-to-empty');
    const timeToFull = bind(battery, 'time-to-full');
    const timeTo = computed(() => (charging() ? timeToFull() : timeToEmpty()));

    return (
        <IconInfoRow
            visible={bind(battery, 'is-present')}
            icon={bind(battery, 'icon-name')}
            primary={bind(battery, 'percentage').as((p: number) => (p * 100).toFixed(0) + '%')}
            secondary={timeTo.as((t) => {
                if (t === 0) return 'Full';
                const suffix = battery.get_charging() ? ' to full' : ' to empty';
                return fmtDuration(t) + suffix;
            })}
        />
    );
};

export const Battery = () => {
    const battery = AstalBattery.get_default();
    const charging = bind(battery, 'charging');
    const timeToEmpty = bind(battery, 'time-to-empty');
    const timeToFull = bind(battery, 'time-to-full');
    const timeTo = computed(() => (charging() ? timeToFull() : timeToEmpty()));

    const chargingLabel = charging.as((c: boolean) => (c ? 'Charged in:' : 'Discharged in:'));

    const rateLabel = charging.as((c: boolean) => (c ? 'Rate of Charge:' : 'Rate of discharge:'));

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['card']}
            marginTop={12}
            marginBottom={12}
            marginStart={12}
            marginEnd={12}
            spacing={4}
            visible={bind(battery, 'is-present')}
        >
            <Gtk.Label cssClasses={['title-3']} label={'Battery Info'} halign={Gtk.Align.CENTER} />
            <Gtk.Box spacing={8} halign={Gtk.Align.START}>
                <Gtk.Label cssClasses={['heading']} label={chargingLabel} />
                <Gtk.Label label={timeTo.as((t) => fmtDurationHMS(t))} />
            </Gtk.Box>
            <Gtk.Box spacing={8} halign={Gtk.Align.START}>
                <Gtk.Label cssClasses={['heading']} label={rateLabel} />
                <Gtk.Label label={bind(battery, 'energy-rate').as((r) => `${r.toFixed(2)}W`)} />
            </Gtk.Box>
            <Gtk.Box spacing={8} halign={Gtk.Align.START}>
                <Gtk.Label cssClasses={['heading']} label={'Energy:'} />
                <Gtk.Label
                    label={bind(battery, 'energy').as(
                        (e) => `${e.toFixed(2)}/${battery.energyFull.toFixed(0)}Wh`
                    )}
                />
            </Gtk.Box>
            <Gtk.LevelBar value={bind(battery, 'percentage')} widthRequest={100} heightRequest={50}>
                <Gtk.Label
                    label={bind(battery, 'percentage').as((p) => `${(p * 100).toFixed(0)}%`)}
                />
            </Gtk.LevelBar>
        </Gtk.Box>
    );
};
