import Wireplumber from "gi://AstalWp"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { getVolumeIcon } from "#/lib/audio"
import AppMixer from "#/lib/appMixer"

const MUTED_SPEAKER_ICON = "audio-volume-muted-symbolic"
const MUTED_MIC_ICON = "microphone-sensitivity-muted-symbolic"

export const SpeakerIndicator = () => {
  const audio = Wireplumber.get_default()!.audio
  return <Gtk.Image
    visible={createBinding(audio, "speakers")
      .as(rec => rec.length > 0)}
    iconName={getVolumeIcon(audio.default_speaker, MUTED_SPEAKER_ICON)}
    tooltipMarkup={createBinding(audio.default_speaker, "volume")
      .as(v => "Volume: " + (v * 100).toFixed(0).toString() + "%")}
    pixelSize={18} />
}

export const MicrophoneIndicator = () => {
  const audio = Wireplumber.get_default()!.audio
  const mixer = AppMixer.get_default()
  return <Gtk.Image
    visible={createBinding(mixer, "capture-streams")
      .as(streams => streams.length > 0)}
    iconName={getVolumeIcon(audio.default_microphone, MUTED_MIC_ICON)}
    tooltipMarkup={createBinding(audio.default_microphone, "volume")
      .as(v => (v * 100).toFixed(0).toString() + "%")}
    pixelSize={18} />
}
