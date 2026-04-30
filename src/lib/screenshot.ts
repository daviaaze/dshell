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
    this.#recording = true
    this.notify("recording")

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${RECORDING_DIR}/${timestamp}.mp4`

    AstalIO.Process.exec_async(
      `mkdir -p ${RECORDING_DIR}`,
      () => {
        this.recordingStarted()

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

        this.#recordingProcess = AstalIO.Process.subprocessv(args)

        this.#recordingProcess.connect("exit", () => {
          this.#recording = false
          this.notify("recording")
          this.recordingStopped()
          this.#recordingProcess = null
        })
      }
    )
  }

  recordArea() {
    if (this.#recording) return
    this.#recording = true
    this.notify("recording")
    AstalIO.Process.exec_async(
      `slurp`,
      (out) => {
        const geometry = out.trim()
        if (geometry) {
          this.#recording = false
          this.startRecording({ geometry })
        } else {
          this.#recording = false
          this.notify("recording")
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
    if (!this.#recording || !this.#recordingProcess) return
    this.#recordingProcess.signal(2)
  }
}
