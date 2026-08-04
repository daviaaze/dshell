import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {timerSettings} from '@shade/services/time/timer.gschema';

/** Default countdown presets in minutes (mirrors schema default). */
const DEFAULT_COUNTDOWN_PRESETS = [1, 5, 10, 15, 30, 60];

/** Pomodoro work/break duration rows. */
function PomodoroGroup({settings}: {settings: ReturnType<typeof timerSettings>}) {
    return (
        <Adw.PreferencesGroup title={'Pomodoro'} description={'Work/break cycle durations'}>
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: 1,
                        upper: 120,
                        stepIncrement: 5,
                        value: settings.pomodoroWorkDuration(),
                    });
                }}
                title={'Work Duration'}
                subtitle={'Minutes per work session'}
                onNotifyValue={(self) => settings.setPomodoroWorkDuration(self.value)}
            />
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: 1,
                        upper: 30,
                        stepIncrement: 1,
                        value: settings.pomodoroBreakDuration(),
                    });
                }}
                title={'Short Break Duration'}
                subtitle={'Minutes per short break'}
                onNotifyValue={(self) => settings.setPomodoroBreakDuration(self.value)}
            />
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: 1,
                        upper: 60,
                        stepIncrement: 5,
                        value: settings.pomodoroLongBreakDuration(),
                    });
                }}
                title={'Long Break Duration'}
                subtitle={'Minutes per long break'}
                onNotifyValue={(self) => settings.setPomodoroLongBreakDuration(self.value)}
            />
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: 1,
                        upper: 10,
                        stepIncrement: 1,
                        value: settings.pomodoroSessionsBeforeLongBreak(),
                    });
                }}
                title={'Sessions Before Long Break'}
                subtitle={'Number of work sessions between long breaks'}
                onNotifyValue={(self) => settings.setPomodoroSessionsBeforeLongBreak(self.value)}
            />
        </Adw.PreferencesGroup>
    );
}

/** Countdown group — a preset adder and a reset-to-defaults row. */
function CountdownGroup({settings}: {settings: ReturnType<typeof timerSettings>}) {
    return (
        <Adw.PreferencesGroup title={'Countdown'} description={'Quick timer presets in minutes'}>
            <Adw.EntryRow
                title={'Add Preset (Enter duration in minutes, e.g. 1, 5, 10)'}
                showApplyButton
                onApply={(self) => {
                    const value = parseInt(self.text.trim(), 10);
                    if (isNaN(value) || value <= 0) return;
                    const current = settings.countdownPresets();
                    if (!current.includes(value)) {
                        settings.setCountdownPresets([...current, value].sort((a, b) => a - b));
                    }
                    self.text = '';
                }}
            />
            <Adw.ActionRow
                title={'Presets'}
                subtitle={settings
                    .countdownPresets()
                    .map((m) => `${m}m`)
                    .join(', ')}
            >
                <Gtk.Button
                    cssClasses={['circular', 'destructive-action']}
                    iconName="edit-clear-all-symbolic"
                    tooltipText="Reset to defaults"
                    onClicked={() => settings.setCountdownPresets(DEFAULT_COUNTDOWN_PRESETS)}
                />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const settings = timerSettings();

    return (
        <>
            <PomodoroGroup settings={settings} />
            <CountdownGroup settings={settings} />
        </>
    );
};
