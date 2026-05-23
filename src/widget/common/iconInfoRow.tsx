import Gtk from "gi://Gtk?version=4.0"
import { Accessor } from "gnim"

interface IconInfoRowProps {
  icon: Accessor<string> | string
  primary: Accessor<string> | string
  secondary?: Accessor<string> | string
  pixelSize?: number
  visible?: Accessor<boolean> | boolean
}

export const IconInfoRow = (props: IconInfoRowProps) => (
  <Gtk.Box
    spacing={4}
    marginStart={8}
    marginEnd={8}
    hexpand
    halign={Gtk.Align.CENTER}
    visible={props.visible ?? true}
  >
    <Gtk.Image iconName={props.icon} pixelSize={props.pixelSize ?? 20} />
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Label label={props.primary} />
      {props.secondary && <Gtk.Label label={props.secondary} />}
    </Gtk.Box>
  </Gtk.Box>
)
