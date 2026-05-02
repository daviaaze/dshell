import Wireplumber from "gi://AstalWp"
import { createBinding } from "gnim"
import Brightness from "#/lib/brightness"
import { AudioEndpointControl } from "../common/audioControl"
import { Slider } from "../common/slider"
import logger from "#/lib/logger"

export const AudioConfig = () => {
  logger.log("AudioConfig:")
  const audio = Wireplumber.get_default()!.audio
  logger.log("AudioConfig done")
  return <AudioEndpointControl
    visible={createBinding(audio, 'speakers')
      .as(s => s.length > 0)}
    defaultDevice={createBinding(audio, "defaultSpeaker")}
    devices={createBinding(audio, 'speakers')}
    mutedIcon="audio-volume-muted-symbolic"
  />
}

export const MicConfig = () => {
  logger.log("MicConfig:")
  const audio = Wireplumber.get_default()!.audio
  logger.log("MicConfig done")
  return <AudioEndpointControl
    visible={createBinding(audio, 'microphones')
      .as(m => m.length > 0)}
    defaultDevice={createBinding(audio, "defaultMicrophone")}
    devices={createBinding(audio, "microphones")}
    mutedIcon="microphone-sensitivity-muted-symbolic"
  />
}

export const BrightnessSlider = () => {
  logger.log("BrightnessSlider: get_default()")
  const brightness = Brightness.get_default();
  logger.log("BrightnessSlider: done")
  return <Slider
    visible={createBinding(brightness, "screen")
      .as((v) => v > 0)}
    icon={"display-brightness-symbolic"}
    min={1}
    max={100}
    value={createBinding(brightness, "screen")
      .as((v) => v * 100)}
    setValue={(value) => (
      brightness.set({ screen: value / 100 }))}
  />
}
