import Gtk from "gi://Gtk?version=4.0"
import { JSX } from "gnim"

interface LinkedPopoverBoxProps {
  children: JSX.Element | JSX.Element[]
  margin?: number
  spacing?: number
}

export const LinkedPopoverBox = (props: LinkedPopoverBoxProps) => (
  <Gtk.Box
    cssClasses={["linked"]}
    orientation={Gtk.Orientation.VERTICAL}
    spacing={props.spacing ?? 4}
    marginStart={props.margin ?? 8}
    marginEnd={props.margin ?? 8}
    marginTop={props.margin ?? 8}
    marginBottom={props.margin ?? 8}
  >
    {props.children}
  </Gtk.Box>
)
