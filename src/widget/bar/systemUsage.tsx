import GTop from 'gi://GTop';
import {useSettings} from '#/lib/settings';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {Process} from '#/lib/core/process';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {Accessor, createState, onCleanup} from 'gnim';
import {useStyle} from '#/style/useStyle';
import logger from '#/lib/core/logger';

/** Auto-discover the coretemp Package id 0 sensor path. */
function findCoretempPath(): string | null {
    const hwmonDir = Gio.File.new_for_path('/sys/class/hwmon');
    let iter: Gio.FileEnumerator | null = null;
    try {
        iter = hwmonDir.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info: Gio.FileInfo | null;
        while ((info = iter.next_file(null)) !== null) {
            const hwmonName = info.get_name();
            const nameFile = iter.get_child(info).get_child('name');
            try {
                const [ok, contents] = nameFile.load_contents(null);
                if (
                    ok &&
                    new TextDecoder().decode(contents).trim() === 'coretemp'
                ) {
                    return `/sys/class/hwmon/${hwmonName}/temp1_input`;
                }
            } catch { // eslint-disable-line no-empty
                // hwmon entry without a name file — skip
            }
        }
    } catch (e) {
        logger.error('systemUsage', 'hwmon enumeration failed:', (e as Error).message);
    } finally {
        iter?.close(null);
    }
    return null;
}

export default ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const settings = useSettings();

    const [lastCpuTop, setLastCpuTop] = createState(new GTop.glibtop_cpu());
    const [cpu, setCpu] = createState(0);
    const [memory, setMemory] = createState(0);
    const [disk, setDisk] = createState(0);
    const [temp, setTemp] = createState(0);
    const [tempAvailable, setTempAvailable] = createState(false);
    const POLL_INTERVAL = 1000;
    /** hwmon temp1_input is millidegrees. Divide by 1000 for °C, then 100 maps to LevelBar max (0..1). */
    const TEMP_TO_LEVELBAR = 100000;
    const LEVEL_BAR_SIZE = 50;

    // Resolve temp path: explicit config takes priority, but validate it exists.
    const userPath = settings.bar.tempPath();
    const tempPath =
        (userPath && Gio.File.new_for_path(userPath).query_exists(null)
            ? userPath
            : null) ?? findCoretempPath();
    if (!tempPath) {
        if (userPath) {
            logger.error(
                'systemUsage',
                `configured temp-path "${userPath}" does not exist or is not a file, and no sensor was auto-detected`
            );
        } else {
            logger.error(
                'systemUsage',
                'no temperature sensor found — set bar.temp-path or ensure coretemp is loaded'
            );
        }
    }

    let tempFailed = false;

    const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL, () => {
        const cpuTop = new GTop.glibtop_cpu();
        GTop.glibtop_get_cpu(cpuTop);
        const total = cpuTop.total - lastCpuTop().total;
        const user = cpuTop.user - lastCpuTop().user;
        const sys = cpuTop.sys - lastCpuTop().sys;
        const nice = cpuTop.nice - lastCpuTop().nice;
        setLastCpuTop(cpuTop);
        setCpu((user + sys + nice) / total);

        const memTop = new GTop.glibtop_mem();
        GTop.glibtop_get_mem(memTop);
        setMemory(memTop.user / memTop.total);

        const diskTop = new GTop.glibtop_fsusage();
        GTop.glibtop_get_fsusage(diskTop, '/');
        setDisk((diskTop.blocks - diskTop.bavail) / diskTop.blocks);

        if (tempPath && !tempFailed) {
            try {
                const file = Gio.File.new_for_path(tempPath);
                const [success, contents] = file.load_contents(null);
                if (success) {
                    const value = parseInt(new TextDecoder().decode(contents));
                    setTemp(value / TEMP_TO_LEVELBAR);
                    setTempAvailable(true);
                }
            } catch (e) {
                logger.error('systemUsage', 'failed to read temperature:', e);
                setTempAvailable(false);
                tempFailed = true;
            }
        }
        return GLib.SOURCE_CONTINUE;
    });
    onCleanup(() => GLib.source_remove(timeoutId));

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

    return (
        <Gtk.Button
            visible={visible}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            onClicked={() =>
                settings.bar.systemMonitor()
                    ? Process.execAsync(settings.bar.systemMonitor()).catch(e =>
                          logger.error(
                              'systemUsage',
                              'failed to launch monitor:',
                              e
                          )
                      )
                    : null
            }
        >
            <Gtk.Box
                orientation={vertical.as(v =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                spacing={12}
            >
                <Indicator
                    vertical={vertical}
                    value={cpu}
                    label="CPU"
                    unit="%"
                />
                <Indicator
                    vertical={vertical}
                    value={memory}
                    label="RAM"
                    unit="%"
                />
                <Indicator
                    visible={tempAvailable}
                    vertical={vertical}
                    value={temp}
                    label="TEMP"
                    unit="°C"
                />
                <Indicator
                    vertical={vertical}
                    visible={settings.bar.showDiskUsage}
                    value={disk}
                    label="DISK"
                    unit="%"
                />
            </Gtk.Box>
        </Gtk.Button>
    );
};
