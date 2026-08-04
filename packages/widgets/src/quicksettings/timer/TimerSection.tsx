import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import TimerService from '@shade/services/time/timerService';
import {useStyle} from '@shade/style/useStyle';
import {bind, computed, createState} from 'gnim';

function fmtRemaining(ms: number): string {
    if (ms < 0) return '--:--';
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const PRESETS = [
    [1, 5, 10],
    [15, 30, 60],
];

export const TimerSection = () => {
    const timer = TimerService.get_default();
    const displayStyles = useStyle({fontSize: '24px', fontWeight: 'bold'});
    const labelStyles = useStyle({marginTop: '4px'});
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

    const readCustom = (self: Gtk.Button) => {
        const box = self.get_parent();
        if (!(box instanceof Gtk.Box)) return;
        const spins: Gtk.SpinButton[] = [];
        let child = box.get_first_child();
        while (child) {
            if (child instanceof Gtk.SpinButton) spins.push(child);
            child = child.get_next_sibling();
        }
        if (spins.length >= 3) {
            const h = spins[0]!.get_value_as_int();
            const m = spins[1]!.get_value_as_int();
            const s = spins[2]!.get_value_as_int();
            const ms = (h * 3600 + m * 60 + s) * 1000;
            if (ms > 0) bus.emit('timer:cmd:start-countdown', ms);
        }
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
                marginTop={12}
                marginBottom={12}
                marginStart={12}
                marginEnd={12}
            >
                <Gtk.Label
                    ref={displayStyles.$}
                    label={remaining.as((r) => fmtRemaining(r))}
                    cssClasses={[displayStyles.class, 'numeric']}
                    halign={Gtk.Align.CENTER}
                />
                <Gtk.Label
                    ref={labelStyles.$}
                    label={label}
                    cssClasses={[labelStyles.class]}
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
                        tooltipText={running.as((r) => (r ? 'Pause' : 'Resume'))}
                        onClicked={() => {
                            if (timer.running) bus.emit('timer:cmd:pause');
                            else bus.emit('timer:cmd:resume');
                        }}
                    />
                    <Gtk.Button
                        cssClasses={['circular']}
                        iconName={'media-playback-stop-symbolic'}
                        tooltipText="Stop"
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
                <Gtk.Box cssClasses={['linked']} halign={Gtk.Align.CENTER}>
                    <Gtk.ToggleButton
                        active={selectedMode.as((m) => m === 'countdown')}
                        cssClasses={[]}
                        onClicked={() => setSelectedMode('countdown')}
                    >
                        <Gtk.Label label="Timer" />
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
                            const flat = PRESETS.flat();
                            flat.forEach((min, i) => {
                                const btn = new Gtk.Button({
                                    cssClasses: ['flat'],
                                    hexpand: true,
                                });
                                const label = new Gtk.Label({
                                    label: min >= 60 ? `${min / 60}h` : `${min}m`,
                                });
                                btn.set_child(label);
                                btn.connect('clicked', () =>
                                    bus.emit('timer:cmd:start-countdown', min * 60 * 1000)
                                );
                                self.attach(btn, i % 3, Math.floor(i / 3), 1, 1);
                            });
                        }}
                    ></Gtk.Grid>

                    {/* Custom entry */}
                    <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                        <Gtk.SpinButton
                            adjustment={Gtk.Adjustment.new(0, 0, 99, 1, 10, 0)}
                            digits={0}
                            valign={Gtk.Align.CENTER}
                            widthRequest={52}
                        />
                        <Gtk.Label label="h" cssClasses={['caption', 'dim-label']} />
                        <Gtk.SpinButton
                            adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
                            digits={0}
                            valign={Gtk.Align.CENTER}
                            widthRequest={52}
                        />
                        <Gtk.Label label="m" cssClasses={['caption', 'dim-label']} />
                        <Gtk.SpinButton
                            adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
                            digits={0}
                            valign={Gtk.Align.CENTER}
                            widthRequest={52}
                        />
                        <Gtk.Label label="s" cssClasses={['caption', 'dim-label']} />
                        <Gtk.Button
                            cssClasses={['circular']}
                            iconName="media-playback-start-symbolic"
                            tooltipText="Start custom timer"
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
                        marginTop={12}
                        marginBottom={12}
                        marginStart={12}
                        marginEnd={12}
                    >
                        <Gtk.Label
                            label="Focus for 25 minutes, then take a 5 minute break."
                            cssClasses={['body']}
                            wrap
                            halign={Gtk.Align.START}
                        />
                        <Gtk.Label
                            label="Long break (15m) after every 4 sessions."
                            cssClasses={['caption', 'dim-label']}
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
                            label="Start Pomodoro"
                        />
                    </Gtk.Button>
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.Box>
    );
};
