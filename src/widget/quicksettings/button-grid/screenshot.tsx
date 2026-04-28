import Screenshot from "#/lib/screenshot"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"

const screenshot = Screenshot.get_default()

export default () => {
  return <Adw.SplitButton
    cssClasses={["raised"]}
    widthRequest={150}
    $={self => {
      self.connect("clicked", () => {
        screenshot.toggleRecording()
      })
    }}
    popover={
      <Gtk.Popover cssClasses={[]}>
        <Gtk.Box
          cssClasses={["linked"]}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={4}
          marginStart={8}
          marginEnd={8}
          marginTop={8}
          marginBottom={8}>
          <Gtk.Button onClicked={() => screenshot.screenshot(true)}>
            <Adw.ButtonContent
              iconName="camera-photo-symbolic"
              label="Screenshot" />
          </Gtk.Button>
          <Gtk.Button onClicked={() => screenshot.screenshot(false)}>
            <Adw.ButtonContent
              iconName="selection-mode-symbolic"
              label="Area Screenshot" />
          </Gtk.Button>
        </Gtk.Box>
      </Gtk.Popover> as Gtk.Popover}>
    <Adw.ButtonContent
      iconName={createBinding(screenshot, "recording").as(rec =>
        rec ? "media-playback-stop-symbolic" : "camera-video-symbolic"
      )}
      label={createBinding(screenshot, "recording").as(rec =>
        rec ? "Stop Recording" : "Record"
      )} />
  </Adw.SplitButton>
}
