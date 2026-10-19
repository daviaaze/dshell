import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {validateCountdownPreset} from '@shade/services/time/countdownPresets';
import {
    DEFAULT_COUNTDOWN_PRESETS,
    timerSettings,
} from '@shade/services/time/timer.gschema';
import {createState, onCleanup} from 'gnim';

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

/** Countdown group — validated preset editor and one-step reset undo. */
function CountdownGroup({settings}: {settings: ReturnType<typeof timerSettings>}) {
    const [error, setError] = createState<string | null>(null);
    const [undoSnapshot, setUndoSnapshot] = createState<number[] | null>(null);
    const presetSubtitle = settings.countdownPresets.as((presets) =>
        presets.map((m) => `${m}m`).join(', ')
    );
    onCleanup(() => setUndoSnapshot(null));

    return (
        <Adw.PreferencesGroup title={'Countdown'} description={'Quick timer presets in minutes'}>
            <Adw.EntryRow
                title={'Add Preset (Enter duration in minutes, e.g. 1, 5, 10)'}
                showApplyButton
                onApply={(self) => {
                    const current = settings.countdownPresets();
                    const result = validateCountdownPreset(self.text, current);
                    if (result.kind !== 'valid') {
                        setError(
                            result.kind === 'empty'
                                ? 'Enter a duration in whole minutes.'
                                : result.kind === 'not-integer'
                                  ? 'Enter a whole number of minutes.'
                                  : result.kind === 'duplicate'
                                    ? 'That preset already exists.'
                                    : 'Enter a value from 1 to 2,147,483,647 minutes.'
                        );
                        return;
                    }

                    settings.setCountdownPresets(
                        [...new Set([...current, result.minutes])].sort((a, b) => a - b)
                    );
                    setUndoSnapshot(null);
                    setError(null);
                    self.text = '';
                }}
            />
            {error.as(
                (message) =>
                    message && (
                        <Gtk.Label
                            label={message}
                            cssClasses={['error', 'caption']}
                            xalign={0}
                            wrap
                            marginStart={12}
                            marginEnd={12}
                        />
                    )
            )}
            <Adw.ActionRow title={'Presets'} subtitle={presetSubtitle}>
                <Gtk.Button
                    label="Undo"
                    sensitive={undoSnapshot.as((snapshot) => snapshot !== null)}
                    onClicked={() => {
                        const snapshot = undoSnapshot();
                        if (snapshot === null) return;
                        settings.setCountdownPresets(snapshot);
                        setUndoSnapshot(null);
                    }}
                />
                <Gtk.Button
                    label="Restore default presets"
                    onClicked={() => {
                        setUndoSnapshot([...settings.countdownPresets()]);
                        settings.setCountdownPresets([...DEFAULT_COUNTDOWN_PRESETS]);
                        setError(null);
                    }}
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
