import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed} from 'gnim';
import MonitorConfig from '@shade/services/display/monitorConfig';
import type {MonitorInfo} from '@shade/services/display/monitorConfig';

export default () => {
    const config = MonitorConfig.get_default();
    const monitors = bind(config, 'monitors');

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={24}>
            {monitors.as((monitorList) =>
                monitorList.map((monitor) => {
                    const currentMode = computed(() => {
                        const w = monitor.width;
                        const h = monitor.height;
                        const r = monitor.refreshRate;
                        return `${w}x${h}@${r}`;
                    });

                    const resolutions = computed(() => {
                        const modes = monitor.availableModes;
                        const unique = new Map<string, {width: number; height: number}>();
                        modes.forEach((m) => {
                            const key = `${m.width}x${m.height}`;
                            if (!unique.has(key)) {
                                unique.set(key, {width: m.width, height: m.height});
                            }
                        });
                        return Array.from(unique.values());
                    });

                    const refreshRates = computed(() => {
                        const w = monitor.width;
                        const h = monitor.height;
                        const modes = monitor.availableModes;
                        const rates = modes
                            .filter((m) => m.width === w && m.height === h)
                            .map((m) => m.refreshRate);
                        return [...new Set(rates)].sort((a, b) => b - a);
                    });

                    return (
                        <Adw.PreferencesGroup title={monitor.description || monitor.name}>
                            <Adw.ComboRow title="Resolution" subtitle={currentMode()}>
                                <Gtk.DropDown
                                    selected={computed(() => {
                                        const res = resolutions();
                                        const idx = res.findIndex(
                                            (r) => r.width === monitor.width && r.height === monitor.height
                                        );
                                        return idx >= 0 ? idx : 0;
                                    })}
                                    onNotifySelected={(self) => {
                                        const res = resolutions();
                                        const selected = res[self.selected];
                                        if (selected) {
                                            config.setResolution(monitor.name, selected.width, selected.height);
                                        }
                                    }}
                                >
                                    <Gtk.StringList>
                                        {resolutions().map((res: {width: number; height: number}) => (
                                            <Gtk.StringObject string={`${res.width}x${res.height}`} />
                                        ))}
                                    </Gtk.StringList>
                                </Gtk.DropDown>
                            </Adw.ComboRow>

                            <Adw.ComboRow title="Refresh Rate" subtitle={`${monitor.refreshRate} Hz`}>
                                <Gtk.DropDown
                                    selected={computed(() => {
                                        const rates = refreshRates();
                                        const idx = rates.indexOf(monitor.refreshRate);
                                        return idx >= 0 ? idx : 0;
                                    })}
                                    onNotifySelected={(self) => {
                                        const rates = refreshRates();
                                        const rate = rates[self.selected];
                                        if (rate) {
                                            config.setRefreshRate(monitor.name, rate);
                                        }
                                    }}
                                >
                                    <Gtk.StringList>
                                        {refreshRates().map((rate: number) => (
                                            <Gtk.StringObject string={`${rate} Hz`} />
                                        ))}
                                    </Gtk.StringList>
                                </Gtk.DropDown>
                            </Adw.ComboRow>

                            <Adw.ActionRow title="Scale" subtitle={`${monitor.scale}x`}>
                                <Gtk.Scale
                                    orientation={Gtk.Orientation.HORIZONTAL}
                                    min={1}
                                    max={2}
                                    step={0.25}
                                    value={monitor.scale}
                                    onChangeValue={(value) => config.setScale(monitor.name, value)}
                                    width-request={200}
                                />
                            </Adw.ActionRow>

                            <Adw.ComboRow title="Rotation" subtitle={`${monitor.transform * 90}°`}>
                                <Gtk.DropDown
                                    selected={monitor.transform}
                                    onNotifySelected={(self) => {
                                        config.setTransform(monitor.name, self.selected);
                                    }}
                                >
                                    <Gtk.StringList strings={['0°', '90°', '180°', '270°']} />
                                </Gtk.DropDown>
                            </Adw.ComboRow>

                            <Adw.SwitchRow
                                title="Display Power"
                                subtitle={monitor.dpmsStatus ? 'On' : 'Off'}
                                active={monitor.dpmsStatus}
                                onNotifyActive={(self) => {
                                    config.setDpms(monitor.name, self.active);
                                }}
                            />

                            <Adw.ActionRow title="Primary Display">
                                <Gtk.Button
                                    label={monitor.focused ? 'Current' : 'Set as Primary'}
                                    sensitive={!monitor.focused}
                                    onClicked={() => config.setPrimaryMonitor(monitor.name)}
                                />
                            </Adw.ActionRow>
                        </Adw.PreferencesGroup>
                    );
                })
            )}
        </Gtk.Box>
    );
};
