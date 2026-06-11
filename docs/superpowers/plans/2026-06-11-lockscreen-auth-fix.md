# Lock Screen Auth Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix password auth silently failing after sleep/wake and fingerprint auth having no error recovery, by switching to instance-based PAM and adding a fingerprint state machine.

**Architecture:** Replace the static `AstalAuth.Pam.authenticate()` with a per-session `Pam` instance that uses the signal-based conversation API. Refactor `FingerprintAuth` to use an explicit state machine (`idle → initializing → verifying → error`) with re-init on failure and a manual retry button.

**Tech Stack:** TypeScript, GJS, GTK 4, Gnim (JSX), AstalAuth (PAM), fprintd (D-Bus), GObject

**Spec:** `docs/superpowers/specs/2026-06-11-lockscreen-auth-fix-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/fingerprint.ts` | Modify | Fingerprint state machine with `state`, `errorMessage`, `retry()`, re-init on failure |
| `src/widget/lockscreen/index.tsx` | Modify | Instance-based PAM auth, timeout, bind to fingerprint state, retry button |

---

### Task 1: Refactor FingerprintAuth with state machine

**Files:**
- Modify: `src/lib/fingerprint.ts`

- [ ] **Step 1: Rewrite `src/lib/fingerprint.ts` with state machine**

Replace the entire file with the state machine implementation:

