import AstalHyprland from "gi://AstalHyprland?version=0.1"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register, setter, signal } from "gnim/gobject"
import logger from "#/lib/logger"
import { Process } from "#/lib/process"
import { getScreenCaptureSettings } from "#/lib/screenCaptureSettings"

enum RecorderBackend {
  WL_SCREENREC = 0,
  WF_RECORDER = 1,
}

const SCREENSHOT_DIR = `${GLib.get_home_dir()}/Pictures/Screenshots`
const RECORDING_DIR = `${GLib.get_home_dir()}/Videos`

// ── Types ─────────────────────────────────────────────────────────

export interface VirtualMonitor {
  name: string
  resolution: string
  fps: number
}

export interface ActiveShare {
  id: string
  type: "monitor" | "window" | "region"
  target: string
  appName: string
}

export interface BoundaryGeometry {
  x: number
  y: number
  width: number
  height: number
}

// Try to find a binary in PATH, fallback to nix store
function findBinary(name: string): string {
  try {
    const stdout = Process.exec(`which ${name}`)
    if (stdout) return stdout
  } catch {
    // not in PATH
  }
  return name
}

const SLURP_BIN = findBinary("slurp")
const GRIM_BIN = findBinary("grim")

@register({ GTypeName: "Screenshot" })
export default class Screenshot extends GObject.Object {
  static instance: Screenshot

  static get_default() {
    if (!this.instance) this.instance = new Screenshot()
    return this.instance
  }

  #recording = false
  #recordingProcess: Process | null = null
  #audio = false
  #recordingStartTime = 0
  #recordingFile = ""
  #durationTimer: number | null = null
  #recordingElapsed = 0

  // ── Overlay state ────────────────────────────────────────────────
  #overlayOpen = false
  #selectedMode: "screenshot" | "recording" = "screenshot"
  #selectedTarget: "fullscreen" | "area" | "window" | "monitor" = "fullscreen"
  #regionSelectorOpen = false
  #pendingCaptureGeometry: string | null = null

  // ── Freeze state ─────────────────────────────────────────────────
  #freezeActive = false
  #freezeProcess: Process | null = null

  // ── Boundary state ───────────────────────────────────────────────
  #boundaryVisible = false
  #boundaryGeometry: { x: number; y: number; width: number; height: number } | null = null

  // ── Virtual monitors ─────────────────────────────────────────────
  #virtualMonitors: VirtualMonitor[] = []

  // ── Active shares (shared with Discord/OBS via portal) ───────────
  #activeShares: ActiveShare[] = []

  @getter(Number)
  get recordingElapsed() {
    return this.#recordingElapsed
  }

  @getter(Boolean)
  get recording() {
    return this.#recording
  }

  @getter(Boolean)
  get audio() {
    return this.#audio
  }

