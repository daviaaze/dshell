import GObject from "gi://GObject?version=2.0"
import Gtk from "gi://Gtk?version=4.0"

const TIMEOUT_MS = 2000

export default ({ widget, connectable, signal }: {
  widget: GObject.Object,
  connectable: GObject.Object,
  signal: string,
}) =>
  <Gtk.Revealer
    transitionDuration={200}
    revealChild={false}
    visible={false}
    transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
    $={self => {
      let timeoutId: number | null = null
      let visibilityTimeoutId: number | null = null
      connectable.connect(signal, () => {
        if (timeoutId) clearTimeout(timeoutId)
        if (visibilityTimeoutId) clearTimeout(visibilityTimeoutId)
        self.visible = true
        self.revealChild = true
        timeoutId = setTimeout(() => {
          self.revealChild = false
          visibilityTimeoutId = setTimeout(() =>
            self.visible = false
            , 200)
        }, TIMEOUT_MS)
      })
    }}>
    {widget}
  </Gtk.Revealer>
