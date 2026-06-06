import Notifd from "gi://AstalNotifd"
import Hyprland from "gi://AstalHyprland"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { For, createBinding, createState, createComputed, onMount } from "gnim"
import Notification from "#/widget/common/notification"
import { app } from "#/App"
import WindowManager from "#/lib/windowManager"
import { getNotifdSafe } from "#/lib/notifdGuard"

const NotificationContent = ({
  notifd,
  setNotificationCount,
}: {
  notifd: Notifd.Notifd
  setNotificationCount: (n: number) => void
}) => {
  const [notifs, setNotifs] = createState<Notifd.Notification[]>([])
  const timeouts = new Map<number, number>()

  const addNotif = (id: number) => {
    const n = notifd.get_notification(id)
    if (!n) return
    setNotifs((prev) => {
      const next = prev.concat(n)
      setNotificationCount(next.length)
      return next
    })
    timeouts.set(
      id,
      setTimeout(() => {
        setNotifs((prev) => {
          const next = prev.filter((x) => x.id !== id)
          setNotificationCount(next.length)
          return next
        })
        timeouts.delete(id)
      }, 5000),
    )
  }

  const removeNotif = (id: number) => {
    const tid = timeouts.get(id)
    if (tid) {
      clearTimeout(tid)
      timeouts.delete(id)
    }
    setNotifs((prev) => {
      const next = prev.filter((x) => x.id !== id)
      setNotificationCount(next.length)
      return next
    })
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
    timeouts.set(
      id,
      setTimeout(() => {
        setNotifs((prev) => {
          const next = prev.filter((x) => x.id !== id)
          setNotificationCount(next.length)
          return next
        })
        timeouts.delete(id)
      }, 5000),
    )
  }

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      $={(self) => {
        notifd.connect("notified", (_, id) => addNotif(id))
      }}
    >
      <For each={notifs((n) => n.reverse())}>
        {(n: Notifd.Notification) => (
          <Notification
            closeAction={() => removeNotif(n.id)}
            pauseDismiss={() => pauseDismiss(n.id)}
            resumeDismiss={() => resumeDismiss(n.id)}
            notif={n}
          />
        )}
      </For>
    </Gtk.Box>
  )
}

export default () => {
  const [notifd, setNotifd] = createState<Notifd.Notifd | null>(null)
  const [notificationCount, setNotificationCount] = createState(0)
  const [dontDisturb, setDontDisturb] = createState(false)
  const hyprland = Hyprland.get_default()

  // Defer Notifd initialization — AstalNotifd blocks 25s if another
  // notification daemon (dunst, mako) is already registered.
  // Also add a timeout guard: if the D-Bus handshake hangs, log a warning
  // after 15 seconds so we know the widget silently never initialized.
  onMount(() => {
    let initialized = false

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const n = getNotifdSafe()
      if (!n) {
        initialized = true
        return GLib.SOURCE_REMOVE
      }
      setNotifd(n)
      setDontDisturb(n.dontDisturb)
      n.connect("notify::dontDisturb", () => {
        setDontDisturb(n.dontDisturb)
      })
      return GLib.SOURCE_REMOVE
    })

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
      if (!initialized) {
        print("[Shade] [WARN] [notifications] Notifd.get_default() has not completed after 15s — " +
          "D-Bus handshake may be hung. Notifications widget will not show.")
      }
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Astal.Window
      $={(self) => WindowManager.get_default().setNotifications(self)}
      name={"notifications"}
      margin={12}
      cssClasses={["notifications"]}
      visible={createComputed(
        () => notifd() !== null && notificationCount() > 0 && !dontDisturb(),
      )}
      anchor={
        Astal.WindowAnchor.RIGHT |
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM
      }
      monitor={createBinding(hyprland, "focusedMonitor").as((m) => m.id)}
      application={app}
    >
      <For each={notifd.as((n) => (n ? [n] : ([] as Notifd.Notifd[])))}>
        {(n: Notifd.Notifd) => (
          <NotificationContent
            notifd={n}
            setNotificationCount={setNotificationCount}
          />
        )}
      </For>
    </Astal.Window>
  ) as Astal.Window
}
