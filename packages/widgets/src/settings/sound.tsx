import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import type Wireplumber from 'gi://AstalWp';
import {bind, computed, effect, With} from 'gnim';
import AudioController from '@shade/services/audio/audioController';
import AppMixer from '@shade/services/audio/mixer';
import AppMixerControls from '../quicksettings/appMixer';

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
        description() || endpointName() || (kind === 'output' ? 'Dispositivo de saída' : 'Microfone')
    );
    let restoringMute = false;

    return (
        <>
            <Adw.ActionRow
                title={kind === 'output' ? 'Saída atual' : 'Microfone atual'}
                subtitle={name}
            />
            <Adw.ActionRow title={kind === 'output' ? 'Volume de saída' : 'Volume do microfone'}>
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
                title={kind === 'output' ? 'Silenciar saída' : 'Silenciar microfone'}
                subtitle={kind === 'output' ? 'Silencia o dispositivo selecionado.' : 'Silencia o microfone selecionado.'}
                active={muted}
                onNotifyActive={(self) => {
                    if (restoringMute || self.active === endpoint.mute) return;
                    try {
                        audio.setMute(endpoint, self.active);
                    } finally {
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
    const mixerStreams = bind(AppMixer.get_default(), 'streams');

    return (
        <>
            <Adw.PreferencesGroup title="Saída de som" description="Dispositivo padrão, volume e silenciar.">
                <With value={defaultSpeaker}>
                    {(endpoint) =>
                        endpoint ? (
                            <EndpointControls endpoint={endpoint} kind="output" />
                        ) : (
                            <Adw.ActionRow
                                title="Nenhuma saída disponível"
                                subtitle="Conecte ou habilite um dispositivo de saída para ajustar volume e silêncio."
                            />
                        )
                    }
                </With>
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup title="Microfone" description="Dispositivo de entrada padrão.">
                <With value={defaultMic}>
                    {(endpoint) =>
                        endpoint ? (
                            <EndpointControls endpoint={endpoint} kind="microphone" />
                        ) : (
                            <Adw.ActionRow
                                title="Nenhum microfone disponível"
                                subtitle="Conecte ou habilite um microfone para ajustar volume e silêncio."
                            />
                        )
                    }
                </With>
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup
                title="Dispositivos e aplicativos"
                description="Fluxos de áudio ativos e controles do mixer."
            >
                <With value={mixerStreams}>
                    {(streams) => streams.length > 0 ? (
                        <AppMixerControls />
                    ) : (
                        <Adw.ActionRow
                            title="Nenhum aplicativo reproduzindo áudio"
                            subtitle="Os fluxos ativos aparecerão aqui com seus controles."
                        />
                    )}
                </With>
            </Adw.PreferencesGroup>
        </>
    );
};
