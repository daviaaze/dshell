import AstalHyprland from "gi://AstalHyprland?version=0.1"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register, setter, signal } from "gnim/gobject"
import logger from "#/lib/logger"
import { Process } from "#/lib/process"

const SCREENSHOT_DIR = `${GLib.get_home_dir()}/Pictures/Screenshots`
const RECORDING_DIR = `${GLib.get_home_dir()}/Videos`

// Try to find a binary in PATH, fallback to nix store
function findBinary(name: string, nixPath: string): string {
  try {
    const stdout = Process.exec(`which ${name}`)
    if (stdout) return stdout
  } catch {
    // not in PATH
  }
  return GLib.file_test(nixPath, GLib.FileTest.EXISTS) ? nixPath : name
}

const SLURP_BIN = findBinary(
  "slurp",
  "/nix/store/qg0jcyc6fffnzl7j8ngvfc681jza8si8-slurp-1.5.0/bin/slurp",
)
const GRIM_BIN = findBinary(
  "grim",
  "/nix/store/8s5p1if67gzz6ymdksbn28b41v1mf06l-grim-1.5.0/bin/grim",
)

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
    GLib.mkdir_with_parents(SCREENSHOT_DIR, 0o755)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${SCREENSHOT_DIR}/${timestamp}.png`

    const copyToClipboard = () => {
      Process.execAsync(`sh -c 'wl-copy < "${filename}"'`)
        .then(() => {
          this.#notify("Screenshot saved", filename, "camera-photo-symbolic")
        })
        .catch((e) => logger.warn("screenshot", "wl-copy failed:", e))
    }

    if (fullscreen) {
      Process.execAsync(`${GRIM_BIN} "${filename}"`)
        .then(() => copyToClipboard())
        .catch((e) => logger.error("screenshot", "grim failed:", e))
    } else {
      Process.execAsync(`${SLURP_BIN}`)
        .then((out) => {
          if (!out) {
            logger.info("screenshot", "slurp returned no output (cancelled?)")
            return
          }
          const geometry = out.trim()
          if (!geometry) {
            this.#notify("Screenshot cancelled", "No region selected", "dialog-warning-symbolic")
            return
          }
          Process.execAsync(`${GRIM_BIN} -g "${geometry}" "${filename}"`)
            .then(() => copyToClipboard())
            .catch((e) => logger.error("screenshot", "grim failed:", e))
        })
        .catch((e) => logger.warn("screenshot", "slurp failed:", e))
    }
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

    GLib.mkdir_with_parents(RECORDING_DIR, 0o755)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${RECORDING_DIR}/${timestamp}.mp4`

    // If no geometry and no output specified, default to focused monitor
    const effectiveOutput =
      options.output ??
      (options.geometry ? undefined : AstalHyprland.get_default().focused_monitor?.name)

    const args = ["wf-recorder", "-f", filename, "-y"]
    if (options.geometry) {
      args.push("-g", options.geometry)
    }
    if (effectiveOutput) {
      args.push("-o", effectiveOutput)
    }
    if (this.#audio) {
      args.push("-a")
    }

    logger.info(
      "screenshot",
      `starting wf-recorder with args: ${args.join(" ")}`,
    )

    let proc: Process
    try {
      proc = Process.subprocessv(args)
    } catch (e) {
      logger.error(
        "screenshot",
        `failed to spawn wf-recorder: ${(e as Error).message}`,
      )
      this.#notify(
        "Recording failed",
        `Could not start wf-recorder: ${(e as Error).message}`,
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
    Process.execAsync(`${SLURP_BIN}`)
      .then((out) => {
        logger.debug("screenshot", `slurp stdout: "${out}"`)
        if (!out) {
          logger.info("screenshot", "slurp returned no output (cancelled?)")
          return
        }
        const geometry = out.trim()
        logger.debug("screenshot", `slurp geometry: "${geometry}"`)
        if (geometry) {
          this.startRecording({ geometry })
        } else {
          this.#notify("Recording cancelled", "No region selected", "dialog-warning-symbolic")
        }
      })
      .catch((e) => {
        logger.info("screenshot", "slurp cancelled or failed:", e)
      })
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

  /** Visually select an output (monitor) to record: shows selection boxes
   * that snap to monitor boundaries, click to pick one. */
  recordOutputVisual() {
    if (this.#recording) return

    const hyprland = AstalHyprland.get_default()
    const monitors = hyprland.get_monitors()

    if (monitors.length === 0) {
      this.#notify("Recording failed", "No monitors found", "dialog-error-symbolic")
      return
    }

    // Build geometry + name mapping for slurp
    const geometryToName = new Map<string, string>()
    const geometries: string[] = []
    for (const m of monitors) {
      const geom = `${m.x},${m.y} ${m.width}x${m.height}`
      geometryToName.set(geom, m.name)
      geometries.push(geom)
    }

    // Write geometries to temp file and pipe to slurp
    const tempPath = "/tmp/shade-output-geometries"
    GLib.file_set_contents(tempPath, new TextEncoder().encode(geometries.join("\n")))

    Process.execAsync(`sh -c 'cat "${tempPath}" | ${SLURP_BIN}'`)
      .then((output) => {
        if (!output) {
          logger.info("screenshot", "output selection cancelled")
          return
        }
        const geometry = output.trim()
        logger.debug("screenshot", `selected output geometry: "${geometry}"`)
        const outputName = geometryToName.get(geometry)
        if (outputName) {
          this.startRecording({ output: outputName })
        } else {
          // Fallback: record the selected geometry directly
          this.startRecording({ geometry })
        }
      })
      .catch((e) => {
        logger.info("screenshot", "output selection cancelled")
      })
  }

  /** Visually select a window to record: shows selection boxes that snap
   * to window boundaries, click to pick one. Uses hyprctl for reliable
   * client data (avoids GLib.List issues with AstalHyprland). */
  recordWindowVisual() {
    if (this.#recording) return

    Process.execAsync(`hyprctl clients -j`)
      .then((json) => {
        const clients = JSON.parse(json)
        const geometries: string[] = []
        for (const c of clients) {
          // Only include mapped windows on valid monitors
          if (c.mapped && c.monitor >= 0) {
            // hyprctl returns at:[x,y] and size:[w,h]
            if (c.at && c.size) {
              geometries.push(`${c.at[0]},${c.at[1]} ${c.size[0]}x${c.size[1]}`)
            }
          }
        }

        if (geometries.length === 0) {
          this.#notify("No windows", "No visible windows to select", "dialog-warning-symbolic")
          return
        }

        // Write geometries to temp file and pipe to slurp
        const tempPath = "/tmp/shade-window-geometries"
        GLib.file_set_contents(tempPath, new TextEncoder().encode(geometries.join("\n")))

        return Process.execAsync(`sh -c 'cat "${tempPath}" | ${SLURP_BIN}'`)
      })
      .then((output: string | void) => {
        if (!output) return
        const geometry = output.trim()
        logger.debug("screenshot", `selected window geometry: "${geometry}"`)
        if (geometry) {
          this.startRecording({ geometry })
        }
      })
      .catch((e) => {
        logger.info("screenshot", "window selection cancelled")
      })
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
