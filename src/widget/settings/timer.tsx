import {useSettings} from '#/lib/settings';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

/** Default countdown presets in minutes (mirrors schema default). */
const DEFAULT_COUNTDOWN_PRESETS = [1, 5, 10, 15, 30, 60];

export default () => {
    const settings = useSettings().timer;

    return (
        <>
            <Adw.PreferencesGroup
                title={'Pomodoro'}
                description={'Work/break cycle durations'}
            >
                <Adw.SpinRow
                    title={'Work Duration'}
                    subtitle={'Minutes per work session'}
                    adjustment={
                        (
                            <Gtk.Adjustment
                                lower={1}
                                upper={120}
                                stepIncrement={5}
                                value={settings.pomodoroWorkDuration}
                            />
                        ) as Gtk.Adjustment
                    }
                    onNotifyValue={self =>
                        settings.setPomodoroWorkDuration(self.value)
                    }
                />
                <Adw.SpinRow
                    title={'Short Break Duration'}
                    subtitle={'Minutes per short break'}
                    adjustment={
                        (
                            <Gtk.Adjustment
                                lower={1}
                                upper={30}
                                stepIncrement={1}
                                value={settings.pomodoroBreakDuration}
                            />
                        ) as Gtk.Adjustment
                    }
                    onNotifyValue={self =>
                        settings.setPomodoroBreakDuration(self.value)
                    }
                />
                <Adw.SpinRow
                    title={'Long Break Duration'}
                    subtitle={'Minutes per long break'}
                    adjustment={
                        (
                            <Gtk.Adjustment
                                lower={1}
                                upper={60}
                                stepIncrement={5}
                                value={settings.pomodoroLongBreakDuration}
                            />
                        ) as Gtk.Adjustment
                    }
                    onNotifyValue={self =>
                        settings.setPomodoroLongBreakDuration(self.value)
                    }
                />
                <Adw.SpinRow
                    title={'Sessions Before Long Break'}
                    subtitle={'Number of work sessions between long breaks'}
                    adjustment={
                        (
                            <Gtk.Adjustment
                                lower={1}
                                upper={10}
                                stepIncrement={1}
                                value={settings.pomodoroSessionsBeforeLongBreak}
                            />
                        ) as Gtk.Adjustment
                    }
                    onNotifyValue={self =>
                        settings.setPomodoroSessionsBeforeLongBreak(self.value)
                    }
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title={'Countdown'}
                description={'Quick timer presets in minutes'}
            >
                <Adw.EntryRow
                    title={'Add Preset'}
                    subtitle={'Enter duration in minutes (e.g. 1, 5, 10)'}
                    showApplyButton
                    onApply={self => {
                        const value = parseInt(self.text.trim(), 10);
                        if (isNaN(value) || value <= 0) return;
                        const current = settings.countdownPresets() as number[];
                        if (!current.includes(value)) {
                            settings.setCountdownPresets(
                                [...current, value].sort((a, b) => a - b)
                            );
                        }
                        self.text = '';
                    }}
                />
                <Adw.ActionRow
                    title={'Presets'}
                    subtitle={(settings.countdownPresets() as number[])
                        .map(m => `${m}m`)
                        .join(', ')}
                >
                    <Gtk.Button
                        $type="suffix"
                        cssClasses={['circular', 'destructive-action']}
                        iconName="edit-clear-all-symbolic"
                        tooltipText="Reset to defaults"
                        onClicked={() =>
                            settings.setCountdownPresets(DEFAULT_COUNTDOWN_PRESETS)
                        }
                    />
                </Adw.ActionRow>
            </Adw.PreferencesGroup>
        </>
    );
};
