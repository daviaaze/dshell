import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {timerSettings} from '@shade/services/time/timer.gschema';
import TimerService from '@shade/services/time/timerService';
import {bind, computed, createState, onCleanup} from 'gnim';

function fmtRemaining(ms: number): string {
    if (ms < 0) return '--:--';
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const TimerSection = () => {
    const timer = TimerService.get_default();

    const remaining = bind(timer, 'remaining');
    const total = bind(timer, 'total');
    const running = bind(timer, 'running');
    const mode = bind(timer, 'mode');
    const label = bind(timer, 'label');

    const isActive = computed(() => mode() !== 'none');
    const fraction = computed(() => {
        const rem = remaining();
        const tot = total();
        return rem >= 0 && tot > 0 ? 1 - rem / tot : 0;
    });

    const [selectedMode, setSelectedMode] = createState<'countdown' | 'pomodoro'>('countdown');

    let hoursInput: Gtk.SpinButton | undefined;
    let minutesInput: Gtk.SpinButton | undefined;
    let secondsInput: Gtk.SpinButton | undefined;

    const readCustom = () => {
        if (!hoursInput || !minutesInput || !secondsInput) return;
        const h = hoursInput.get_value_as_int();
        const m = minutesInput.get_value_as_int();
        const s = secondsInput.get_value_as_int();
        const ms = (h * 3600 + m * 60 + s) * 1000;
        if (ms > 0) bus.emit('timer:cmd:start-countdown', ms);
    };

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8} halign={Gtk.Align.FILL}>
            {/* ── Running state ── */}
            <Gtk.Box
                visible={isActive}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={12}
                halign={Gtk.Align.FILL}
                cssClasses={['card']}
            >
                <Gtk.Label
                    label={remaining.as((r) => fmtRemaining(r))}
                    css={'font-size: 24px; font-weight: bold;'}
                    cssClasses={['numeric']}
                    halign={Gtk.Align.CENTER}
                />
                <Gtk.Label
                    marginTop={4}
                    label={label}
                    halign={Gtk.Align.CENTER}
                    visible={label.as((l) => l.length > 0)}
                />
                <Gtk.ProgressBar fraction={fraction} hexpand />
                <Gtk.Box spacing={8} halign={Gtk.Align.CENTER} hexpand={false}>
                    <Gtk.Button
                        cssClasses={['circular']}
                        iconName={running.as((r) =>
                            r ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic'
                        )}
                        tooltipText={running.as((r) => (r ? 'Pausar' : 'Retomar'))}
                        onClicked={() => {
                            if (timer.running) bus.emit('timer:cmd:pause');
                            else bus.emit('timer:cmd:resume');
                        }}
                    />
                    <Gtk.Button
                        cssClasses={['circular']}
                        iconName={'media-playback-stop-symbolic'}
                        tooltipText="Parar"
                        onClicked={() => bus.emit('timer:cmd:cancel')}
                    />
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Idle state ── */}
            <Gtk.Box
                visible={isActive.as((a) => !a)}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                halign={Gtk.Align.FILL}
            >
                {/* Mode tabs */}
                <Gtk.Box cssClasses={['linked', 'horizontal']} halign={Gtk.Align.CENTER}>
                    <Gtk.ToggleButton
                        active={selectedMode.as((m) => m === 'countdown')}
                        cssClasses={[]}
                        onClicked={() => setSelectedMode('countdown')}
                    >
                        <Gtk.Label label="Contagem regressiva" />
                    </Gtk.ToggleButton>
                    <Gtk.ToggleButton
                        active={selectedMode.as((m) => m === 'pomodoro')}
                        cssClasses={[]}
                        onClicked={() => setSelectedMode('pomodoro')}
                    >
                        <Gtk.Label label="Pomodoro" />
                    </Gtk.ToggleButton>
                </Gtk.Box>

                {/* Countdown — presets + custom */}
                <Gtk.Box
                    visible={selectedMode.as((m) => m === 'countdown')}
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={8}
                    halign={Gtk.Align.FILL}
                >
                    {/* Preset grid — 3 cols × 2 rows */}
                    <Gtk.Grid
                        columnSpacing={4}
                        rowSpacing={4}
                        columnHomogeneous
                        hexpand
                        ref={(self) => {
                            const settings = timerSettings();
                            const update = () => {
                                let child = self.get_first_child();
                                while (child) {
                                    const next = child.get_next_sibling();
                                    self.remove(child);
                                    child = next;
                                }
                                settings.countdownPresets().forEach((min, i) => {
                                    const btn = new Gtk.Button({
                                        cssClasses: ['flat'],
                                        hexpand: true,
                                    });
                                    btn.set_child(
                                        new Gtk.Label({
                                            label: min >= 60 ? `${min / 60}h` : `${min}m`,
                                        })
                                    );
                                    btn.connect('clicked', () =>
                                        bus.emit('timer:cmd:start-countdown', min * 60 * 1000)
                                    );
                                    self.attach(btn, i % 3, Math.floor(i / 3), 1, 1);
                                });
                            };
                            update();
                            const unsubscribe = settings.countdownPresets.subscribe(update);
                            onCleanup(unsubscribe);
                        }}
                    ></Gtk.Grid>

                    {/* Custom entry */}
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={4}
                        halign={Gtk.Align.CENTER}
                    >
                        <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                            <Gtk.SpinButton
                                adjustment={Gtk.Adjustment.new(0, 0, 99, 1, 10, 0)}
                                digits={0}
                                valign={Gtk.Align.CENTER}
                                widthRequest={52}
                                tooltipText="Horas"
                                ref={(self) => {
                                    hoursInput = self;
                                    self.update_property(
                                        [Gtk.AccessibleProperty.LABEL],
                                        [new GObject.Value(GObject.TYPE_STRING, 'Horas')]
                                    );
                                }}
                            />
                            <Gtk.Label label="h" cssClasses={['caption', 'dimmed']} />
                            <Gtk.SpinButton
                                adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
                                digits={0}
                                valign={Gtk.Align.CENTER}
                                widthRequest={52}
                                tooltipText="Minutos"
                                ref={(self) => {
                                    minutesInput = self;
                                    self.update_property(
                                        [Gtk.AccessibleProperty.LABEL],
                                        [new GObject.Value(GObject.TYPE_STRING, 'Minutos')]
                                    );
                                }}
                            />
                            <Gtk.Label label="m" cssClasses={['caption', 'dimmed']} />
                            <Gtk.SpinButton
                                adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
                                digits={0}
                                valign={Gtk.Align.CENTER}
                                widthRequest={52}
                                tooltipText="Segundos"
                                ref={(self) => {
                                    secondsInput = self;
                                    self.update_property(
                                        [Gtk.AccessibleProperty.LABEL],
                                        [new GObject.Value(GObject.TYPE_STRING, 'Segundos')]
                                    );
                                }}
                            />
                            <Gtk.Label label="s" cssClasses={['caption', 'dimmed']} />
                        </Gtk.Box>
                        <Gtk.Button
                            cssClasses={['circular']}
                            iconName="media-playback-start-symbolic"
                            tooltipText="Iniciar temporizador personalizado"
                            ref={(self) =>
                                self.update_property(
                                    [Gtk.AccessibleProperty.LABEL],
                                    [
                                        new GObject.Value(
                                            GObject.TYPE_STRING,
                                            'Iniciar temporizador personalizado'
                                        ),
                                    ]
                                )
                            }
                            onClicked={readCustom}
                        />
                    </Gtk.Box>
                </Gtk.Box>

                {/* Pomodoro */}
                <Gtk.Box
                    visible={selectedMode.as((m) => m === 'pomodoro')}
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={8}
                    halign={Gtk.Align.FILL}
                >
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={4}
                        halign={Gtk.Align.FILL}
                        cssClasses={['card']}
                    >
                        <Gtk.Label
                            label="Concentre-se por 25 minutos e depois faça uma pausa de 5 minutos."
                            cssClasses={['body']}
                            wrap
                            halign={Gtk.Align.START}
                        />
                        <Gtk.Label
                            label="Pausa longa (15 min) a cada 4 sessões."
                            cssClasses={['caption', 'dimmed']}
                            wrap
                            halign={Gtk.Align.START}
                        />
                    </Gtk.Box>
                    <Gtk.Button
                        cssClasses={['raised', 'suggested-action']}
                        halign={Gtk.Align.FILL}
                        hexpand
                        onClicked={() => bus.emit('timer:cmd:start-pomodoro')}
                    >
                        <Adw.ButtonContent
                            iconName="media-playback-start-symbolic"
                            label="Iniciar Pomodoro"
                        />
                    </Gtk.Button>
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Box>
    );
};
