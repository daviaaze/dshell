import Wireplumber from "gi://AstalWp"
import { createBinding } from "gnim"
import logger from "#/lib/logger"

export function initAutoSwitch() {
  const audio = Wireplumber.get_default()!.audio
  let knownIds = new Set<number>()

  const binding = createBinding(audio, "speakers")
  binding.subscribe(() => {
    const speakers = binding.get()
    if (!speakers) return
    const currentIds = new Set(speakers.map(s => s.id))

    for (const speaker of speakers) {
      // Skip devices we already knew about
      if (knownIds.has(speaker.id)) continue

      // Check if this is a bluetooth device using PipeWire's node name
      const name = speaker.name || ""
      const isBluetooth = name.startsWith("bluez_output")

      if (isBluetooth) {
        logger.log(`[AudioAutoSwitch] New bluetooth device: ${speaker.description} (${name}) — switching to it`)
        speaker.isDefault = true
      }
    }

    knownIds = currentIds
  })
}
