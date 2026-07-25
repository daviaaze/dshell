import {useSettings} from '#/lib/settings';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {For} from 'gnim';
import logger from '#/lib/core/logger';

export default () => {
    const settings = useSettings().general;

    return (
        <>
            <Adw.PreferencesGroup
                title={'Notifications'}
                description={'Notification behavior and history'}
            >
                <Adw.SwitchRow
                    title={'Show Progress Bar'}
                    subtitle={'Countdown timer on notification popups'}
                    active={settings.notificationShowProgress}
                    onNotifyActive={self =>
                        settings.setNotificationShowProgress(self.active)
                    }
                />
                <Adw.SpinRow
                    title={'History Limit'}
                    subtitle={'Maximum notifications to keep in history'}
                    adjustment={
                        (
                            <Gtk.Adjustment
                                lower={20}
                                upper={500}
                                stepIncrement={10}
                                value={settings.notificationHistoryLimit}
                            />
                        ) as any
                    }
                    onNotifyValue={self =>
                        settings.setNotificationHistoryLimit(self.value)
                    }
                />
                <Adw.EntryRow
                    title={'Ignore App'}
                    showApplyButton
                    onApply={self => {
                        const name = self.text.trim();
                        if (!name) return;
                        const current = settings.notificationIgnoredApps();
                        if (!current.includes(name)) {
                            logger.info(
                                'settings',
                                `ignore app added: ${name}`
                            );
                            settings.setNotificationIgnoredApps([
                                ...current,
                                name,
                            ]);
                        }
                        self.text = '';
                    }}
                />
                <For each={settings.notificationIgnoredApps}>
                    {(app: string) => (
                        <Adw.ActionRow title={app}>
                            <Gtk.Button
                                slot="suffix"
                                cssClasses={['circular', 'destructive-action']}
                                iconName="list-remove-symbolic"
                                onClicked={() => {
                                    const current =
                                        settings.notificationIgnoredApps();
                                    logger.info(
                                        'settings',
                                        `ignore app removed: ${app}`
                                    );
                                    settings.setNotificationIgnoredApps(
                                        current.filter(a => a !== app)
                                    );
                                }}
                            />
                        </Adw.ActionRow>
                    )}
                </For>
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title={'Sound Alerts'}
                description={'System sounds using freedesktop sound theme'}
            >
                <Adw.SwitchRow
                    title={'Enable Sound Alerts'}
                    subtitle={'Master toggle for all alert sounds'}
                    active={settings.soundAlertsEnabled}
                    onNotifyActive={self =>
                        settings.setSoundAlertsEnabled(self.active)
                    }
                />
                <Adw.SwitchRow
                    title={'Notification Sound'}
                    subtitle={'Play sound on notification arrival'}
                    active={settings.soundAlertNotification}
                    sensitive={settings.soundAlertsEnabled}
                    onNotifyActive={self =>
                        settings.setSoundAlertNotification(self.active)
                    }
                />
                <Adw.SwitchRow
                    title={'Capture Sound'}
                    subtitle={'Play sound on screenshot/recording'}
                    active={settings.soundAlertCapture}
                    sensitive={settings.soundAlertsEnabled}
                    onNotifyActive={self =>
                        settings.setSoundAlertCapture(self.active)
                    }
                />
                <Adw.SwitchRow
                    title={'Battery Warning Sound'}
                    subtitle={'Play sound on low battery'}
                    active={settings.soundAlertBattery}
                    sensitive={settings.soundAlertsEnabled}
                    onNotifyActive={self =>
                        settings.setSoundAlertBattery(self.active)
                    }
                />
                <Adw.SwitchRow
                    title={'System Sounds'}
                    subtitle={'Lock/unlock, power plug, device add/remove'}
                    active={settings.soundAlertSystem}
                    sensitive={settings.soundAlertsEnabled}
                    onNotifyActive={self =>
                        settings.setSoundAlertSystem(self.active)
                    }
                />
            </Adw.PreferencesGroup>
        </>
    );
};
