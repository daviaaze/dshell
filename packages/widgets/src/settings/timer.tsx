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
        <Adw.PreferencesGroup title={'Pomodoro'} description={'Ciclo de trabalho e pausas em minutos.'}>
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: 1,
                        upper: 120,
                        stepIncrement: 5,
                        value: settings.pomodoroWorkDuration(),
                    });
                }}
                title={'Trabalho'}
                subtitle={'Duração de cada período de trabalho em minutos.'}
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
                title={'Pausa curta'}
                subtitle={'Duração em minutos.'}
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
                title={'Pausa longa'}
                subtitle={'Duração em minutos.'}
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
                title={'Sessões antes da pausa longa'}
                subtitle={'Número de sessões de trabalho entre pausas longas.'}
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
        <Adw.PreferencesGroup title={'Contagem regressiva'} description={'Presets em minutos inteiros.'}>
            <Adw.EntryRow
                title={'Adicionar preset (minutos inteiros)'}
                showApplyButton
                onApply={(self) => {
                    const current = settings.countdownPresets();
                    const result = validateCountdownPreset(self.text, current);
                    if (result.kind !== 'valid') {
                        setError(
                            result.kind === 'empty'
                                ? 'Informe uma duração em minutos inteiros.'
                                : result.kind === 'not-integer'
                                  ? 'Informe um número inteiro de minutos.'
                                  : result.kind === 'duplicate'
                                    ? 'Este preset já existe.'
                                    : 'Informe de 1 a 2.147.483.647 minutos.'
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
            <Adw.ActionRow title={'Presets existentes'} subtitle={presetSubtitle}>
                <Gtk.Button
                    label="Desfazer última restauração"
                    sensitive={undoSnapshot.as((snapshot) => snapshot !== null)}
                    onClicked={() => {
                        const snapshot = undoSnapshot();
                        if (snapshot === null) return;
                        settings.setCountdownPresets(snapshot);
                        setUndoSnapshot(null);
                    }}
                />
                <Gtk.Button
                    label="Restaurar presets padrão"
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
