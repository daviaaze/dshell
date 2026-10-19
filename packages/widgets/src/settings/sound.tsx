import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import type Wireplumber from 'gi://AstalWp';
import {bind, computed, effect, With} from 'gnim';
import AudioController from '@shade/services/audio/audioController';

function EndpointControls({
    endpoint,
    kind,
}: {
    endpoint: Wireplumber.Endpoint;
    kind: 'output' | 'microphone';
}) {
    const audio = AudioController.get_default();
    const muted = bind(endpoint, 'mute');
    const volume = bind(endpoint, 'volume');
    const description = bind(endpoint, 'description');
    const endpointName = bind(endpoint, 'name');
    const name = computed(() =>
        description() || endpointName() || (kind === 'output' ? 'Output device' : 'Microphone')
    );
    let restoringMute = false;

    return (
        <>
            <Adw.ActionRow title={kind === 'output' ? 'Output device' : 'Microphone'} subtitle={name} />
            <Adw.ActionRow
                title="Volume"
                subtitle={volume.as((value) => `${Math.round(value * 100)}%`)}
            >
                <Gtk.Scale
                    orientation={Gtk.Orientation.HORIZONTAL}
                    adjustment={new Gtk.Adjustment({
                        value: endpoint.volume,
                        lower: 0,
                        upper: 1,
                        stepIncrement: 0.05,
                    })}
                    ref={(scale) => {
                        effect(() => scale.set_value(volume()));
                    }}
                    widthRequest={200}
                    onValueChanged={(scale) => {
                        const value = scale.get_value();
                        if (value === endpoint.volume) return;
                        try {
                            audio.setVolume(endpoint, value);
                        } finally {
                            scale.set_value(endpoint.volume);
                        }
                    }}
                />
            </Adw.ActionRow>
            <Adw.SwitchRow
                title="Mute"
                active={muted}
                onNotifyActive={(self) => {
                    if (restoringMute || self.active === endpoint.mute) return;
                    try {
                        audio.setMute(endpoint, self.active);
                    } finally {
                        // A failed/rejected native request is not the confirmed state.
                        restoringMute = true;
                        self.active = endpoint.mute;
                        restoringMute = false;
                    }
                }}
            />
        </>
    );
}

export default () => {
    const audio = AudioController.get_default();
    const defaultSpeaker = bind(audio, 'defaultSpeaker');
    const defaultMic = bind(audio, 'defaultMicrophone');

    return (
        <>
            <Adw.PreferencesGroup title="Output">
                <With value={defaultSpeaker}>
                    {(endpoint) =>
                        endpoint ? (
                            <EndpointControls endpoint={endpoint} kind="output" />
                        ) : (
                            <Adw.ActionRow
                                title="No output device available"
                                subtitle="Connect or enable an output device to adjust its volume and mute."
                            />
                        )
                    }
                </With>
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup title="Input">
                <With value={defaultMic}>
                    {(endpoint) =>
                        endpoint ? (
                            <EndpointControls endpoint={endpoint} kind="microphone" />
                        ) : (
                            <Adw.ActionRow
                                title="No microphone available"
                                subtitle="Connect or enable a microphone to adjust its volume and mute."
                            />
                        )
                    }
                </With>
            </Adw.PreferencesGroup>
        </>
    );
};