```typescript
import GObject, { getter, register, signal } from "gnim/gobject"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import logger from "#/lib/logger"

const FPRINTD_SERVICE = "net.reactivated.Fprint"
const FPRINTD_MANAGER = "/net/reactivated/Fprint/Manager"
const MAX_RETRIES = 3

type FingerprintState = "idle" | "initializing" | "verifying" | "error"

@register({ GTypeName: "FingerprintAuth" })
export default class FingerprintAuth extends GObject.Object {
  static instance: FingerprintAuth

  static get_default() {
    if (!this.instance) this.instance = new FingerprintAuth()
    return this.instance
  }

  #available = false
  #state: FingerprintState = "idle"
  #errorMessage = ""
  #devicePath: string | null = null
  #deviceProxy: Gio.DBusProxy | null = null
  #initialized = false
  #claimed = false
  #consecutiveFailures = 0
  #signalId = 0

  @getter(Boolean)
  get available() {
    return this.#available
  }

  @getter(String)
  get state() {
    return this.#state
  }

  @getter(String)
  get errorMessage() {
    return this.#errorMessage
  }

  @getter(Boolean)
  get verifying() {
    return this.#state === "verifying"
  }

  @signal()
  verified() {}

  @signal([GObject.TYPE_STRING], GObject.TYPE_NONE)
  failed(_reason: string) {}

  @signal([GObject.TYPE_STRING], GObject.TYPE_NONE)
  statusChanged(_status: string) {}

  #setState(state: FingerprintState) {
    if (this.#state === state) return
    this.#state = state
    this.notify("state")
    if (state === "verifying" || state === "initializing") {
      this.notify("verifying")
    }
  }

  #setError(message: string) {
    this.#errorMessage = message
    this.notify("error-message")
    this.#setState("error")
  }

  async init() {
    if (this.#initialized) return
    this.#initialized = true
    try {
      const manager = await this.#getProxy(
        FPRINTD_MANAGER,
        "net.reactivated.Fprint.Manager",
      )
      const devices = manager
        .call_sync("GetDevices", null, Gio.DBusCallFlags.NONE, -1, null)
        ?.get_child_value(0)

      if (!devices || devices.n_children() === 0) {
        this.#available = false
        this.notify("available")
        return
      }

      this.#devicePath = devices.get_child_value(0).get_string()[0]
      this.#deviceProxy = await this.#getProxy(
        this.#devicePath,
        "net.reactivated.Fprint.Device",
      )
      this.#available = true
      this.notify("available")

      this.#signalId = this.#deviceProxy.connect(
        "g-signal",
        (_proxy, _sender, signalName, params) => {
          if (signalName === "VerifyStatus") {
            const status = params.get_child_value(0).get_string()[0]
            const done = params.get_child_value(1).get_boolean()
            this.statusChanged(status)

            if (done) {
              this.#handleVerifyDone(status)
            }
          }
        },
      )
    } catch (e) {
      logger.error("fingerprint", "init failed:", e)
      this.#available = false
      this.notify("available")
    }
  }

  #handleVerifyDone(status: string) {
    if (status === "verify-match") {
      this.#consecutiveFailures = 0
      this.#setState("idle")
      this.verified()
      return
    }

    if (status === "verify-no-match") {
      this.#consecutiveFailures++
      if (this.#consecutiveFailures >= MAX_RETRIES) {
        this.stop()
        this.#setError("Too many fingerprint attempts")
        this.failed("too-many-retries")
        return
      }
      this.statusChanged("verify-no-match")
      this.#reinitAndRetry()
      return
    }

    this.stop()
    this.#setError(`Fingerprint error: ${status}`)
    this.failed(status)
  }

  async #reinitAndRetry() {
    this.stop()
    await new Promise((resolve) => setTimeout(resolve, 500))
    this.start()
  }

  start() {
    if (!this.#available || !this.#deviceProxy) return
    this.#setState("initializing")
    try {
      if (!this.#claimed) {
        this.#deviceProxy.call_sync(
          "Claim",
          GLib.Variant.new("(s)", [GLib.get_user_name()]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
        )
        this.#claimed = true
      }
      this.#setState("verifying")
      this.#deviceProxy.call_sync(
        "VerifyStart",
        GLib.Variant.new("(s)", [""]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      )
    } catch (e) {
      logger.error("fingerprint", "start failed:", e)
      this.#setError(`Fingerprint device error: ${String(e)}`)
      this.failed(String(e))
      this.#release()
    }
  }

  retry() {
    if (this.#state !== "error") return
    this.#consecutiveFailures = 0
    this.#errorMessage = ""
    this.notify("error-message")
    this.#setState("initializing")
    this.start()
  }

  stop() {
    if (!this.#deviceProxy) return
    try {
      this.#deviceProxy.call_sync(
        "VerifyStop",
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      )
    } catch (e) {
      logger.error("fingerprint", "VerifyStop failed:", e)
    }
    this.#setState("idle")
    this.#release()
  }

  #release() {
    if (!this.#claimed || !this.#deviceProxy) return
    try {
      this.#deviceProxy.call_sync(
        "Release",
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      )
    } catch (e) {
      logger.error("fingerprint", "Release failed:", e)
    }
    this.#claimed = false
  }

  async #getProxy(
    objectPath: string,
    interfaceName: string,
  ): Promise<Gio.DBusProxy> {
    return new Promise((resolve, reject) => {
      Gio.DBusProxy.new_for_bus(
        Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE,
        null,
        FPRINTD_SERVICE,
        objectPath,
        interfaceName,
        null,
        (_, res) => {
          try {
            resolve(Gio.DBusProxy.new_for_bus_finish(res))
          } catch (e) {
            reject(e)
          }
        },
      )
    })
  }
}
```

Key changes from the original:
- Added `#state`, `#errorMessage`, `#consecutiveFailures` fields
- Added `state` and `errorMessage` GObject properties with `@getter(String)`
- `verifying` getter now derives from `state === "verifying"` (backward compat)
- `#setState()` helper emits `notify` for both `state` and `verifying`
- `#handleVerifyDone()` centralizes all done-signal logic
- `verify-no-match` triggers `#reinitAndRetry()` (stop + release + 500ms delay + start) up to `MAX_RETRIES` (3)
- All other errors go to `error` state with message
- `retry()` public method resets failures and re-enters `initializing`
- `start()` sets `initializing` before claiming, `verifying` after `VerifyStart`

- [ ] **Step 2: Validate the build**

Run: `pnpm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fingerprint.ts
git commit -m "refactor: fingerprint auth state machine with error recovery"
```

---

### Task 2: Refactor lockscreen to use instance-based PAM + fingerprint state bindings

