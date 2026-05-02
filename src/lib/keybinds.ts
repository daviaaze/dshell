import AstalIO from "gi://AstalIO?version=0.1"
import logger from "./logger"

export interface Keybind {
  /** Hyprland key combination e.g. "SUPER,Space" */
  modmask: string
  /** The dispatcher and its arguments e.g. "exec, shade-shell toggle applauncher" */
  dispatcher: string
}

const BINDIR = (import.meta as any).bindir || "/usr/local/bin"

const DEFAULT_KEYBINDS: Keybind[] = [
  { modmask: "SUPER,Space", dispatcher: `exec, ${BINDIR}/shade-toggle.sh applauncher` },
  { modmask: "SUPER,n",     dispatcher: `exec, ${BINDIR}/shade-toggle.sh quicksettings` },
  { modmask: "SUPER,w",     dispatcher: `exec, ${BINDIR}/shade-toggle.sh bar` },
]

/**
 * Manages keybindings by registering them with Hyprland via `hyprctl keyword`.
 * Keybinding definitions live here in Shade's code, not in the Hyprland config.
 */
export default class KeybindsManager {
  static instance: KeybindsManager

  static get_default() {
    if (!this.instance) this.instance = new KeybindsManager()
    return this.instance
  }

  #registered = false

  /** Register keybindings dynamically with Hyprland */
  register(binds: Keybind[] = DEFAULT_KEYBINDS) {
    if (this.#registered) return
    this.#registered = true

    for (const bind of binds) {
      const cmd = `bind=${bind.modmask},${bind.dispatcher}`
      try {
        const out = AstalIO.Process.exec(`hyprctl --batch "keyword ${cmd}"`)
        logger.log(`keybind registered: ${cmd} (${out.trim()})`)
      } catch (e) {
        logger.warn(`failed to register keybind "${cmd}":`, e)
      }
    }
  }

  /** Remove all registered keybindings */
  unregister(binds: Keybind[] = DEFAULT_KEYBINDS) {
    if (!this.#registered) return
    this.#registered = false

    try {
      // Unbind via batch: set to empty string removes the bind
      const cmds = binds
        .map(b => `keyword unbind=${b.modmask},${b.dispatcher}`)
        .join(";")
      AstalIO.Process.exec(`hyprctl --batch "${cmds}"`)
      logger.log("keybinds unregistered")
    } catch (e) {
      logger.warn("failed to unregister keybinds:", e)
    }
  }
}
