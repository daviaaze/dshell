import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {For} from 'gnim';
import {useSettings} from '../../lib/settings';

export default () => {
    const {bar} = useSettings();
    const {TOP, LEFT, RIGHT, BOTTOM} = Astal.WindowAnchor;

    return (
        <>
            <Adw.PreferencesGroup
                title={'Bar'}
                description={'Bar widget settings'}
            >
                <Adw.ActionRow
                    title={'Position'}
                    subtitle={bar.position.as(p => {
                        switch (p) {
                            case TOP:
                                return 'Top';
                            case LEFT:
                                return 'Left';
                            case RIGHT:
                                return 'Right';
                            case BOTTOM:
                                return 'Bottom';
                            default:
                                return '';
                        }
                    })}
                >
                    <Adw.ToggleGroup
                        slot="suffix"
                        cssClasses={['round']}
                        valign={Gtk.Align.CENTER}
                        onNotifyActiveName={self =>
                            bar.setPosition(
                                Number(self.activeName) as Astal.WindowAnchor
                            )
                        }
                        ref={self => {
                            const v = bar.position.peek();
                            self.activeName = String(v ?? '');
                            bar.position.subscribe(() => {
                                self.activeName = String(bar.position());
                            });
                        }}
                    >
                        <Adw.Toggle
                            name={TOP.toString()}
                            label={'Top'}
                            iconName={'orientation-landscape-symbolic'}
                        />
                        <Adw.Toggle
                            name={LEFT.toString()}
                            label={'Left'}
                            iconName={'orientation-portrait-inverse-symbolic'}
                        />
                        <Adw.Toggle
                            name={RIGHT.toString()}
                            label={'Right'}
                            iconName={'orientation-portrait-right-symbolic'}
                        />
                        <Adw.Toggle
                            name={BOTTOM.toString()}
                            label={'Bottom'}
                            iconName={'orientation-landscape-inverse-symbolic'}
                        />
                    </Adw.ToggleGroup>
                </Adw.ActionRow>

                <Adw.SwitchRow
                    title={'Show Disk Usage'}
                    active={bar.showDiskUsage}
                    onNotifyActive={self => bar.setShowDiskUsage(self.active)}
                />
                <Adw.EntryRow
                    title={'Temperature Path'}
                    showApplyButton
                    text={bar.tempPath() ?? ''}
                    onEntryActivated={self => bar.setTempPath(self.text)}
                    onApply={self => bar.setTempPath(self.text)}
                />
                <Adw.EntryRow
                    title={'System Monitor'}
                    showApplyButton
                    text={bar.systemMonitor() ?? ''}
                    onEntryActivated={self => bar.setSystemMonitor(self.text)}
                    onApply={self => bar.setSystemMonitor(self.text)}
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title="Dock"
                description="Taskbar at the bottom of the screen"
            >
                <Adw.SwitchRow
                    title="Enable Dock"
                    active={bar.dockEnabled}
                    onNotifyActive={self => bar.setDockEnabled(self.active)}
                />
                <Adw.SwitchRow
                    title="Auto Hide"
                    active={bar.dockAutoHide}
                    onNotifyActive={self => bar.setDockAutoHide(self.active)}
                />
                <Adw.SpinRow
                    ref={self => {
                        self.adjustment = new Gtk.Adjustment({
                            lower: 24,
                            upper: 64,
                            stepIncrement: 4,
                            value: bar.dockIconSize(),
                        });
                    }}
                    title="Icon Size"
                    onNotifyValue={self => bar.setDockIconSize(self.value)}
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title="Pinned Apps"
                description="Desktop file IDs pinned to the dock"
            >
                <Adw.EntryRow
                    title="Add App"
                    showApplyButton
                    onApply={self => {
                        const id = self.text.trim();
                        if (!id) return;
                        const current = bar.dockPinnedApps();
                        if (!current.includes(id)) {
                            bar.setDockPinnedApps([...current, id]);
                        }
                        self.text = '';
                    }}
                />
                <For each={bar.dockPinnedApps}>
                    {(appId: string) => (
                        <Adw.ActionRow title={appId}>
                            <Gtk.Button
                                slot="suffix"
                                cssClasses={['circular', 'destructive-action']}
                                iconName="list-remove-symbolic"
                                onClicked={() => {
                                    const current = bar.dockPinnedApps();
                                    bar.setDockPinnedApps(
                                        current.filter(a => a !== appId)
                                    );
                                }}
                            />
                        </Adw.ActionRow>
                    )}
                </For>
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title="Modules"
                description="Toggle visibility of bar components"
            >
                <Adw.SwitchRow
                    title="Launcher Button"
                    active={bar.showLauncher}
                    onNotifyActive={self => bar.setShowLauncher(self.active)}
                />
                <Adw.SwitchRow
                    title="Workspaces"
                    active={bar.showWorkspaces}
                    onNotifyActive={self => bar.setShowWorkspaces(self.active)}
                />
                <Adw.SwitchRow
                    title="Window Title"
                    active={bar.showWindowTitle}
                    onNotifyActive={self => bar.setShowWindowTitle(self.active)}
                />
                <Adw.SwitchRow
                    title="System Resources"
                    active={bar.showSystemResources}
                    onNotifyActive={self =>
                        bar.setShowSystemResources(self.active)
                    }
                />
                <Adw.SwitchRow
                    title="Clock"
                    active={bar.showClock}
                    onNotifyActive={self => bar.setShowClock(self.active)}
                />
                <Adw.SwitchRow
                    title="Weather"
                    active={bar.showWeather}
                    onNotifyActive={self => bar.setShowWeather(self.active)}
                />
                <Adw.SwitchRow
                    title="System Indicators"
                    active={bar.showSystemIndicators}
                    onNotifyActive={self =>
                        bar.setShowSystemIndicators(self.active)
                    }
                />
                <Adw.SwitchRow
                    title="Bluetooth Battery"
                    subtitle="Show connected bluetooth device battery level"
                    active={bar.showBluetoothBattery}
                    onNotifyActive={self =>
                        bar.setShowBluetoothBattery(self.active)
                    }
                />
            </Adw.PreferencesGroup>
        </>
    );
};
