import { monitors } from "#/lib/monitors"
import Adw from "gi://Adw?version=1"
import Astal from "gi://Astal?version=4.0"
import AstalAuth from "gi://AstalAuth?version=0.1"
import Gdk from "gi://Gdk?version=4.0"
import SessionLock from "gi://Gtk4SessionLock"
import GLib from "gi://GLib?version=2.0"
import Gtk from "gi://Gtk?version=4.0"
import { createRoot, createState, For, onCleanup, onMount } from "gnim"
import { app } from "#/App"
import { screenlocked, setScreenlocked } from ".."
import FingerprintAuth from "#/lib/fingerprint"

const createLocks = (onUnlock: () => void) => {
  const { LEFT, RIGHT, TOP, BOTTOM } = Astal.WindowAnchor
  const lock = SessionLock.Instance.new()
  const [time, setTime] = createState(GLib.DateTime.new_now_local())
  const [authStatus, setAuthStatus] = createState("")
  const fingerprint = FingerprintAuth.get_default()

  const lockTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    setTime(GLib.DateTime.new_now_local())
    return GLib.SOURCE_CONTINUE
  })

  const doUnlock = () => {
    fingerprint.stop()
    lock.unlock()
    app.lockscreen.forEach(w => w.destroy())
    setScreenlocked(false)
    onUnlock()
  }

  const unlock = (self: Gtk.PasswordEntry) => {
    AstalAuth.Pam.authenticate(self.get_text(), (_, res) => {
      try {
        AstalAuth.Pam.authenticate_finish(res)
        doUnlock()
      } catch (e) {
        console.log(e)
        setAuthStatus("Authentication failed")
      }
    })
  }

  // Initialize fingerprint on mount
  fingerprint.init().then(() => {
    if (fingerprint.available) {
      setAuthStatus("Touch fingerprint reader")
      fingerprint.start()
    }
  })

  fingerprint.connect("verified", () => {
    doUnlock()
  })

  fingerprint.connect("failed", (_, reason) => {
    if (reason === "verify-no-match") {
      setAuthStatus("Fingerprint did not match")
      setTimeout(() => {
        if (fingerprint.available) {
          setAuthStatus("Touch fingerprint reader")
          fingerprint.start()
        }
      }, 500)
    } else {
      setAuthStatus("Fingerprint error")
    }
  })

  fingerprint.connect("statusChanged", (_, status) => {
    if (status === "verify-retry" || status === "verify-swipe-too-short") {
      setAuthStatus("Try again...")
    }
  })

  return <For each={monitors()}>
    {(monitor: Gdk.Monitor) =>
      <Astal.Window
        $={self => {
          app.lockscreen.push(self)
          onCleanup(() => {
            fingerprint.stop()
            GLib.source_remove(lockTimeout)
            app.lockscreen = app.lockscreen.filter(l => l !== self)
          })
        }}
        onRealize={() => {
          for (const window of app.lockscreen) {
            if (!window.get_realized()) return
          }
          lock.lock()
          for (const window of app.lockscreen) {
            lock.assign_window_to_monitor(
              window, window.get_current_monitor()
            )
          }
        }}
        gdkmonitor={monitor}
        anchor={TOP | BOTTOM | LEFT | RIGHT}
        visible
        exclusivity={Astal.Exclusivity.IGNORE}
        keymode={Astal.Keymode.EXCLUSIVE}
      >
        <Gtk.CenterBox
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          orientation={Gtk.Orientation.VERTICAL}
        >
          <Gtk.Box
            $type="start"
            orientation={Gtk.Orientation.VERTICAL}
            marginBottom={12}
          >
            <Gtk.Label
              cssClasses={["title-1", "numeric"]}
              label={time.as(t => t.format("%R")!)}
              css={"font-size: 4em;"}
            />
            <Gtk.Label
              marginBottom={12}
              cssClasses={["title-3", "numeric"]}
              label={time.as(t => t.format("%A, %x")!)}
            />
          </Gtk.Box>
          <Gtk.Box
            $type="center"
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.CENTER}
            spacing={4}
            css={"padding:8px;"}
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["card"]}>
            <Adw.Avatar size={64} />
            <Gtk.Label
              label={GLib.get_real_name()}
              cssClasses={["title-3"]} />
            <Gtk.PasswordEntry
              $={(self) => onMount(() => self.grab_focus())}
              placeholderText={"password"}
              showPeekIcon
              onActivate={unlock} />
            <Gtk.Label
              visible={authStatus.as(s => s.length > 0)}
              cssClasses={["caption"]}
              label={authStatus}
            />
            <Gtk.Spinner
              visible={createBinding(fingerprint, "verifying")}
              spinning
            />
          </Gtk.Box>
        </Gtk.CenterBox>
      </Astal.Window>}
  </For>
}

export const LockScreen = () => {
  let locked = false

  onCleanup(
    screenlocked.subscribe(() => {
      if (screenlocked.get() && !locked) {
        locked = true
        createRoot((dispose) => {
          createLocks(() => {
            locked = false
            dispose()
          })
        })
      }
    })
  )
  return <></>
}
