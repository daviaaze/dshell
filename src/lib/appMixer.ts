import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register } from "gnim/gobject"

export interface AudioStream {
  id: number
  name: string
  appName: string
  iconName: string
  volume: number
  muted: boolean
}

function parseStreams(): AudioStream[] {
  try {
    const out = AstalIO.Process.exec("pw-dump")
    const data = JSON.parse(out)
    const streams: AudioStream[] = []
    for (const item of data) {
      const info = item.info || {}
      const props = info.props || {}
      const mediaClass = props["media.class"] || ""
      if (mediaClass.includes("Stream") && mediaClass.includes("Audio") && mediaClass.includes("Output")) {
        const streamProps = info.params?.Props?.[0] || {}
        streams.push({
          id: item.id,
          name: props["node.name"] || "Unknown",
          appName: props["application.name"] || props["node.name"] || "Unknown",
          iconName: props["application.icon-name"] || "audio-x-generic-symbolic",
          volume: streamProps.volume ?? 1.0,
          muted: streamProps.mute ?? false,
        })
      }
    }
    return streams
  } catch (e) {
    print("[AppMixer] failed to parse streams:", (e as Error).message)
    return []
  }
}

function parseCaptureStreams(): AudioStream[] {
  try {
    const out = AstalIO.Process.exec("pw-dump")
    const data = JSON.parse(out)
    const streams: AudioStream[] = []
    for (const item of data) {
      const info = item.info || {}
      const props = info.props || {}
      const mediaClass = props["media.class"] || ""
      if (mediaClass.includes("Stream") && mediaClass.includes("Audio") && mediaClass.includes("Input")) {
        const streamProps = info.params?.Props?.[0] || {}
        streams.push({
          id: item.id,
          name: props["node.name"] || "Unknown",
          appName: props["application.name"] || props["node.name"] || "Unknown",
          iconName: props["application.icon-name"] || "audio-x-generic-symbolic",
          volume: streamProps.volume ?? 1.0,
          muted: streamProps.mute ?? false,
        })
      }
    }
    return streams
  } catch (e) {
    print("[AppMixer] failed to parse capture streams:", (e as Error).message)
    return []
  }
}

@register({ GTypeName: "AppMixer" })
export default class AppMixer extends GObject.Object {
  static instance: AppMixer
  static get_default() {
    if (!this.instance) this.instance = new AppMixer()
    return this.instance
  }

  #streams: AudioStream[] = []
  #captureStreams: AudioStream[] = []
  #timer: number | null = null

  @getter(Array)
  get streams() {
    return this.#streams
  }

  @getter(Array)
  get captureStreams() {
    return this.#captureStreams
  }

  constructor() {
    super()
    this.#update()
    this.#timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      this.#update()
      return GLib.SOURCE_CONTINUE
    })
  }

  #update() {
    const newStreams = parseStreams()
    const newCaptureStreams = parseCaptureStreams()
    const streamsChanged = JSON.stringify(newStreams) !== JSON.stringify(this.#streams)
    const captureChanged = JSON.stringify(newCaptureStreams) !== JSON.stringify(this.#captureStreams)

    if (streamsChanged) {
      this.#streams = newStreams
      this.notify("streams")
    }
    if (captureChanged) {
      this.#captureStreams = newCaptureStreams
      this.notify("capture-streams")
    }
  }

  setVolume(id: number, volume: number) {
    try {
      AstalIO.Process.exec(`wpctl set-volume ${id} ${Math.max(0, Math.min(1, volume)).toFixed(2)}`)
      this.#update()
    } catch (e) {
      print("[AppMixer] setVolume failed:", (e as Error).message)
    }
  }

  setMute(id: number, muted: boolean) {
    try {
      AstalIO.Process.exec(`wpctl ${muted ? "mute" : "unmute"} ${id}`)
      this.#update()
    } catch (e) {
      print("[AppMixer] setMute failed:", (e as Error).message)
    }
  }

  dispose() {
    if (this.#timer) {
      GLib.source_remove(this.#timer)
      this.#timer = null
    }
  }
}
