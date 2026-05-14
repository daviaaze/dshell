import AstalHyprland from "gi://AstalHyprland?version=0.1"
import AstalIO from "gi://AstalIO?version=0.1"
import GObject, { getter, register, setter, signal } from "gnim/gobject"

const SCREENSHOT_DIR = `${AstalIO.Process.exec("echo $HOME").trim()}/Pictures/Screenshots`
const RECORDING_DIR = `${AstalIO.Process.exec("echo $HOME").trim()}/Videos`

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
  get recording() { return this.#recording }

  @getter(Boolean)
  @setter(Boolean)
  get audio() { return this.#audio }
  set audio(value: boolean) {
    if (this.#audio === value) return
    this.#audio = value
    this.notify("audio")
  }

  @signal()
  recordingStarted() {}

  @signal()
  recordingStopped() {}

  screenshot(fullscreen: boolean) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${SCREENSHOT_DIR}/${timestamp}.png`

    AstalIO.Process.exec_async(
      `mkdir -p ${SCREENSHOT_DIR}`,
      () => {
        if (fullscreen) {
          AstalIO.Process.exec_async(
            `grim "${filename}" && wl-copy < "${filename}"`,
            () => {}
          )
        } else {
          AstalIO.Process.exec_async(
            `grim -g "$(slurp)" "${filename}" && wl-copy < "${filename}"`,
            () => {}
          )
        }
      }
    )
  }

  toggleRecording() {
    if (this.#recording) {
      this.stopRecording()
    } else {
      this.startRecording()
    }
  }

  startRecording(options: { geometry?: string, output?: string } = {}) {
    if (this.#recording) return

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${RECORDING_DIR}/${timestamp}.mp4`

    AstalIO.Process.exec(`mkdir -p ${RECORDING_DIR}`)

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

    let proc: AstalIO.Process
    try {
      proc = AstalIO.Process.subprocessv(args)
    } catch (e) {
      print(`error: failed to spawn wf-recorder: ${e.message}`)
      AstalIO.Process.exec_async(
        `notify-send -a shade-shell -i dialog-error-symbolic "Recording failed" "Could not start wf-recorder"`,
        () => {}
      )
      return
    }

    this.#recording = true
    this.#recordingFile = filename
    this.#recordingStartTime = Date.now()
    this.#recordingProcess = proc
    this.notify("recording")
    this.recordingStarted()

    AstalIO.Process.exec_async(
      `notify-send -a shade-shell -i media-record-symbolic "Recording started" "${filename}"`,
      () => {}
    )

    proc.connect("exit", () => {
      const durationMs = Date.now() - this.#recordingStartTime
      const durationStr = this.#formatDuration(durationMs)
      AstalIO.Process.exec_async(
        `notify-send -a shade-shell -i media-playback-stop-symbolic "Recording stopped" "Duration: ${durationStr}\nSaved to: ${this.#recordingFile}"`,
        () => {}
      )
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
    AstalIO.Process.exec_async(
      `slurp`,
      (out) => {
        if (!out) return
        const geometry = out.trim()
        if (geometry) {
          this.startRecording({ geometry })
        }
      }
    )
  }

  recordOutput(outputName?: string) {
    if (this.#recording) return
    if (!outputName) {
      const hyprland = AstalHyprland.get_default()
      outputName = hyprland.focused_monitor?.name
    }
    if (!outputName) return
    this.startRecording({ output: outputName })
  }

  recordWindow() {
    if (this.#recording) return
    const hyprland = AstalHyprland.get_default()
    const client = hyprland.focused_client
    if (!client) return
    const geometry = `${client.x},${client.y} ${client.width}x${client.height}`
    this.startRecording({ geometry })
  }

  stopRecording() {
    if (!this.#recordingProcess) return
    this.#recordingProcess.signal(2)
  }
}
