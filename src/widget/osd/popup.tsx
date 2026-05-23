import GObject from "gi://GObject?version=2.0"
import Gtk from "gi://Gtk?version=4.0"

const TIMEOUT_MS = 2000

export default ({
  widget,
  connectable,
  signals,
}: {
  widget: GObject.Object
  connectable: GObject.Object
  signals: string[]
}) => (
  <Gtk.Revealer
    transitionDuration={200}
    revealChild={false}
    visible={false}
    transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
    $={(self) => {
      let timeoutId: number | null = null
      let visibilityTimeoutId: number | null = null
      const showPopup = () => {
        if (timeoutId) clearTimeout(timeoutId)
        if (visibilityTimeoutId) clearTimeout(visibilityTimeoutId)
        self.visible = true
        self.revealChild = true
        timeoutId = setTimeout(() => {
          self.revealChild = false
          visibilityTimeoutId = setTimeout(() => (self.visible = false), 200)
        }, TIMEOUT_MS)
      }
      for (const signal of signals) {
        connectable.connect(signal, showPopup)
      }
    }}
  >
    {widget}
  </Gtk.Revealer>
)
