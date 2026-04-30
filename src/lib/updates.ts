import GObject, { getter, register, setter } from "gnim/gobject"
import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"

export type UpdateBackend = "nixos" | "arch" | "fedora" | "unknown"

function detectBackend(): UpdateBackend {
  try {
    const [, contents] = GLib.file_get_contents("/etc/os-release")
    const text = new TextDecoder().decode(contents)
    if (text.includes("ID=nixos")) return "nixos"
    if (text.includes("ID=arch") || text.includes("ID_LIKE=arch")) return "arch"
    if (text.includes("ID=fedora")) return "fedora"
  } catch { /* ignore */ }
  return "unknown"
}

@register({ GTypeName: "UpdatesService" })
export default class UpdatesService extends GObject.Object {
  static instance: UpdatesService
  static get_default() {
    if (!this.instance) this.instance = new UpdatesService()
    return this.instance
  }

  #count = 0
  #checking = false
  #backend = detectBackend()
  #timer: number | null = null
  #intervalMin = 30

  @getter(Number)
  get count() {
    return this.#count
  }

  @setter(Number)
  set count(v: number) {
    this.#count = v
    this.notify("count")
  }

  @getter(Boolean)
  get checking() {
    return this.#checking
  }

  @setter(Boolean)
  set checking(v: boolean) {
    this.#checking = v
    this.notify("checking")
  }

  constructor() {
    super()
    this.#schedule()
    this.check()
  }

  dispose() {
    if (this.#timer) {
      GLib.source_remove(this.#timer)
      this.#timer = null
    }
  }

  #schedule() {
    if (this.#timer) GLib.source_remove(this.#timer)
    this.#timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, this.#intervalMin * 60, () => {
      this.check()
      return GLib.SOURCE_CONTINUE
    })
  }

  setInterval(minutes: number) {
    this.#intervalMin = Math.max(5, minutes)
    this.#schedule()
  }

  async check() {
    if (this.checking) return
    if (this.#backend === "unknown") return
    this.checking = true

    try {
      const count = await this.#runCheck()
      this.count = count
    } catch (e) {
      print("[Updates] check failed:", (e as Error).message)
    } finally {
      this.checking = false
    }
  }

  #runCheck(): Promise<number> {
    return new Promise((resolve, reject) => {
      let cmd: string[]
      switch (this.#backend) {
        case "nixos":
          cmd = ["nixos-rebuild", "dry-build"]
          break
        case "arch":
          cmd = ["checkupdates"]
          break
        case "fedora":
          cmd = ["dnf", "check-update", "--refresh"]
          break
        default:
          resolve(0)
          return
      }

      AstalIO.Process.exec_asyncv(cmd)
        .then((out: string) => {
          const lines = out.split("\n").filter(l => l.trim())
          if (this.#backend === "nixos") {
            const builds = lines.filter(l => l.includes("/nix/store/") && l.includes("-"))
            resolve(builds.length)
          } else if (this.#backend === "arch") {
            resolve(lines.length)
          } else if (this.#backend === "fedora") {
            const pkgs = lines.filter(l => l.match(/^\S+\.\S+\s+\S+/))
            resolve(pkgs.length)
          } else {
            resolve(0)
          }
        })
        .catch((err: Error) => {
          const msg = err.message || ""
          if (this.#backend === "arch" && msg.includes("checkupdates")) {
            resolve(0)
            return
          }
          if (this.#backend === "fedora" && msg.includes("100")) {
            const match = msg.match(/(\d+) package/)
            resolve(match ? parseInt(match[1], 10) : 1)
            return
          }
          reject(err)
        })
    })
  }
}
