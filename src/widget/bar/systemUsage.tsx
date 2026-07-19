import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {Accessor} from 'gnim';
import {useStyle} from '#/style/useStyle';
import {useSettings} from '#/lib/settings';
import SystemUsage from '#/lib/services/monitoring/systemUsage';

const LEVEL_BAR_SIZE = 50;

const Indicator = ({
    value,
    label,
    unit,
    vertical,
    visible = true,
}: {
    value: Accessor<number>;
    label: string;
    unit: string;
    vertical: Accessor<boolean>;
    visible?: Accessor<boolean> | boolean;
}) => {
    const numeralStyle = useStyle({
        'font-feature-settings': "'tnum'",
        'font-variant-numeric': 'tabular-nums',
    });
    return (
        <Gtk.Box
            visible={visible}
            spacing={2}
            orientation={Gtk.Orientation.VERTICAL}
        >
            <Gtk.Box
                spacing={vertical.as(v => (v ? 0 : 4))}
                orientation={vertical.as(v =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
            >
                <Gtk.Label
                    label={label}
                    cssClasses={['caption-heading', 'numeral', numeralStyle.class]}
                    $={numeralStyle.$}
                />
                <Gtk.Label
                    cssClasses={['caption', 'numeral', numeralStyle.class]}
                    $={numeralStyle.$}
                    label={value(v => (v * 100).toFixed(0).concat(unit))}
                />
            </Gtk.Box>
            <Gtk.LevelBar
                orientation={vertical.as(v =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                inverted={vertical}
                value={value}
                widthRequest={vertical.as(v => (v ? -1 : LEVEL_BAR_SIZE))}
                heightRequest={vertical.as(v => (v ? LEVEL_BAR_SIZE : -1))}
            />
        </Gtk.Box>
    );
};

export default ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const settings = useSettings();
    const usage = SystemUsage.get_default();

    return (
        <Gtk.Button
            visible={visible}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            onClicked={() => {
                const monitor = settings.bar.systemMonitor();
                if (monitor) usage.launchMonitor(monitor);
            }}
        >
            <Gtk.Box
                orientation={vertical.as(v =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                spacing={12}
            >
                <Indicator
                    vertical={vertical}
                    value={usage.cpu}
                    label="CPU"
                    unit="%"
                />
                <Indicator
                    vertical={vertical}
                    value={usage.memory}
                    label="RAM"
                    unit="%"
                />
                <Indicator
                    visible={usage.tempAvailable}
                    vertical={vertical}
                    value={usage.temp}
                    label="TEMP"
                    unit="°C"
                />
                <Indicator
                    vertical={vertical}
                    visible={settings.bar.showDiskUsage}
                    value={usage.disk}
                    label="DISK"
                    unit="%"
                />
            </Gtk.Box>
        </Gtk.Button>
    );
};
