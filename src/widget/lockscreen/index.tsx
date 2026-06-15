import { monitors } from "#/lib/monitors"
import Adw from "gi://Adw?version=1"
import Astal from "gi://Astal?version=4.0"
import AstalAuth from "gi://AstalAuth?version=0.1"
import Gdk from "gi://Gdk?version=4.0"
import SessionLock from "gi://Gtk4SessionLock"
import Gio from "gi://Gio?version=2.0"
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

const PAM_TIMEOUT_MS = 10000

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

  let savedBrightness = ""
  try {
    const resumeFile = Gio.File.new_for_path("/tmp/shade-brightness-resume")
    if (resumeFile.query_exists(null)) {
      const [, contents] = resumeFile.load_contents(null)
      savedBrightness = new TextDecoder().decode(contents).trim()
      resumeFile.delete(null)
    } else {
      savedBrightness = Process.exec("brightnessctl get")
    }
  } catch (e) {
    logger.warn("lockscreen", "could not save brightness:", e)
  }

  // Shared resources (signal connections, timeouts) must be cleaned up
  // exactly once. The <For> creates one cleanup per monitor window,
  // so per-window onCleanup would disconnect the same signal IDs
  // multiple times — causing "no handler with id" errors.
  let sharedCleanedUp = false
  const cleanupShared = () => {
    if (sharedCleanedUp) return
    sharedCleanedUp = true
    fingerprint.stop()
    fingerprint.disconnect(verifiedId)
    fingerprint.disconnect(statusId)
    pam.disconnect(pamPromptId)
    pam.disconnect(pamSuccessId)
    pam.disconnect(pamFailId)
    pam.disconnect(pamErrorId)
    cancelPamTimeout()
    if (lockTimeout) GLib.source_remove(lockTimeout)
  }

  const doUnlock = () => {
    cleanupShared()
    lock.unlock()
    WindowManager.get_default().lockscreens.forEach((w) => w.destroy())
    ShellState.get_default().screenlocked = false
    onUnlock()

    if (savedBrightness) {
      try {
        Process.exec(`brightnessctl set ${savedBrightness}`)
      } catch (e) {
        logger.warn("lockscreen", "failed to restore brightness:", e)
      }
    }
  }

  const pam = new AstalAuth.Pam()
  let pendingPassword = ""
  let pamTimeoutId = 0
  let pamActive = false

  const cancelPamTimeout = () => {
    if (pamTimeoutId) {
      GLib.source_remove(pamTimeoutId)
      pamTimeoutId = 0
    }
  }

  const pamPromptId = pam.connect("auth-prompt-hidden", () => {
    pam.supply_secret(pendingPassword)
  })

  const pamSuccessId = pam.connect("success", () => {
    if (!pamActive) return
    pamActive = false
    cancelPamTimeout()
    doUnlock()
  })

  const pamFailId = pam.connect("fail", (_pam: AstalAuth.Pam, msg: string) => {
    if (!pamActive) return
    pamActive = false
    cancelPamTimeout()
    logger.warn("lockscreen", "PAM auth failed:", msg)
    setAuthStatus("Authentication failed")
  })

  const pamErrorId = pam.connect("auth-error", (_pam: AstalAuth.Pam, msg: string) => {
    if (!pamActive) return
    pamActive = false
    cancelPamTimeout()
    logger.warn("lockscreen", "PAM auth error:", msg)
    setAuthStatus(msg || "Authentication error")
    pam.supply_secret(null)
  })

  const unlock = (self: Gtk.PasswordEntry) => {
    // Prevent re-entrancy: if a PAM auth is already in progress,
    // calling start_authenticate() again asserts:
    //   'priv->task == NULL' failed
    if (pamActive) return

    pendingPassword = self.get_text()
    self.set_text("")
    setAuthStatus("Authenticating...")
    pamActive = true
    pam.start_authenticate()

    cancelPamTimeout()
    pamTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PAM_TIMEOUT_MS, () => {
      pamTimeoutId = 0
      pamActive = false
      setAuthStatus("Authentication timed out")
      return GLib.SOURCE_REMOVE
    })
  }

  fingerprint.init().then(() => {
    if (fingerprint.available) {
      fingerprint.start()
    }
  })

  const verifiedId = fingerprint.connect("verified", () => {
    doUnlock()
  })

  const statusId = fingerprint.connect("status-changed", (_, status) => {
    if (status === "verify-no-match") {
      setAuthStatus("Fingerprint did not match, retrying...")
    } else if (status === "verify-retry" || status === "verify-swipe-too-short") {
      setAuthStatus("Try again...")
    }
  })

  const fpStateBinding = createBinding(fingerprint, "state")
  const fpErrorBinding = createBinding(fingerprint, "error-message")

  return (
    <For each={monitors}>
      {(monitor: Gdk.Monitor) => (
        <Astal.Window
          $={(self) => {
            WindowManager.get_default().registerLockscreen(self)
            onCleanup(() => {
              cleanupShared()
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
                visible={fpStateBinding.as(
                  (s) => s === "verifying" || s === "initializing",
                )}
                spinning
              />
              <Gtk.Button
                visible={fpStateBinding.as((s) => s === "error")}
                label={fpErrorBinding.as(
                  (msg) => msg || "Retry fingerprint",
                )}
                cssClasses={["flat"]}
                onClicked={() => fingerprint.retry()}
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
      if (screenlocked() && !locked) {
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
