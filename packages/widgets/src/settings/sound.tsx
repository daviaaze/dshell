import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { bind } from 'gnim';
import AudioController from '@shade/services/audio/audioController';

export default () => {
    const audio = AudioController.get_default();
    const defaultSpeaker = bind(audio, 'defaultSpeaker');
    const defaultMic = bind(audio, 'defaultMicrophone');

    const speakerVolume = defaultSpeaker.as((s) => (s ? s.volume : 0));
    const speakerMuted = defaultSpeaker.as((s) => (s ? s.mute : false));
    const micVolume = defaultMic.as((m) => (m ? m.volume : 0));
    const micMuted = defaultMic.as((m) => (m ? m.mute : false));
    const handleSpeakerVolume = (scale: Gtk.Scale) => {
        const value = scale.get_value();
        const speaker = audio.defaultSpeaker;
        if (speaker) speaker.set_volume(value);
    };

    const handleMicVolume = (scale: Gtk.Scale) => {
        const value = scale.get_value();
        const mic = audio.defaultMicrophone;
        if (mic) mic.set_volume(value);
    };
    
    const handleSpeakerMute = (self: Adw.SwitchRow) => {
        const speaker = audio.defaultSpeaker;
        if (speaker) speaker.set_mute(self.active);
    };
    
    const handleMicMute = (self: Adw.SwitchRow) => {
        const mic = audio.defaultMicrophone;
        if (mic) mic.set_mute(self.active);
    };

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
            <Adw.PreferencesGroup title="Output">
                <Adw.ActionRow title="Volume" subtitle={speakerVolume.as((v) => `${Math.round(v * 100)}%`)}>
                    <Gtk.Scale
                        orientation={Gtk.Orientation.HORIZONTAL}
                        adjustment={new Gtk.Adjustment({
                            value: speakerVolume(),
                            lower: 0,
                            upper: 1,
                            stepIncrement: 0.05,
                        })}
                        widthRequest={200}
                        onValueChanged={handleSpeakerVolume}
                    />
                </Adw.ActionRow>

                <Adw.SwitchRow
                    title="Mute"
                    active={speakerMuted}
                    onNotifyActive={handleSpeakerMute}
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup title="Input">
                <Adw.ActionRow title="Volume" subtitle={micVolume.as((v) => `${Math.round(v * 100)}%`)}>
                    <Gtk.Scale
                        orientation={Gtk.Orientation.HORIZONTAL}
                        adjustment={new Gtk.Adjustment({
                            value: micVolume(),
                            lower: 0,
                            upper: 1,
                            stepIncrement: 0.05,
                        })}
                        widthRequest={200}
                        onValueChanged={handleMicVolume}
                    />
                </Adw.ActionRow>

                <Adw.SwitchRow
                    title="Mute"
                    active={micMuted}
                    onNotifyActive={handleMicMute}
                />
            </Adw.PreferencesGroup>
        </Gtk.Box>
    );
};
