import Gtk from 'gi://Gtk?version=4.0';
import {bind, For} from 'gnim';
import AudioController from '@shade/services/audio/audioController';
import AppMixer from '@shade/services/audio/mixer';
import {bus} from '@shade/services/bus';
import {usePopoverCleanup} from '../common/popoverCleanup';

export default () => {
    const mixer = AppMixer.get_default();
    const audioCtrl = AudioController.get_default();

    const streams = bind(mixer, 'streams');
    const speakers = bind(audioCtrl, 'speakers');

    return (
        <Gtk.Box spacing={12} orientation={Gtk.Orientation.VERTICAL}>
            <For each={streams}>
                {stream => {
                    const id = stream.id;

                    const OutputSelector = () => {
                        let popoverRef: Gtk.Popover | null = null;

                        const label = streams.as(all => {
                            const s = all.find(s => s.id === id);
                            const targetId = s?.targetNode;
                            if (!targetId) return 'Default';
                            const spk = speakers().find(d => d.id === targetId);
                            return spk?.description ?? 'Default';
                        });

                        return (
                            <Gtk.MenuButton
                                visible={speakers.as(s => s.length > 1)}
                                cssClasses={['flat']}
                                tooltipText="Output device"
                                ref={usePopoverCleanup}
                            >
                                <Gtk.Popover
                                    slot="popover"
                                    ref={self => {
                                        popoverRef = self;
                                    }}
                                    cssClasses={[]}
                                >
                                    <Gtk.Box
                                        spacing={4}
                                        cssClasses={['popover-padded']}
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
                                                label="Default"
                                                maxWidthChars={25}
                                                ellipsize={3}
                                                halign={Gtk.Align.START}
                                                cssClasses={['body']}
                                            />
                                        </Gtk.Button>
                                        <For each={speakers}>
                                            {speaker => (
                                                <Gtk.Button
                                                    cssClasses={['flat']}
                                                    halign={Gtk.Align.FILL}
                                                    onClicked={() => {
                                                        mixer.setTargetNode(
                                                            id,
                                                            speaker.id
                                                        );
                                                        popoverRef?.popdown();
                                                    }}
                                                >
                                                    <Gtk.Label
                                                        label={
                                                            speaker.description ??
                                                            ''
                                                        }
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
                                <Gtk.Label
                                    cssClasses={['caption']}
                                    maxWidthChars={14}
                                    ellipsize={3}
                                    label={label}
                                />
                            </Gtk.MenuButton>
                        );
                    };

                    return (
                        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
                            <Gtk.Image
                                iconName={
                                    stream.iconName ||
                                    'audio-x-generic-symbolic'
                                }
                                pixelSize={16}
                            />
                            <Gtk.Label
                                label={stream.appName}
                                maxWidthChars={18}
                                ellipsize={3}
                                hexpand
                                halign={Gtk.Align.START}
                                cssClasses={['body']}
                            />
                            <OutputSelector />
                            <Gtk.Button
                                iconName={streams.as(all => {
                                    const s = all.find(x => x.id === id);
                                    return s?.muted
                                        ? 'audio-volume-muted-symbolic'
                                        : 'audio-volume-high-symbolic';
                                })}
                                cssClasses={['flat', 'circular']}
                                onClicked={() => {
                                    const s = mixer.streams.find(
                                        x => x.id === id
                                    );
                                    mixer.setMute(id, !(s?.muted ?? false));
                                }}
                            />
                            {(() => {
                                const adjustment = new Gtk.Adjustment({
                                    lower: 0,
                                    upper: 1,
                                    stepIncrement: 0.05,
                                    value: stream.volume,
                                });
                                return (
                                    <Gtk.Scale
                                        widthRequest={100}
                                        adjustment={adjustment}
                                        onValueChanged={self =>
                                            bus.emit(
                                                'audio:app-mixer:set-volume',
                                                {id, value: self.get_value()}
                                            )
                                        }
                                    />
                                );
                            })()}
                            <Gtk.Label
                                cssClasses={['caption']}
                                widthRequest={36}
                                label={streams.as(all => {
                                    const s = all.find(x => x.id === id);
                                    return `${Math.round((s?.volume ?? 0) * 100)}%`;
                                })}
                            />
                        </Gtk.Box>
                    );
                }}
            </For>
            <Gtk.Box
                visible={streams.as(s => s.length === 0)}
                halign={Gtk.Align.CENTER}
                marginTop={12}
                marginBottom={12}
            >
                <Gtk.Label
                    cssClasses={['body']}
                    label="No active audio streams"
                />
            </Gtk.Box>
        </Gtk.Box>
    );
};