**Files:**
- Modify: `src/widget/lockscreen/index.tsx`

- [ ] **Step 1: Rewrite `src/widget/lockscreen/index.tsx`**

Replace the entire file with the instance-based PAM and fingerprint state machine bindings:

```tsx
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
    const resumeFile = GLib.file_new_for_path("/tmp/shade-brightness-resume")
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

  const doUnlock = () => {
    fingerprint.stop()
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

  const cancelPamTimeout = () => {
    if (pamTimeoutId) {
      GLib.source_remove(pamTimeoutId)
      pamTimeoutId = 0
    }
  }

  pam.connect("auth-prompt-hidden", () => {
    pam.supply_secret(pendingPassword)
  })

  pam.connect("success", () => {
    cancelPamTimeout()
    doUnlock()
  })

  pam.connect("fail", (_pam: AstalAuth.Pam, msg: string) => {
    cancelPamTimeout()
    logger.warn("lockscreen", "PAM auth failed:", msg)
    setAuthStatus("Authentication failed")
  })

  pam.connect("auth-error", (_pam: AstalAuth.Pam, msg: string) => {
    cancelPamTimeout()
    logger.warn("lockscreen", "PAM auth error:", msg)
    setAuthStatus(msg || "Authentication error")
    pam.supply_secret(null)
  })

  const unlock = (self: Gtk.PasswordEntry) => {
    pendingPassword = self.get_text()
    self.set_text("")
    setAuthStatus("Authenticating...")
    pam.start_authenticate()

    cancelPamTimeout()
    pamTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PAM_TIMEOUT_MS, () => {
      pamTimeoutId = 0
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

  const failedId = fingerprint.connect("failed", () => {})

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
              fingerprint.stop()
              fingerprint.disconnect(verifiedId)
              fingerprint.disconnect(failedId)
              fingerprint.disconnect(statusId)
              cancelPamTimeout()
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
```

Key changes from the original:
- **PAM**: Creates a `new AstalAuth.Pam()` instance per lock session. Connects to `auth-prompt-hidden`, `success`, `fail`, `auth-error` signals. `unlock()` calls `start_authenticate()` and sets a 10s timeout. Password is cleared from the entry immediately after capture.
- **Fingerprint signals**: Simplified — `failed` handler is empty (state machine handles recovery). `status-changed` shows contextual messages. `verified` still triggers `doUnlock()`.
- **Fingerprint UI**: Spinner binds to `state === "verifying" || "initializing"`. A retry button appears when `state === "error"`, showing the error message as label text, calling `fingerprint.retry()` on click.
- **Cleanup**: Added `cancelPamTimeout()` to prevent stale timeouts.

- [ ] **Step 2: Validate the build**

Run: `pnpm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/widget/lockscreen/index.tsx
git commit -m "refactor: instance-based PAM auth with timeout and fingerprint state bindings"
```

---

### Task 3: Manual testing via NixOS VM

- [ ] **Step 1: Build and run the VM**

Run: `nix build`
Expected: Build produces a runnable binary.

- [ ] **Step 2: Test password auth**

1. Lock the screen (power menu or keybinding)
2. Type correct password, press Enter → should unlock
3. Lock again, type wrong password → should show "Authentication failed"
4. Lock again, type correct password but wait 10+ seconds → should show "Authentication timed out"

- [ ] **Step 3: Test fingerprint auth**

1. Lock the screen → fingerprint should auto-start (spinner visible)
2. Swipe correct finger → should unlock
3. Swipe wrong finger → should show "Fingerprint did not match, retrying..." and auto-retry (up to 3 times)
4. After 3 wrong swipes → should show "Too many fingerprint attempts" with a retry button
5. Click retry button → should re-init and allow another attempt

- [ ] **Step 4: Test after sleep/wake**

1. Lock the screen, suspend the VM, wake it
2. Type password → should authenticate normally (no silent hang)
3. Swipe fingerprint → should work or show error with retry button (not permanently broken)

- [ ] **Step 5: Commit any fixes needed**

If manual testing reveals issues, fix and commit.