  @setter(Boolean)
  set audio(value: boolean) {
    if (this.#audio === value) return
    this.#audio = value
    this.notify("audio")
  }

  @signal()
  recordingStarted() {}

  @signal()
  recordingStopped() {}

  // ── New signals ──────────────────────────────────────────────────

  @signal()
  overlayShown() {}

  @signal()
  overlayHidden() {}

  @signal()
  freezeActivated() {}

  @signal()
  freezeDeactivated() {}

  @signal()
  shareStarted() {}

  @signal()
  shareStopped() {}

  // ── Overlay state getters/setters ─────────────────────────────────

  @getter(Boolean)
  get overlayOpen() {
    return this.#overlayOpen
  }

  @setter(Boolean)
  set overlayOpen(v: boolean) {
    if (this.#overlayOpen === v) return
    this.#overlayOpen = v
    this.notify("overlay-open")
    if (v) this.overlayShown()
    else this.overlayHidden()
  }

  @getter(String)
  get selectedMode() {
    return this.#selectedMode
  }

  @setter(String)
  set selectedMode(v: "screenshot" | "recording") {
    this.#selectedMode = v
    this.notify("selected-mode")
  }

  @getter(String)
  get selectedTarget() {
    return this.#selectedTarget
  }

  @setter(String)
  set selectedTarget(v: "fullscreen" | "area" | "window" | "monitor") {
    this.#selectedTarget = v
    this.notify("selected-target")
  }

  // ── Region selector state ────────────────────────────────────────

  @getter(Boolean)
  get regionSelectorOpen() {
    return this.#regionSelectorOpen
  }

  @setter(Boolean)
  set regionSelectorOpen(v: boolean) {
    if (this.#regionSelectorOpen === v) return
    this.#regionSelectorOpen = v
    this.notify("region-selector-open")
  }

  @getter(String)
  get pendingCaptureGeometry() {
    return this.#pendingCaptureGeometry || ""
  }

  @setter(String)
  set pendingCaptureGeometry(v: string | null) {
    this.#pendingCaptureGeometry = v
    this.notify("pending-capture-geometry")
  }

  /** Open the region-selector to pick an area for capture */
  openRegionSelectorForCapture(mode: "screenshot" | "recording") {
    this.selectedMode = mode
    this.selectedTarget = "area"
    this.overlayOpen = true
    // Close overlay immediately and show region-selector
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
      this.overlayOpen = false
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        this.regionSelectorOpen = true
        return GLib.SOURCE_REMOVE
      })
      return GLib.SOURCE_REMOVE
    })
  }

  /** Called by region-selector when user confirms a selection */
  captureArea(geometry: string) {
    this.pendingCaptureGeometry = geometry
    this.regionSelectorOpen = false

    if (this.#selectedMode === "screenshot") {
      this.screenshotGeometry(geometry)
    } else {
      this.startRecording({ geometry })
    }
  }

  /** Take a screenshot of a specific geometry */
  screenshotGeometry(geometry: string) {
    GLib.mkdir_with_parents(SCREENSHOT_DIR, 0o755)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${SCREENSHOT_DIR}/${timestamp}.png`

    Process.execAsync(`${GRIM_BIN} -g "${geometry}" "${filename}"`)
      .then(() => {
        Process.execAsync(`sh -c 'wl-copy < "${filename}"'`)
          .catch((e) => logger.warn("screenshot", "wl-copy failed:", e))
        this.#notify("Screenshot saved", filename, "camera-photo-symbolic")
      })
      .catch((e) => logger.error("screenshot", "grim failed:", e))
  }

  // ── Freeze state getters/setters ──────────────────────────────────

  @getter(Boolean)
  get freezeActive() {
    return this.#freezeActive
  }

  @setter(Boolean)
  set freezeActive(v: boolean) {
    if (this.#freezeActive === v) return
    this.#freezeActive = v
    this.notify("freeze-active")
    if (v) this.freezeActivated()
    else this.freezeDeactivated()
  }

  // ── Boundary state getters/setters ────────────────────────────────

  @getter(Boolean)
  get boundaryVisible() {
    return this.#boundaryVisible
  }

  @setter(Boolean)
  set boundaryVisible(v: boolean) {
    if (this.#boundaryVisible === v) return
    this.#boundaryVisible = v
    this.notify("boundary-visible")
  }

  @getter(Object)
  get boundaryGeometry() {
    return this.#boundaryGeometry
  }

  @setter(Object)
  set boundaryGeometry(v: BoundaryGeometry | null) {
    this.#boundaryGeometry = v
    this.notify("boundary-geometry")
  }

  // ── Virtual monitors ──────────────────────────────────────────────

  @getter(Array)
  get virtualMonitors() {
    return [...this.#virtualMonitors]
  }

  // ── Active shares ─────────────────────────────────────────────────

  @getter(Array)
  get activeShares() {
    return [...this.#activeShares]
  }

  /** Get list of available monitor outputs */
  getOutputs(): Array<{ name: string; description: string }> {
    const hyprland = AstalHyprland.get_default()
    const monitors = hyprland.get_monitors()
    return monitors.map((m) => ({
      name: m.name,
      description: m.description || m.name,
    }))
  }

  /** Get list of visible windows */
  getWindows(): Array<{ address: string; title: string; class: string }> {
    const hyprland = AstalHyprland.get_default()
    const clients = hyprland.clients || []
    return clients
      .filter((c) => c.mapped && c.monitor >= 0)
      .map((c) => ({
        address: c.address,
        title: c.title || "(untitled)",
        class: c.class || "",
      }))
  }

  #notify(
    title: string,
    body: string,
    icon: string = "dialog-information-symbolic",
  ) {
    Process.execAsync(
      `notify-send -a shade-shell -i ${icon} "${title}" "${body}"`,
    ).catch((e) => logger.warn("screenshot", "notify-send failed:", e))
  }

  screenshot(fullscreen: boolean) {
    // For area selection, use the overlay's region-selector instead of slurp
    if (!fullscreen) {
      this.openRegionSelectorForCapture("screenshot")
      return
    }

    GLib.mkdir_with_parents(SCREENSHOT_DIR, 0o755)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${SCREENSHOT_DIR}/${timestamp}.png`

    Process.execAsync(`${GRIM_BIN} "${filename}"`)
      .then(() => {
        Process.execAsync(`sh -c 'wl-copy < "${filename}"'`)
          .catch((e) => logger.warn("screenshot", "wl-copy failed:", e))
        this.#notify("Screenshot saved", filename, "camera-photo-symbolic")
      })
      .catch((e) => logger.error("screenshot", "grim failed:", e))
  }

  toggleRecording() {
    if (this.#recording) {
      this.stopRecording()
    } else {
      this.startRecording()
    }
  }

  startRecording(options: { geometry?: string; output?: string } = {}) {
    if (this.#recording) return

    // Read backend preference from GSettings
    const settings = getScreenCaptureSettings()
    const backend = settings.recorderBackend() as RecorderBackend

    GLib.mkdir_with_parents(RECORDING_DIR, 0o755)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${RECORDING_DIR}/${timestamp}.mp4`

    // If no geometry and no output specified, default to focused monitor
    const effectiveOutput =
      options.output ??
      (options.geometry ? undefined : AstalHyprland.get_default().focused_monitor?.name)

    // Build args based on backend
    const args: string[] = []
    let backendName: string

    if (backend === RecorderBackend.WL_SCREENREC) {
      backendName = "wl-screenrec"
      args.push("wl-screenrec", "-f", filename)
      if (options.geometry) {
        args.push("-g", options.geometry)
      }
      if (effectiveOutput) {
        args.push("-o", effectiveOutput)
      }
      if (this.#audio) {
        args.push("--audio")
      }
    } else {
      backendName = "wf-recorder"
      args.push("wf-recorder", "-f", filename, "-y")
      if (options.geometry) {
        args.push("-g", options.geometry)
      }
      if (effectiveOutput) {
        args.push("-o", effectiveOutput)
      }
      if (this.#audio) {
        args.push("-a")
      }
    }

    logger.info(
      "screenshot",
      `starting ${backendName} with args: ${args.join(" ")}`,
    )

    let proc: Process
    try {
      proc = Process.subprocessv(args)
    } catch (e) {
      logger.error(
        "screenshot",
        `failed to spawn ${backendName}: ${(e as Error).message}`,
      )
      this.#notify(
        "Recording failed",
        `Could not start ${backendName}: ${(e as Error).message}`,
        "dialog-error-symbolic",
      )
      return
    }

    this.#recording = true
    this.#recordingFile = filename
    this.#recordingStartTime = Date.now()
    this.#recordingElapsed = 0
    this.#recordingProcess = proc
    this.notify("recording")
    this.notify("recording-elapsed")
    this.recordingStarted()

    // Start duration timer
    this.#durationTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      this.#recordingElapsed = Math.floor((Date.now() - this.#recordingStartTime) / 1000)
      this.notify("recording-elapsed")
      return this.#recording // keep running while recording
    })

    this.#notify("Recording started", filename, "media-record-symbolic")

    // Show recording boundary if enabled
    if (options.geometry) {
      const [pos, size] = options.geometry.split(" ")
      const [x, y] = pos.split(",").map(Number)
      const [w, h] = size.split("x").map(Number)
      this.showBoundary({ x, y, width: w, height: h })
    }

    proc.connect("exit", () => {
      const durationMs = Date.now() - this.#recordingStartTime
      const durationStr = this.#formatDuration(durationMs)
      logger.info(
        "screenshot",
        `wf-recorder exited after ${durationStr} (${durationMs}ms)`,
      )

      if (durationMs < 1000) {
        this.#notify(
          "Recording failed",
          `wf-recorder exited immediately. Check geometry/output and that no other recorder is running.`,
          "dialog-error-symbolic",
        )
      } else {
        this.#notify(
          "Recording stopped",
          `Duration: ${durationStr}\nSaved to: ${this.#recordingFile}`,
          "media-playback-stop-symbolic",
        )
      }

      this.#recording = false
      if (this.#durationTimer) {
        GLib.Source.remove(this.#durationTimer)
        this.#durationTimer = null
      }
      this.notify("recording")
      this.notify("recording-elapsed")
      this.recordingStopped()
      this.hideBoundary()
      this.#recordingProcess = null
      this.#recordingFile = ""
      this.#recordingStartTime = 0
      this.#recordingElapsed = 0
    })
  }

  #formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }

  recordArea() {
    if (this.#recording) return
    this.openRegionSelectorForCapture("recording")
  }

  /** Record a specific output (monitor) by name */
  recordOutput(outputName?: string) {
    if (this.#recording) return
    if (!outputName) {
      const hyprland = AstalHyprland.get_default()
      outputName = hyprland.focused_monitor?.name
      logger.info("screenshot", `focused monitor name: ${outputName}`)
    }
    if (!outputName) {
      logger.error("screenshot", "no output name, cannot record output")
      this.#notify("Recording failed", "No monitor found", "dialog-error-symbolic")
      return
    }
    this.startRecording({ output: outputName })
  }

  /** Visually select an output (monitor) to record: open overlay for selection */
  recordOutputVisual() {
    if (this.#recording) return
    this.selectedMode = "recording"
    this.selectedTarget = "monitor"
    this.overlayOpen = true
  }

  /** Visually select a window to record: open overlay for selection */
  recordWindowVisual() {
    if (this.#recording) return
    this.selectedMode = "recording"
    this.selectedTarget = "window"
    this.overlayOpen = true
  }

  /** Record a specific window by address */
  recordWindowByAddress(address: string) {
    if (this.#recording) return
    const hyprland = AstalHyprland.get_default()
    const clients = hyprland.clients || []
    const target = clients.find((c) => c.address === address)
    if (!target) {
      logger.error("screenshot", `window with address ${address} not found`)
      this.#notify("Recording failed", "Window not found", "dialog-error-symbolic")
      return
    }
    const geometry = `${target.x},${target.y} ${target.width}x${target.height}`
    logger.debug("screenshot", `window geometry: ${geometry}`)
    this.startRecording({ geometry })
  }

  recordWindow() {
    if (this.#recording) return
    const hyprland = AstalHyprland.get_default()
    const client = hyprland.focused_client
    if (!client) {
      logger.error("screenshot", "no focused client, cannot record window")
      this.#notify("Recording failed", "No window focused", "dialog-error-symbolic")
      return
    }
    const geometry = `${client.x},${client.y} ${client.width}x${client.height}`
    logger.debug("screenshot", `window geometry: ${geometry}`)
    this.startRecording({ geometry })
  }

  stopRecording() {
    if (!this.#recordingProcess) return
    this.#recordingProcess.signal(2)
  }

  // ── Overlay management ────────────────────────────────────────────

  toggleOverlay() {
    this.overlayOpen = !this.#overlayOpen
  }

  showOverlay() {
    this.overlayOpen = true
  }

  hideOverlay() {
    this.overlayOpen = false
  }

  // ── Freeze management ────────────────────────────────────────────

  startFreeze() {
    if (this.#freezeActive) return
    try {
      const proc = Process.subprocessv(["wayfreeze", "--hide-cursor"])
      this.#freezeProcess = proc
      this.freezeActive = true
      proc.connect("exit", () => {
        this.#freezeProcess = null
        this.freezeActive = false
      })
    } catch (e) {
      logger.warn("screenshot", "wayfreeze not available, skipping freeze")
    }
  }

  stopFreeze() {
    if (this.#freezeProcess) {
      try {
        this.#freezeProcess.signal(2)
        this.#freezeProcess.signal(15)
      } catch { /* already dead */ }
      this.#freezeProcess = null
    }
    this.freezeActive = false
  }

  // ── Recording boundary ────────────────────────────────────────────

  showBoundary(geometry: BoundaryGeometry) {
    this.boundaryGeometry = geometry
    this.boundaryVisible = true
  }

  hideBoundary() {
    this.boundaryVisible = false
    this.boundaryGeometry = null
  }

  // ── Virtual monitors ──────────────────────────────────────────────

  createVirtualMonitor(resolution = "1920x1080", fps = 60): VirtualMonitor | null {
    try {
      Process.exec("hyprctl output create headless SHADE-VMON")
      const monitors = JSON.parse(Process.exec("hyprctl -j monitors all"))
      const vmon = monitors.find((m: any) =>
        m.name.startsWith("SHADE-VMON"),
      )
      if (!vmon) {
        // Fallback: find any HEADLESS monitor
        const headless = monitors.find((m: any) =>
          m.name.startsWith("HEADLESS"),
        )
        if (!headless) {
          logger.error("screenshot", "failed to find created virtual monitor")
          return null
        }
        const vm: VirtualMonitor = {
          name: headless.name,
          resolution,
          fps,
        }
        this.#virtualMonitors.push(vm)
        this.notify("virtual-monitors")
        return vm
      }
      Process.exec(`hyprctl keyword monitor ${vmon.name},${resolution}@${fps},auto-right,1`)
      const vm: VirtualMonitor = { name: vmon.name, resolution, fps }
      this.#virtualMonitors.push(vm)
      this.notify("virtual-monitors")
      logger.info("screenshot", `created virtual monitor: ${vm.name} (${resolution}@${fps})`)
      return vm
    } catch (e) {
      logger.error("screenshot", `failed to create virtual monitor: ${(e as Error).message}`)
      return null
    }
  }

  removeVirtualMonitors() {
    for (const vm of this.#virtualMonitors) {
      try {
        Process.exec(`hyprctl output remove ${vm.name}`)
        logger.info("screenshot", `removed virtual monitor: ${vm.name}`)
      } catch (e) {
        logger.warn("screenshot", `failed to remove ${vm.name}: ${(e as Error).message}`)
      }
    }
    this.#virtualMonitors = []
    this.notify("virtual-monitors")
  }

  // ── Share tracking (for Discord/OBS portal shares) ───────────────

  registerShare(share: ActiveShare) {
    this.#activeShares.push(share)
    this.notify("active-shares")
    this.shareStarted()
    // Show boundary for the shared region
    if (share.type === "monitor") {
      const hyprland = AstalHyprland.get_default()
      const mon = hyprland.monitors.find((m) => m.name === share.target)
      if (mon) {
        this.showBoundary({ x: mon.x, y: mon.y, width: mon.width, height: mon.height })
      }
    }
  }

  unregisterShare(id: string) {
    const idx = this.#activeShares.findIndex((s) => s.id === id)
    if (idx === -1) return
    this.#activeShares.splice(idx, 1)
    this.notify("active-shares")
    this.shareStopped()
    if (this.#activeShares.length === 0) {
      this.hideBoundary()
    }
  }

  dispose() {
    if (this.#durationTimer) {
      GLib.Source.remove(this.#durationTimer)
      this.#durationTimer = null
    }
    if (this.#recordingProcess) {
      try {
        this.#recordingProcess.signal(2)
      } catch {
        /* process may already be dead */
      }
      this.#recordingProcess = null
    }
  }
}
