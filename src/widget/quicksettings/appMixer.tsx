import Gtk from "gi://Gtk?version=4.0"
import { createBinding, For } from "gnim"
import AppMixer from "#/lib/appMixer"
import { Slider } from "../common/slider"

export default () => {
  const mixer = AppMixer.get_default()

  return <Gtk.Box
    visible={createBinding(mixer, "streams").as(s => s.length > 0)}
    spacing={8}
    cssClasses={["card"]}
    orientation={Gtk.Orientation.VERTICAL}
    marginTop={8}>
    <Gtk.Label
      halign={Gtk.Align.START}
      marginStart={8}
      marginTop={8}
      cssClasses={["caption-heading"]}
      label="Applications" />
    <Gtk.Box
      marginStart={8}
      marginEnd={8}
      marginBottom={8}
      spacing={8}
      orientation={Gtk.Orientation.VERTICAL}>
      <For each={createBinding(mixer, "streams")}>
        {stream => (
          <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
            <Gtk.Image
              iconName={stream.iconName || "audio-x-generic-symbolic"}
              pixelSize={20} />
            <Gtk.Label
              label={stream.appName}
              maxWidthChars={12}
              ellipsize={3}
              hexpand
              halign={Gtk.Align.START}
              cssClasses={["body"]} />
            <Gtk.Button
              iconName={stream.muted ? "audio-volume-muted-symbolic" : "audio-volume-high-symbolic"}
              cssClasses={["flat", "circular"]}
              onClicked={() => mixer.setMute(stream.id, !stream.muted)} />
            <Gtk.Scale
              widthRequest={100}
              adjustment={
                <Gtk.Adjustment
                  lower={0}
                  upper={1}
                  stepIncrement={0.05}
                  value={stream.volume}
                /> as Gtk.Adjustment}
              onValueChanged={self =>
                mixer.setVolume(stream.id, self.get_value())}
            />
          </Gtk.Box>
        )}
      </For>
    </Gtk.Box>
  </Gtk.Box>
}
