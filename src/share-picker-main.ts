#!/usr/bin/env gjs -m
/**
 * Standalone share picker for xdg-desktop-portal-hyprland (XDPH).
 *
 * Launched by XDPH via custom_picker_binary config.
 * Reads environment variables, shows a GTK4 window with monitor/window
 * selection, prints result to stdout, then exits.
 *
 * XDPH protocol:
 *   Environment: XDPH_WINDOW_SHARING_LIST = "ID[HC>]CLASS[HT>]TITLE[HE>]ADDR[HA>] ..."
 *   Args: --allow-token (if passed, token restore should be checked by default)
 *   Stdout: [SELECTION][r]/screen:NAME  or  [SELECTION][r]/window:ID
 */

import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import Gdk from "gi://Gdk?version=4.0"
import { programArgs, print } from "system"

// ── Parse window list from XDPH env var ─────────────────────────

interface WindowEntry {
  id: string
  clazz: string
  title: string
  address: string
}

function parseWindowList(env: string | null): WindowEntry[] {
  if (!env) return []
  const result: WindowEntry[] = []
  let remaining = env

  while (remaining.length > 0) {
    const idSep = remaining.indexOf("[HC>]")
    if (idSep === -1) break
    const id = remaining.substring(0, idSep)

    const classSep = remaining.indexOf("[HT>]", idSep)
    if (classSep === -1) break
    const clazz = remaining.substring(idSep + 5, classSep)

    const titleSep = remaining.indexOf("[HE>]", classSep)
    if (titleSep === -1) break
    const title = remaining.substring(classSep + 5, titleSep)

    const addrSep = remaining.indexOf("[HA>]", titleSep)
    const endSep = remaining.indexOf(" ", titleSep + 5)
    const effectiveEnd = endSep === -1 ? remaining.length : endSep

    let address = ""
    if (addrSep !== -1 && addrSep < effectiveEnd) {
      address = remaining.substring(addrSep + 5, effectiveEnd)
    }

    result.push({ id, clazz, title, address })
    remaining = remaining.substring(effectiveEnd + 1)
  }

  return result
}

// ── Get screen/monitor info via libadwaita ───────────────────────

// We need to check what Gdk.Monitor provides. Using Astal's approach
// with Gdk.Display.get_default().get_monitors()
interface MonitorInfo {
  name: string
  x: number
  y: number
  width: number
  height: number
  description: string
}

function getMonitors(): MonitorInfo[] {
  const display = Gdk.Display.get_default()
  if (!display) return []

  const result: MonitorInfo[] = []
  // Gdk.Display.get_n_monitors() returns int
  const nMonitors = display.get_n_monitors()
  for (let i = 0; i < nMonitors; i++) {
    const monitor = display.get_monitor(i)
    if (!monitor) continue
    const geom = monitor.geometry
    result.push({
      name: monitor.connector || `Monitor-${i}`,
      x: geom.x,
      y: geom.y,
      width: geom.width,
      height: geom.height,
      description: monitor.model || `Monitor ${i}`,
    })
  }
  return result
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  // Parse args
  let allowTokenDefault = false
  for (const arg of programArgs) {
    if (arg === "--allow-token") allowTokenDefault = true
  }

  // Read XDPH env
  const windowListStr = GLib.getenv("XDPH_WINDOW_SHARING_LIST")
  const windows = parseWindowList(windowListStr)
  const monitors = getMonitors()

  // Init GTK
  const app = new Gtk.Application({
    applicationId: "com.caioasmuniz.shade_shell.share_picker",
    flags: 0,
  })

  let result: string | null = null
  let tokenRestore = allowTokenDefault

  app.connect("activate", () => {
    // Create window
    const win = new Gtk.Window({ application: app, title: "Share Screen / Window" })
    win.set_default_size(500, 400)
    win.set_resizable(true)
    win.set_hide_on_close(true)

    // ── Main layout ────────────────────────────────────────────
    const mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 })
    mainBox.set_margin(12)

    // Header
    const header = new Gtk.Label({
      label: "Select what to share",
      cssClasses: ["title-2"],
      halign: Gtk.Align.START,
    })
    mainBox.append(header)

    // Notebook (tabs)
    const notebook = new Gtk.Notebook()
    notebook.set_scrollable(true)

    // ── Monitors tab ───────────────────────────────────────────
    const monitorsBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
      marginTop: 8,
      marginBottom: 8,
      marginStart: 4,
      marginEnd: 4,
    })
    const monitorsScroll = new Gtk.ScrolledWindow()
    monitorsScroll.set_child(monitorsBox)
    monitorsScroll.set_vexpand(true)

    if (monitors.length === 0) {
      const noMonLabel = new Gtk.Label({ label: "No monitors found" })
      monitorsBox.append(noMonLabel)
    } else {
      for (const mon of monitors) {
        const text = `${mon.description} (${mon.name}) — ${mon.width}x${mon.height} @${mon.x},${mon.y}`
        const btn = new Gtk.Button({ label: text, halign: Gtk.Align.FILL, hexpand: true })
        btn.add_css_class("flat")
        btn.connect("clicked", () => {
          result = `[SELECTION]${tokenRestore ? "r" : ""}/screen:${mon.name}\n`
          win.close()
        })
        monitorsBox.append(btn)
      }
    }
    notebook.append_page(monitorsScroll, new Gtk.Label({ label: "Screens" }))

    // ── Windows tab ────────────────────────────────────────────
    const windowsBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
      marginTop: 8,
      marginBottom: 8,
      marginStart: 4,
      marginEnd: 4,
    })
    const windowsScroll = new Gtk.ScrolledWindow()
    windowsScroll.set_child(windowsBox)
    windowsScroll.set_vexpand(true)

    if (windows.length === 0) {
      const noWinLabel = new Gtk.Label({ label: "No windows available" })
      windowsBox.append(noWinLabel)
    } else {
      for (const w of windows) {
        const text = `${w.clazz}: ${w.title}`
        const btn = new Gtk.Button({ label: text, halign: Gtk.Align.FILL, hexpand: true })
        btn.add_css_class("flat")
        btn.set_tooltip_text(`Address: ${w.address}`)
        btn.connect("clicked", () => {
          result = `[SELECTION]${tokenRestore ? "r" : ""}/window:${w.id}\n`
          win.close()
        })
        windowsBox.append(btn)
      }
    }
    notebook.append_page(windowsScroll, new Gtk.Label({ label: "Windows" }))

    mainBox.append(notebook)

    // ── Token restore checkbox ─────────────────────────────────
    const tokenBox = new Gtk.CheckButton({ label: "Allow restore token", active: tokenRestore })
    tokenBox.connect("toggled", () => { tokenRestore = tokenBox.active })
    mainBox.append(tokenBox)

    // ── Cancel button ──────────────────────────────────────────
    const cancelBtn = new Gtk.Button({ label: "Cancel", halign: Gtk.Align.CENTER })
    cancelBtn.connect("clicked", () => win.close())
    mainBox.append(cancelBtn)

    win.set_child(mainBox)
    win.present()
  })

  // Handle window close
  app.connect("shutdown", () => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      if (result) {
        print(result)
      }
      return GLib.SOURCE_REMOVE
    })
  })

  app.run([])
}

main()
