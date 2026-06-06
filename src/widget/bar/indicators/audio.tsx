import Wireplumber from "gi://AstalWp"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"
import AppMixer from "#/lib/appMixer"

const MUTED_SPEAKER_ICON = "audio-volume-muted-symbolic"
const MUTED_MIC_ICON = "microphone-sensitivity-muted-symbolic"

function volumeIcon(device: Wireplumber.Endpoint, mutedIcon: string): string {
  if (device.mute || device.volume === 0) return mutedIcon
  return device.volumeIcon
}

function volumeTooltip(v: number) {
  return `Volume: ${(v * 100).toFixed(0).toString()}%`
}

export const SpeakerIndicator = () => {
  const [visible, setVisible] = createState(false)
  const [iconName, setIconName] = createState(MUTED_SPEAKER_ICON)
  const [tooltip, setTooltip] = createState("")

  onMount(() => {
    // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const audio = Wireplumber.get_default()!.audio
      const update = () => {
        const speakers = audio.speakers
        setVisible(speakers.length > 0)
        const speaker = audio.default_speaker
        setIconName(volumeIcon(speaker, MUTED_SPEAKER_ICON))
        setTooltip(volumeTooltip(speaker.volume))
      }
      update()
      audio.connect("notify::speakers", update)
      audio.default_speaker.connect("notify::volume", update)
      audio.default_speaker.connect("notify::mute", update)
      audio.default_speaker.connect("notify::volumeIcon", update)
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Image
      visible={visible}
      iconName={iconName}
      tooltipMarkup={tooltip}
      pixelSize={18}
    />
  )
}

export const MicrophoneIndicator = () => {
  const [visible, setVisible] = createState(false)
  const [iconName, setIconName] = createState(MUTED_MIC_ICON)
  const [tooltip, setTooltip] = createState("")

  onMount(() => {
    // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const audio = Wireplumber.get_default()!.audio
      const mixer = AppMixer.get_default()
      const update = () => {
        setVisible(mixer.microphone_in_use)
        const mic = audio.default_microphone
        setIconName(volumeIcon(mic, MUTED_MIC_ICON))
        setTooltip(volumeTooltip(mic.volume))
      }
      update()
      mixer.connect("notify::microphone-in-use", update)
      audio.default_microphone.connect("notify::volume", update)
      audio.default_microphone.connect("notify::mute", update)
      audio.default_microphone.connect("notify::volumeIcon", update)
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Image
      visible={visible}
      iconName={iconName}
      tooltipMarkup={tooltip}
      pixelSize={18}
    />
  )
}
