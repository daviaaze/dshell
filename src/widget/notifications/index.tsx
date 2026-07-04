import Notifd from "gi://AstalNotifd"
import Hyprland from "gi://AstalHyprland"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { For, createBinding, createState, createComputed, onMount, onCleanup } from "gnim"
import Notification from "#/widget/common/notification"
import { app } from "#/App"
import WindowManager from "#/lib/windowManager"
import { getNotifdSafe } from "#/lib/notifdGuard"
import { useSettings } from "#/lib/settings"
import logger from "#/lib/logger"
import ShellState from "#/lib/shellState"
import { connectFor, cleanupNode } from "#/lib/connectFor"

const NotificationContent = ({
  notifd,
  setNotificationCount,
  showProgress,
}: {
  notifd: Notifd.Notifd
  setNotificationCount: (n: number) => void
  showProgress: boolean
}) => {
  const [notifications, setNotifications] = createState<Notifd.Notification[]>(
    [],
  )
  const timeouts = new Map<number, GLib.Source>()

  const addNotification = (id: number) => {
    const n = notifd.get_notification(id)
    if (!n) return
    setNotifications((prev) => {
      const next = prev.concat(n)
      setNotificationCount(next.length)
      return next
    })
    const expireMs =
      n.expire_timeout > 0 ? n.expire_timeout : notifd.default_timeout > 0
        ? notifd.default_timeout
        : 5000
    timeouts.set(
      id,
      setTimeout(
        () => {
          setNotifications((prev) => {
            const next = prev.filter((x) => x.id !== id)
            setNotificationCount(next.length)
            return next
          })
          timeouts.delete(id)
        },
        expireMs,
        [],
      ),
    )
  }

  const removeNotif = (id: number) => {
    const tid = timeouts.get(id)
    if (tid) {
      clearTimeout(tid)
      timeouts.delete(id)
    }
    setNotifications((prev) => {
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
        setNotifications((prev) => {
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
      $={() => {
        const _hn = {}
        connectFor(_hn, notifd, "notified", (_, id) => addNotification(id))
        onCleanup(() => cleanupNode(_hn))
      }}
    >
      <For each={notifications((n) => n.reverse())}>
        {(n: Notifd.Notification) => (
          <Notification
            closeAction={() => removeNotif(n.id)}
            pauseDismiss={() => pauseDismiss(n.id)}
            resumeDismiss={() => resumeDismiss(n.id)}
            showProgress={showProgress}
            notification={n}
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
  const settings = useSettings().general
  const showProgress = settings.notificationShowProgress()

  // Defer Notifd initialization — AstalNotifd blocks 25s if another
  // notification daemon (dunst, mako) is already registered.
  // Also add a timeout guard: if the D-Bus handshake hangs, log a warning
  // after 15 seconds so we know the widget silently never initialized.
  onMount(() => {
    const _hn = {}
    let initialized = false

    // Check if Notifd is already cached from pre-init (services-init phase).
    // If cached (either as instance or null), we're done immediately.
    const cached = getNotifdSafe()
    if (cached !== undefined) {
      initialized = true
      if (cached) {
        setNotifd(cached)
        setDontDisturb(cached.dontDisturb)
        connectFor(_hn, cached, "notify::dontDisturb", () => {
          setDontDisturb(cached.dontDisturb)
        })
      }
      onCleanup(() => cleanupNode(_hn))
      return
    }

    // Not cached yet — schedule async init
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const n = getNotifdSafe()
      initialized = true
      if (!n) {
        return GLib.SOURCE_REMOVE
      }
      setNotifd(n)
      setDontDisturb(n.dontDisturb)
      connectFor(_hn, n, "notify::dontDisturb", () => {
        setDontDisturb(n.dontDisturb)
      })
      return GLib.SOURCE_REMOVE
    })

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
      if (!initialized) {
        logger.warn("notifications", "Notifd.get_default() has not completed after 15s — D-Bus handshake may be hung. Notifications widget will not show.")
      }
      return GLib.SOURCE_REMOVE
    })
    onCleanup(() => cleanupNode(_hn))
  })

  const screenlocked = createBinding(ShellState.get_default(), "screenlocked")

  return (
    <Astal.Window
      $={(self) => WindowManager.get_default().setNotifications(self)}
      name={"notifications"}
      margin={12}
      cssClasses={["notifications"]}
      visible={createComputed(
        () =>
          notifd() !== null &&
          notificationCount() > 0 &&
          !dontDisturb() &&
          !screenlocked(),
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
            showProgress={showProgress}
          />
        )}
      </For>
    </Astal.Window>
  ) as Astal.Window
}
