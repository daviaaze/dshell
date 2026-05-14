import Wireplumber from "gi://AstalWp"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createBinding } from "gnim"
import ShellState from "#/lib/shellState"
import RecordingIndicator from "./indicators/recording"
import PowerIndicator from "./indicators/power"
import BluetoothIndicator from "./indicators/bluetooth"
import NetworkIndicator from "./indicators/network"
import BatteryIndicator from "./indicators/battery"
import { SpeakerIndicator, MicrophoneIndicator } from "./indicators/audio"
import DNDIndicator from "./indicators/dnd"

export default ({ vertical }: { vertical: Accessor<boolean> }) => {
  const audio = Wireplumber.get_default()!.audio

  return <Gtk.ToggleButton
    cursor={Gdk.Cursor.new_from_name("pointer", null)}
    active={createBinding(ShellState.get_default(), "qsOpen")}
    onClicked={() => ShellState.get_default().toggleQuickSettings()}
    $={self => self.add_controller(
      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL}
        onScroll={(self, dx, dy) => {
          if (dy > 0)
            audio.default_speaker.volume -= 0.025
          else
            audio.default_speaker.volume += 0.025
        }}
      /> as Gtk.EventController)}>
    <Gtk.Box
      spacing={4}
      orientation={vertical.as(v => v ?
        Gtk.Orientation.VERTICAL :
        Gtk.Orientation.HORIZONTAL)}>
      <RecordingIndicator />
      <PowerIndicator />
      <BluetoothIndicator />
      <NetworkIndicator />
      <BatteryIndicator />
      <MicrophoneIndicator />
      <SpeakerIndicator />
      <DNDIndicator />
    </Gtk.Box>
  </Gtk.ToggleButton>
}
