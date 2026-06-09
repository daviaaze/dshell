import Wireplumber from "gi://AstalWp"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createState, onMount } from "gnim"
import Brightness from "#/lib/brightness"
import { AudioEndpointControl } from "#/widget/common/audioControl"
import { Slider } from "#/widget/common/slider"
import logger from "#/lib/logger"

export const AudioConfig = () => {
  logger.log("AudioConfig:")
  const [speakers, setSpeakers] = createState<Wireplumber.Endpoint[]>([])
  const [defaultSpeaker, setDefaultSpeaker] =
    createState<Wireplumber.Endpoint | null>(null)

  onMount(() => {
    // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const audio = Wireplumber.get_default()!.audio
      const update = () => {
        setSpeakers([...(audio.speakers ?? [])])
        setDefaultSpeaker(audio.default_speaker)
      }
      update()
      audio.connect("notify::speakers", update)
      audio.connect("notify::default-speaker", update)
      return GLib.SOURCE_REMOVE
    })
  })

  logger.info("AudioConfig done")
  return (
    <AudioEndpointControl
      visible={speakers.as((s) => s.length > 0)}
      defaultDevice={defaultSpeaker}
      devices={speakers}
      mutedIcon="audio-volume-muted-symbolic"
      showAppMixer
    />
  )
}

export const MicConfig = () => {
  logger.info("MicConfig:")
  const [microphones, setMicrophones] = createState<Wireplumber.Endpoint[]>([])
  const [defaultMicrophone, setDefaultMicrophone] =
    createState<Wireplumber.Endpoint | null>(null)

  onMount(() => {
    // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const audio = Wireplumber.get_default()!.audio
      const update = () => {
        setMicrophones([...(audio.microphones ?? [])])
        setDefaultMicrophone(audio.default_microphone)
      }
      update()
      audio.connect("notify::microphones", update)
      audio.connect("notify::default-microphone", update)
      return GLib.SOURCE_REMOVE
    })
  })

  logger.log("MicConfig done")
  return (
    <AudioEndpointControl
      visible={microphones.as((m) => m.length > 0)}
      defaultDevice={defaultMicrophone}
      devices={microphones}
      mutedIcon="microphone-sensitivity-muted-symbolic"
    />
  )
}

export const BrightnessSlider = () => {
  logger.log("BrightnessSlider: get_default()")
  const brightness = Brightness.get_default()
  logger.log("BrightnessSlider: done")
  return (
    <Slider
      visible={createBinding(brightness, "screen").as((v) => v > 0)}
      icon={"display-brightness-symbolic"}
      min={1}
      max={100}
      value={createBinding(brightness, "screen").as((v) => v * 100)}
      setValue={(value) => brightness.set({ screen: value / 100 })}
    />
  )
}
