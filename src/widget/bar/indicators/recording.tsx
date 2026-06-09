import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import Screenshot from "#/lib/screenshot"

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `0:${s.toString().padStart(2, "0")}`
}

export default () => {
  const screenshot = Screenshot.get_default()

  return (
    <Gtk.Button
      visible={createBinding(screenshot, "recording")}
      onClicked={() => screenshot.stopRecording()}
      cssClasses={["flat"]}
      tooltipText="Click to stop recording"
    >
      <Gtk.Box spacing={6}>
        <Gtk.Image
          iconName="media-record-symbolic"
          cssClasses={["error"]}
          pixelSize={14}
        />
        <Gtk.Label
          label={createBinding(screenshot, "recording-elapsed").as(
            (sec) => formatDuration(sec ?? 0),
          )}
          cssClasses={["error", "recording-duration"]}
        />
      </Gtk.Box>
    </Gtk.Button>
  )
}
