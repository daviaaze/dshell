import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register } from "gnim/gobject"
import logger from "#/lib/logger"

export interface AudioStream {
  id: number
  name: string
  appName: string
  iconName: string
  volume: number
  muted: boolean
  targetNode: number | null
}

function parseStreams(pwDump: string): AudioStream[] {
  try {
    const data = JSON.parse(pwDump)
    const streams: AudioStream[] = []
    for (const item of data) {
      const info = item.info || {}
      const props = info.props || {}
      const mediaClass = props["media.class"] || ""
      if (
        mediaClass.includes("Stream") &&
        mediaClass.includes("Audio") &&
        mediaClass.includes("Output")
      ) {
        const streamProps = info.params?.Props?.[0] || {}
        streams.push({
          id: item.id,
          name: props["node.name"] || "Unknown",
          appName: props["application.name"] || props["node.name"] || "Unknown",
          iconName:
            props["application.icon-name"] || "audio-x-generic-symbolic",
          volume: streamProps.volume ?? 1.0,
          muted: streamProps.mute ?? false,
          targetNode: null,
        })
      }
    }
    return streams
  } catch (e) {
    logger.error("audio", "failed to parse streams:", e)
    return []
  }
}

function parseCaptureStreams(pwDump: string): AudioStream[] {
  try {
    const data = JSON.parse(pwDump)
    const streams: AudioStream[] = []
    for (const item of data) {
      const info = item.info || {}
      const props = info.props || {}
      const mediaClass = props["media.class"] || ""
      if (
        mediaClass.includes("Stream") &&
        mediaClass.includes("Audio") &&
        mediaClass.includes("Input")
      ) {
        const streamProps = info.params?.Props?.[0] || {}
        streams.push({
          id: item.id,
          name: props["node.name"] || "Unknown",
          appName: props["application.name"] || props["node.name"] || "Unknown",
          iconName:
            props["application.icon-name"] || "audio-x-generic-symbolic",
          volume: streamProps.volume ?? 1.0,
          muted: streamProps.mute ?? false,
          targetNode: null,
        })
      }
    }
    return streams
  } catch (e) {
    logger.error("audio", "failed to parse capture streams:", e)
    return []
  }
}

function parseTargets(pwMetadata: string): Map<number, number> {
  const targets = new Map<number, number>()
  try {
    for (const line of pwMetadata.split("\n")) {
      const match = line.match(/id:(\d+)\s+key:'target\.node'\s+value:'(\d+)'/)
      if (match) {
        targets.set(parseInt(match[1]), parseInt(match[2]))
      }
    }
  } catch (e) {
    logger.error("audio", "failed to parse targets:", e)
  }
  return targets
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
  #lastModified = new Map<number, number>()
  static readonly MODIFY_GRACE_MS = 3000

  @getter(Array)
  get streams() {
    return this.#streams
  }

  @getter(Array)
  get captureStreams() {
    return this.#captureStreams
  }

  @getter(Boolean)
  get microphoneInUse() {
    return this.#captureStreams.length > 0
  }

  constructor() {
    super()
    // Initial fetch on next idle cycle to avoid blocking constructor
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.#fetchAndUpdate()
      return GLib.SOURCE_REMOVE
    })
    this.#timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      this.#fetchAndUpdate()
      return GLib.SOURCE_CONTINUE
    })
  }

  #fetchAndUpdate() {
    try {
      const pwDump = AstalIO.Process.exec("pw-dump")
      const pwMetadata = AstalIO.Process.exec("pw-metadata -n default")
      this.#update(pwDump, pwMetadata)
    } catch (e) {
      logger.error("audio", "pw-dump or pw-metadata failed:", e)
    }
  }

  #update(pwDump: string, pwMetadata: string) {
    const newStreams = parseStreams(pwDump)
    const newCaptureStreams = parseCaptureStreams(pwDump)
    const targets = parseTargets(pwMetadata)
    const now = Date.now()

    for (const s of newStreams) {
      s.targetNode = targets.get(s.id) ?? null
      const lastMod = this.#lastModified.get(s.id)
      if (lastMod && now - lastMod < AppMixer.MODIFY_GRACE_MS) {
        const existing = this.#streams.find((x) => x.id === s.id)
        if (existing) {
          s.volume = existing.volume
          s.muted = existing.muted
          s.targetNode = existing.targetNode
        }
      }
    }
    for (const s of newCaptureStreams) {
      s.targetNode = targets.get(s.id) ?? null
    }

    const streamsChanged =
      JSON.stringify(newStreams) !== JSON.stringify(this.#streams)
    const captureChanged =
      JSON.stringify(newCaptureStreams) !== JSON.stringify(this.#captureStreams)

    if (streamsChanged) {
      this.#streams = newStreams
      this.notify("streams")
    }
    const hadCapture = this.#captureStreams.length > 0
    if (captureChanged) {
      this.#captureStreams = newCaptureStreams
      this.notify("capture-streams")
    }
    if (hadCapture !== newCaptureStreams.length > 0) {
      this.notify("microphone-in-use")
    }
  }

  #optimisticUpdate(id: number, patch: Partial<AudioStream>) {
    const idx = this.#streams.findIndex((s) => s.id === id)
    if (idx === -1) return
    this.#streams = [
      ...this.#streams.slice(0, idx),
      { ...this.#streams[idx], ...patch },
      ...this.#streams.slice(idx + 1),
    ]
    this.#lastModified.set(id, Date.now())
    this.notify("streams")
  }

  setVolume(id: number, volume: number) {
    const clamped = Math.max(0, Math.min(1, volume))
    try {
      AstalIO.Process.exec(`wpctl set-volume ${id} ${clamped.toFixed(2)}`)
    } catch (e) {
      logger.error("audio", "setVolume wpctl failed:", e)
      return
    }
    this.#optimisticUpdate(id, { volume: clamped })
  }

  setMute(id: number, muted: boolean) {
    try {
      AstalIO.Process.exec(`wpctl set-mute ${id} ${muted ? "1" : "0"}`)
    } catch (e) {
      logger.error("audio", "setMute wpctl failed:", e)
      return
    }
    this.#optimisticUpdate(id, { muted })
  }

  setTargetNode(id: number, nodeId: number) {
    try {
      if (nodeId === -1) {
        AstalIO.Process.exec(`pw-metadata -n default -d ${id} target.node`)
      } else {
        AstalIO.Process.exec(
          `pw-metadata -n default ${id} target.node ${nodeId}`,
        )
      }
    } catch (e) {
      logger.error("audio", "setTargetNode failed:", e)
      return
    }
    this.#optimisticUpdate(id, { targetNode: nodeId === -1 ? null : nodeId })
  }

  dispose() {
    if (this.#timer) {
      GLib.source_remove(this.#timer)
      this.#timer = null
    }
  }
}
