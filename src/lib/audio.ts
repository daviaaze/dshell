import Wireplumber from "gi://AstalWp"
import { createBinding, createComputed } from "gnim"

export function getVolumeIcon(device: Wireplumber.Endpoint, mutedIcon: string) {
  return createComputed([
    createBinding(device, "volume"),
    createBinding(device, "mute"),
    createBinding(device, "volumeIcon"),
  ], (volume, mute, volumeIcon) =>
    (mute || volume === 0) ? mutedIcon : volumeIcon
  )
}
