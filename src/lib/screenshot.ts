import AstalHyprland from "gi://AstalHyprland?version=0.1"
import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register, setter, signal } from "gnim/gobject"
import logger from "#/lib/logger"

const SCREENSHOT_DIR = `${GLib.get_home_dir()}/Pictures/Screenshots`
const RECORDING_DIR = `${GLib.get_home_dir()}/Videos`

@register({ GTypeName: "Screenshot" })
export default class Screenshot extends GObject.Object {
  static instance: Screenshot

  static get_default() {
    if (!this.instance) this.instance = new Screenshot()
    return this.instance
  }

  #recording = false
  #recordingProcess: AstalIO.Process | null = null
  #audio = false
  #recordingStartTime = 0
  #recordingFile = ""

  @getter(Boolean)
  get recording() {
    return this.#recording
  }

  @getter(Boolean)
  @setter(Boolean)
  get audio() {
    return this.#audio
  }
  set audio(value: boolean) {
    if (this.#audio === value) return
    this.#audio = value
    this.notify("audio")
  }

  @signal()
  recordingStarted() {}

  @signal()
  recordingStopped() {}

  #notify(
    title: string,
    body: string,
    icon: string = "dialog-information-symbolic",
  ) {
    AstalIO.Process.exec_async(
      `notify-send -a shade-shell -i ${icon} "${title}" "${body}"`,
      () => {},
    )
  }

  screenshot(fullscreen: boolean) {
    GLib.mkdir_with_parents(SCREENSHOT_DIR, 0o755)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${SCREENSHOT_DIR}/${timestamp}.png`

    const copyToClipboard = () => {
      AstalIO.Process.exec_async(`sh -c 'wl-copy < "${filename}"'`, (out) => {
        if (out) logger.debug("screenshot", "wl-copy output:", out)
        this.#notify("Screenshot saved", filename, "camera-photo-symbolic")
      })
    }

    if (fullscreen) {
      AstalIO.Process.exec_async(`grim "${filename}"`, () => copyToClipboard())
    } else {
      AstalIO.Process.exec_async(`slurp`, (out) => {
        if (!out) return
        const geometry = out.trim()
        if (!geometry) return
        AstalIO.Process.exec_async(`grim -g "${geometry}" "${filename}"`, () =>
          copyToClipboard(),
        )
      })
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

    const args = ["wf-recorder", "-f", filename]
    if (options.geometry) {
      args.push("-g", options.geometry)
    }
    if (options.output) {
      args.push("-o", options.output)
    }
    if (this.#audio) {
      args.push("-a")
    }

    logger.info(
      "screenshot",
      `starting wf-recorder with args: ${args.join(" ")}`,
    )

    let proc: AstalIO.Process
    try {
      proc = AstalIO.Process.subprocessv(args)
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
    this.#recordingProcess = proc
    this.notify("recording")
    this.recordingStarted()

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
      this.notify("recording")
      this.recordingStopped()
      this.#recordingProcess = null
      this.#recordingFile = ""
      this.#recordingStartTime = 0
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
    AstalIO.Process.exec_async(`slurp`, (out) => {
      if (!out) {
        logger.info("screenshot", "slurp returned no output (cancelled?)")
        return
      }
      const geometry = out.trim()
      logger.debug("screenshot", `slurp geometry: "${geometry}"`)
      if (geometry) {
        this.startRecording({ geometry })
      }
    })
  }

  recordOutput(outputName?: string) {
    if (this.#recording) return
    if (!outputName) {
      const hyprland = AstalHyprland.get_default()
      outputName = hyprland.focused_monitor?.name
      logger.info("screenshot", `focused monitor name: ${outputName}`)
    }
    if (!outputName) {
      logger.error("screenshot", "no output name, cannot record output")
      return
    }
    this.startRecording({ output: outputName })
  }

  recordWindow() {
    if (this.#recording) return
    const hyprland = AstalHyprland.get_default()
    const client = hyprland.focused_client
    if (!client) {
      logger.error("screenshot", "no focused client, cannot record window")
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
