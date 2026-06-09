import { monitors } from "#/lib/monitors"
import Adw from "gi://Adw?version=1"
import Astal from "gi://Astal?version=4.0"
import AstalAuth from "gi://AstalAuth?version=0.1"
import Gdk from "gi://Gdk?version=4.0"
import SessionLock from "gi://Gtk4SessionLock"
import GLib from "gi://GLib?version=2.0"
import Gtk from "gi://Gtk?version=4.0"
import {
  createBinding,
  createRoot,
  createState,
  For,
  onCleanup,
  onMount,
} from "gnim"
import WindowManager from "#/lib/windowManager"
import ShellState from "#/lib/shellState"
import logger from "#/lib/logger"
import FingerprintAuth from "#/lib/fingerprint"
import { Process } from "#/lib/process"

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

  // Save screen brightness at lock time so we can restore it exactly on unlock.
  // If hypridle already dimmed the screen, the original brightness was saved to
  // /tmp/shade-brightness-resume — use that file instead of capturing the dimmed value.
  let savedBrightness = ""
  try {
    const resumeFile = GLib.file_new_for_path("/tmp/shade-brightness-resume")
    if (resumeFile.query_exists(null)) {
      const [, contents] = resumeFile.load_contents(null)
      savedBrightness = new TextDecoder().decode(contents).trim()
      // Remove the file so hypridle's on-resume doesn't try to restore too
      resumeFile.delete(null)
    } else {
      savedBrightness = Process.exec("brightnessctl get")
    }
  } catch (e) {
    logger.warn("lockscreen", "could not save brightness:", e)
  }

  const doUnlock = () => {
    fingerprint.stop()
    lock.unlock()
    WindowManager.get_default().lockscreens.forEach((w) => w.destroy())
    ShellState.get_default().screenlocked = false
    onUnlock()

    // Restore exact brightness saved at lock time
    if (savedBrightness) {
      try {
        Process.exec(`brightnessctl set ${savedBrightness}`)
      } catch (e) {
        logger.warn("lockscreen", "failed to restore brightness:", e)
      }
    }
  }

  const unlock = (self: Gtk.PasswordEntry) => {
    AstalAuth.Pam.authenticate(self.get_text(), (_, res) => {
      try {
        AstalAuth.Pam.authenticate_finish(res)
        doUnlock()
      } catch (e) {
        logger.warn("lockscreen", "Authentication failed:", e)
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

  const verifiedId = fingerprint.connect("verified", () => {
    doUnlock()
  })

  const failedId = fingerprint.connect("failed", (_, reason) => {
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

  const statusId = fingerprint.connect("status-changed", (_, status) => {
    if (status === "verify-retry" || status === "verify-swipe-too-short") {
      setAuthStatus("Try again...")
    }
  })

  return (
    <For each={monitors}>
      {(monitor: Gdk.Monitor) => (
        <Astal.Window
          $={(self) => {
            WindowManager.get_default().registerLockscreen(self)
            onCleanup(() => {
              fingerprint.stop()
              fingerprint.disconnect(verifiedId)
              fingerprint.disconnect(failedId)
              fingerprint.disconnect(statusId)
              GLib.source_remove(lockTimeout)
              WindowManager.get_default().unregisterLockscreen(self)
            })
          }}
          onRealize={() => {
            for (const window of WindowManager.get_default().lockscreens) {
              if (!window.get_realized()) return
            }
            lock.lock()
            for (const window of WindowManager.get_default().lockscreens) {
              lock.assign_window_to_monitor(
                window,
                window.get_current_monitor(),
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
                label={time.as((t) => t.format("%R")!)}
                css={"font-size: 4em;"}
              />
              <Gtk.Label
                marginBottom={12}
                cssClasses={["title-3", "numeric"]}
                label={time.as((t) => t.format("%A, %x")!)}
              />
            </Gtk.Box>
            <Gtk.Box
              $type="center"
              valign={Gtk.Align.CENTER}
              halign={Gtk.Align.CENTER}
              spacing={4}
              css={"padding:8px;"}
              orientation={Gtk.Orientation.VERTICAL}
              cssClasses={["card"]}
            >
              <Adw.Avatar size={64} />
              <Gtk.Label
                label={GLib.get_real_name()}
                cssClasses={["title-3"]}
              />
              <Gtk.PasswordEntry
                $={(self) => onMount(() => self.grab_focus())}
                placeholderText={"password"}
                showPeekIcon
                onActivate={unlock}
              />
              <Gtk.Label
                visible={authStatus.as((s) => s.length > 0)}
                cssClasses={["caption"]}
                label={authStatus}
              />
              <Gtk.Spinner
                visible={createBinding(fingerprint, "verifying")}
                spinning
              />
            </Gtk.Box>
          </Gtk.CenterBox>
        </Astal.Window>
      )}
    </For>
  )
}

export const LockScreen = () => {
  let locked = false

  const screenlocked = createBinding(ShellState.get_default(), "screenlocked")

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
    }),
  )
  return <></>
}
