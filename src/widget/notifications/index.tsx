import Notifd from "gi://AstalNotifd";
import Hyprland from "gi://AstalHyprland";
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import { For, createBinding, createState, createComputed } from "gnim";
import Notification from "../common/notification";
import { app } from "#/App";

export default () => {
  const notifd = Notifd.get_default();
  const hyprland = Hyprland.get_default();

  const [notifs, setNotifs] = createState<Notifd.Notification[]>([])
  const timeouts = new Map<number, number>()

  const addNotif = (id: number) => {
    const n = notifd.get_notification(id)
    if (!n) return
    setNotifs(prev => prev.concat(n))
    timeouts.set(id, setTimeout(() => {
      setNotifs(prev => prev.filter(x => x.id !== id))
      timeouts.delete(id)
    }, 5000))
  }

  const removeNotif = (id: number) => {
    const tid = timeouts.get(id)
    if (tid) {
      clearTimeout(tid)
      timeouts.delete(id)
    }
    setNotifs(prev => prev.filter(x => x.id !== id))
  }

  const pauseDismiss = (id: number) => {
    const tid = timeouts.get(id)
    if (tid) {
      clearTimeout(tid)
      timeouts.delete(id)
    }
  }

  const resumeDismiss = (id: number) => {
    if (timeouts.has(id)) return
    timeouts.set(id, setTimeout(() => {
      setNotifs(prev => prev.filter(x => x.id !== id))
      timeouts.delete(id)
    }, 5000))
  }

  return <Astal.Window
    $={self => app.notifications = self}
    name={"notifications"}
    margin={12}
    cssClasses={["notifications"]}
    visible={createComputed([notifs, createBinding(notifd, "dontDisturb")],
      (notifs, dnd) => notifs.length > 0 && !dnd)
    }
    anchor={
      Astal.WindowAnchor.RIGHT |
      Astal.WindowAnchor.TOP |
      Astal.WindowAnchor.BOTTOM}
    monitor={createBinding(hyprland, "focusedMonitor").as(m => m.id)}
    application={app}>
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      $={() => notifd.connect("notified",
        (_, id) => addNotif(id))}>
      <For each={notifs(n => n.reverse())}>
        {(n: Notifd.Notification) =>
          <Notification
            closeAction={() => removeNotif(n.id)}
            pauseDismiss={() => pauseDismiss(n.id)}
            resumeDismiss={() => resumeDismiss(n.id)}
            notif={n} />
        }
      </For>
    </Gtk.Box>
  </Astal.Window > as Astal.Window
}
