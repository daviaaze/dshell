import AstalIO from "gi://AstalIO?version=0.1"
import GObject, { getter, register, signal } from "gnim/gobject"

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

  @getter(Boolean)
  get recording() { return this.#recording }

  @signal()
  declare recordingStarted: () => void

  @signal()
  declare recordingStopped: () => void

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

  startRecording() {
    if (this.#recording) return

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${RECORDING_DIR}/${timestamp}.mp4`

    AstalIO.Process.exec_async(
      `mkdir -p ${RECORDING_DIR}`,
      () => {
        this.#recording = true
        this.notify("recording")
        this.recordingStarted()

        AstalIO.Process.exec_async(
          `wf-recorder -f "${filename}"`,
          () => {
            this.#recording = false
            this.notify("recording")
            this.recordingStopped()
          }
        )
      }
    )
  }

  stopRecording() {
    if (!this.#recording) return
    AstalIO.Process.exec_async("killall -INT wf-recorder", () => {})
  }
}
