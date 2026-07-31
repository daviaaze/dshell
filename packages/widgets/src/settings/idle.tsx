import {generalSettings} from '@shade/core/settings/general.gschema';
import {onCleanup} from 'gnim';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

export default () => {
    const settings = generalSettings();

    return (
        <>
            <Adw.PreferencesGroup
                title={'Idle Management'}
                description={'Screen lock, display power, and sleep behavior'}
            >
                <Adw.SwitchRow
                    title={'Auto Lock'}
                    subtitle={'Lock screen after idle timeout'}
                    active={settings.autoLockEnabled}
                    onNotifyActive={self =>
                        settings.setAutoLockEnabled(self.active)
                    }
                />
                <Adw.SpinRow
                    title={'Idle Timeout'}
                    subtitle={'Seconds of inactivity before locking'}
                    ref={self => {
                        onCleanup(
                            settings.idleTimeout.subscribe(() => {
                                self.value = settings.idleTimeout();
                            })
                        );
                        self.adjustment = new Gtk.Adjustment({
                            lower: 60,
                            upper: 1800,
                            stepIncrement: 30,
                            value: settings.idleTimeout(),
                        });
                    }}
                    onNotifyValue={self => settings.setIdleTimeout(self.value)}
                />
                <Adw.SwitchRow
                    title={'Dim Before Lock'}
                    subtitle={'Lower brightness before auto-lock'}
                    active={settings.screenDimEnabled}
                    onNotifyActive={self =>
                        settings.setScreenDimEnabled(self.active)
                    }
                />
                <Adw.SpinRow
                    title={'Dim Timeout'}
                    subtitle={'Seconds before lock to start dimming'}
                    ref={self => {
                        onCleanup(
                            settings.screenDimTimeout.subscribe(() => {
                                self.value = settings.screenDimTimeout();
                            })
                        );
                        onCleanup(
                            settings.idleTimeout.subscribe(() => {
                                self.adjustment!.upper = Math.max(
                                    30,
                                    settings.idleTimeout() - 10
                                );
                            })
                        );
                        self.adjustment = new Gtk.Adjustment({
                            lower: 30,
                            upper: settings.idleTimeout() - 10,
                            stepIncrement: 30,
                            value: settings.screenDimTimeout(),
                        });
                    }}
                    onNotifyValue={self =>
                        settings.setScreenDimTimeout(self.value)
                    }
                />
                <Adw.SwitchRow
                    title={'Turn Off Display'}
                    subtitle={'Power off screen after idle (DPMS)'}
                    active={settings.dpmsEnabled}
                    onNotifyActive={self =>
                        settings.setDpmsEnabled(self.active)
                    }
                />
                <Adw.SpinRow
                    title={'Display Timeout'}
                    subtitle={'Seconds before turning off display'}
                    ref={self => {
                        onCleanup(
                            settings.dpmsTimeout.subscribe(() => {
                                self.value = settings.dpmsTimeout();
                            })
                        );
                        onCleanup(
                            settings.idleTimeout.subscribe(() => {
                                self.adjustment!.lower =
                                    settings.idleTimeout() + 10;
                            })
                        );
                        self.adjustment = new Gtk.Adjustment({
                            lower: settings.idleTimeout() + 10,
                            upper: 3600,
                            stepIncrement: 30,
                            value: settings.dpmsTimeout(),
                        });
                    }}
                    onNotifyValue={self => settings.setDpmsTimeout(self.value)}
                />
                <Adw.SwitchRow
                    title={'Auto Suspend'}
                    subtitle={'Suspend system after prolonged inactivity'}
                    active={settings.suspendEnabled}
                    onNotifyActive={self =>
                        settings.setSuspendEnabled(self.active)
                    }
                />
                <Adw.SpinRow
                    title={'Suspend Timeout'}
                    subtitle={'Seconds before suspending'}
                    sensitive={settings.suspendEnabled}
                    ref={self => {
                        onCleanup(
                            settings.suspendTimeout.subscribe(() => {
                                self.value = settings.suspendTimeout();
                            })
                        );
                        onCleanup(
                            settings.dpmsTimeout.subscribe(() => {
                                self.adjustment!.lower =
                                    settings.dpmsTimeout() + 10;
                            })
                        );
                        self.adjustment = new Gtk.Adjustment({
                            lower: settings.dpmsTimeout() + 10,
                            upper: 7200,
                            stepIncrement: 60,
                            value: settings.suspendTimeout(),
                        });
                    }}
                    onNotifyValue={self =>
                        settings.setSuspendTimeout(self.value)
                    }
                />
            </Adw.PreferencesGroup>
        </>
    );
};
