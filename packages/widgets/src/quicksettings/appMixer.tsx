import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import AudioController from '@shade/services/audio/audioController';
import AppMixer, {type AudioStream} from '@shade/services/audio/mixer';
import {bus} from '@shade/services/bus';
import {type Accessor, bind, computed, effect, For} from 'gnim';
import {usePopoverCleanup} from '../common/popoverCleanup';
import {preserveRowParents} from './preserveRowParents';

const DEFAULT_OUTPUT_LABEL = 'Padrão';

function setAccessibleLabel(widget: Gtk.Accessible, label: string) {
    widget.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [new GObject.Value(GObject.TYPE_STRING, label)]
    );
}

/** Dropdown for choosing which output device a stream plays through. */
function OutputSelector({
    id,
    mixer,
    stream,
    speakers,
}: {
    id: number;
    mixer: AppMixer;
    stream: Accessor<AudioStream | undefined>;
    speakers: Accessor<{id: number; description: string | null}[]>;
}) {
    let popoverRef: Gtk.Popover | null = null;

    const label = computed(() => {
        const targetId = stream()?.targetNode;
        if (!targetId) return DEFAULT_OUTPUT_LABEL;
        const speaker = speakers().find((device) => device.id === targetId);
        return speaker?.description ?? DEFAULT_OUTPUT_LABEL;
    });

    return (
        <Gtk.MenuButton
            visible={speakers.as((s) => s.length > 1)}
            cssClasses={['flat']}
            tooltipText="Dispositivo de saída"
            ref={(self) => {
                usePopoverCleanup(self);
                effect(() =>
                    setAccessibleLabel(
                        self,
                        `Dispositivo de saída de ${stream()?.appName ?? ''}: ${label()}`
                    )
                );
            }}
        >
            <Gtk.Popover
                slot="popover"
                ref={(self) => {
                    popoverRef = self;
                }}
            >
                <Gtk.Box
                    spacing={4}
                    marginTop={8}
                    marginBottom={8}
                    marginStart={8}
                    marginEnd={8}
                    orientation={Gtk.Orientation.VERTICAL}
                >
                    <Gtk.Button
                        cssClasses={['flat']}
                        halign={Gtk.Align.FILL}
                        onClicked={() => {
                            mixer.setTargetNode(id, -1);
                            popoverRef?.popdown();
                        }}
                    >
                        <Gtk.Label
                            label={DEFAULT_OUTPUT_LABEL}
                            maxWidthChars={25}
                            ellipsize={3}
                            halign={Gtk.Align.START}
                            cssClasses={['body']}
                        />
                    </Gtk.Button>
                    <For each={speakers}>
                        {(speaker) => (
                            <Gtk.Button
                                cssClasses={['flat']}
                                halign={Gtk.Align.FILL}
                                onClicked={() => {
                                    mixer.setTargetNode(id, speaker.id);
                                    popoverRef?.popdown();
                                }}
                            >
                                <Gtk.Label
                                    label={speaker.description ?? ''}
                                    maxWidthChars={25}
                                    ellipsize={3}
                                    halign={Gtk.Align.START}
                                    cssClasses={['body']}
                                />
                            </Gtk.Button>
                        )}
                    </For>
                </Gtk.Box>
            </Gtk.Popover>
            <Gtk.Label cssClasses={['caption']} maxWidthChars={14} ellipsize={3} label={label} />
        </Gtk.MenuButton>
    );
}

/**
 * Single audio stream row: icon, name, output selector, mute, volume.
 *
 * The row is keyed by stream id and outlives the snapshot objects the mixer
 * publishes, so everything it shows is derived from `streams`.
 */
function StreamRow({
    id,
    mixer,
    streams,
    speakers,
}: {
    id: number;
    mixer: AppMixer;
    streams: Accessor<AudioStream[]>;
    speakers: Accessor<{id: number; description: string | null}[]>;
}) {
    const stream = streams.as((all) => all.find((candidate) => candidate.id === id));
    const appName = stream.as((current) => current?.appName ?? '');
    const muted = stream.as((current) => current?.muted ?? false);
    const volume = stream.as((current) => current?.volume ?? 0);
    const muteLabel = computed(() =>
        muted() ? `Reativar som de ${appName()}` : `Silenciar ${appName()}`
    );

    // Keep amplified readback visible even though mixer writes are capped at 100%.
    const sliderValue = volume.as((value) => Math.max(0, value));
    const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: Math.max(1, sliderValue.peek()),
        stepIncrement: 0.05,
        value: sliderValue.peek(),
    });
    let applyingStreamVolume = false;
    effect(() => {
        const value = sliderValue();
        const upper = Math.max(1, value);
        if (adjustment.value === value && adjustment.upper === upper) return;
        applyingStreamVolume = true;
        try {
            adjustment.upper = upper;
            adjustment.value = value;
        } finally {
            applyingStreamVolume = false;
        }
    });

    return (
        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
            <Gtk.Image
                iconName={stream.as((current) => current?.iconName || 'audio-x-generic-symbolic')}
                pixelSize={16}
            />
            <Gtk.Label
                label={appName}
                tooltipText={appName}
                maxWidthChars={18}
                ellipsize={3}
                hexpand
                halign={Gtk.Align.START}
                cssClasses={['body']}
            />
            <OutputSelector id={id} mixer={mixer} stream={stream} speakers={speakers} />
            <Gtk.Button
                iconName={muted.as((isMuted) =>
                    isMuted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic'
                )}
                cssClasses={['flat', 'circular']}
                tooltipText={muteLabel}
                ref={(self) => effect(() => setAccessibleLabel(self, muteLabel()))}
                onClicked={() => mixer.setMute(id, !muted.peek())}
            />
            <Gtk.Scale
                widthRequest={100}
                adjustment={adjustment}
                ref={(self) => effect(() => setAccessibleLabel(self, `Volume de ${appName()}`))}
                onValueChanged={(self) => {
                    if (applyingStreamVolume) return;
                    bus.emit('audio:app-mixer:set-volume', {
                        id,
                        value: self.get_value(),
                    });
                }}
            />
            <Gtk.Label
                cssClasses={['caption']}
                widthRequest={36}
                label={volume.as((value) => `${Math.round(value * 100)}%`)}
            />
        </Gtk.Box>
    );
}

export default () => {
    const mixer = AppMixer.get_default();
    const audioCtrl = AudioController.get_default();

    const streams = bind(mixer, 'streams');
    const speakers = bind(audioCtrl, 'speakers');

    return (
        <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL} ref={preserveRowParents}>
            <For each={streams} id={(stream) => stream.id}>
                {(stream: AudioStream) => (
                    <StreamRow id={stream.id} mixer={mixer} streams={streams} speakers={speakers} />
                )}
            </For>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                visible={streams.as((s) => s.length === 0)}
                halign={Gtk.Align.CENTER}
                marginTop={12}
                marginBottom={12}
            >
                <Gtk.Label
                    cssClasses={['body']}
                    label="Nenhum aplicativo reproduzindo áudio"
                    wrap
                />
                <Gtk.Label
                    cssClasses={['caption', 'dimmed']}
                    label="Os volumes individuais aparecem quando há reprodução"
                    wrap
                />
            </Gtk.Box>
        </Gtk.Box>
    );
};
