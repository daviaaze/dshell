import Screenshot from "#/lib/screenshot"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"

export default () => {
  const screenshot = Screenshot.get_default()
  return <Adw.SplitButton
    cssClasses={["raised"]}
    widthRequest={150}
    $={self => {
      self.connect("clicked", () => {
        screenshot.toggleRecording()
      })
      self.connect("destroy", () => {
        const popover = self.popover
        if (popover?.parent) popover.unparent()
      })
    }}
    popover={
      <Gtk.Popover cssClasses={[]}>
        <Gtk.Box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={8}
          marginStart={8}
          marginEnd={8}
          marginTop={8}
          marginBottom={8}>
          <Gtk.Box
            cssClasses={["linked"]}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}>
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
          <Gtk.Separator />
          <Gtk.Box
            cssClasses={["linked"]}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}>
            <Gtk.Button onClicked={() => screenshot.toggleRecording()}>
              <Adw.ButtonContent
                iconName="camera-video-symbolic"
                label="Record" />
            </Gtk.Button>
            <Gtk.Button onClicked={() => screenshot.recordArea()}>
              <Adw.ButtonContent
                iconName="selection-mode-symbolic"
                label="Record Area" />
            </Gtk.Button>
            <Gtk.Button onClicked={() => screenshot.recordWindow()}>
              <Adw.ButtonContent
                iconName="window-symbolic"
                label="Record Window" />
            </Gtk.Button>
            <Gtk.Button onClicked={() => screenshot.recordOutput()}>
              <Adw.ButtonContent
                iconName="video-display-symbolic"
                label="Record Output" />
            </Gtk.Button>
          </Gtk.Box>
          <Gtk.Box
            spacing={8}
            orientation={Gtk.Orientation.HORIZONTAL}
            marginStart={4}>
            <Gtk.CheckButton
              active={createBinding(screenshot, "audio")}
              onNotifyActive={({ active }) => {
                screenshot.audio = active
              }} />
            <Gtk.Label label="Record Audio" />
          </Gtk.Box>
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
