/**
 * shade-shell — UI Component Previewer (Storybook for GJS/Gnim)
 *
 * Standalone Adw.Application that lets you browse and preview individual
 * widgets with mock props. Supports live reload via `tools/preview.mjs`.
 *
 * Usage:
 *   node tools/preview.mjs              # Opens component picker
 *   node tools/preview.mjs ActionButton # Opens directly to ActionButton
 *
 * The companion tool watches src/ for changes, rebuilds with esbuild,
 * and automatically restarts this process — giving an instant feedback loop.
 */

import Adw from "gi://Adw?version=1"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { exit, programInvocationName } from "system"
import { createRoot } from "gnim"
import { PreviewWindow } from "./previewer/PreviewWindow"
import css from "./shade.css"

const APP_ID = "com.caioasmuniz.shade_shell.previewer"

function initCss() {
  const display = Gdk.Display.get_default()
  if (!display) {
    print("[previewer] No display — cannot load CSS")
    return
  }
  const provider = new Gtk.CssProvider()
  provider.load_from_data(css, -1)
  Gtk.StyleContext.add_provider_for_display(
    display,
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_USER,
  )

  // Also load a small base style that makes the preview canvas look right
  const baseProvider = new Gtk.CssProvider()
  baseProvider.load_from_data(
    `
    .preview-canvas { padding: 24px; }
    .preview-sidebar {
      border-right: 1px solid alpha(currentColor, 0.08);
      background: alpha(currentColor, 0.02);
    }
    .preview-category-label {
      font-weight: 600;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .preview-nav-item {
      border-radius: 0;
      padding: 4px 12px;
      font-size: 0.9em;
    }
    .preview-nav-item:hover {
      background: alpha(currentColor, 0.08);
    }
    .preview-active {
      background: alpha(currentColor, 0.1) !important;
      font-weight: 600;
    }
    .preview-frame {
      border-radius: 12px;
    }
    .preview-bg-checker {
      background-image: linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%);
      background-size: 20px 20px;
    }
    .preview-bg-light {
      background: #ffffff;
    }
    .preview-bg-dark {
      background: #1e1e1e;
    }
    .preview-props-editor {
      border-left: 1px solid alpha(currentColor, 0.08);
      background: alpha(currentColor, 0.02);
    }
    .preview-listbox row {
      border-bottom: 1px solid alpha(currentColor, 0.04);
    }
    .preview-listbox row:selected {
      background: alpha(currentColor, 0.1);
    }
    .preview-listbox row:not(:selected):hover {
      background: alpha(currentColor, 0.04);
    }
    .preview-category-label {
      font-size: 0.75em;
      letter-spacing: 0.5px;
      opacity: 0.6;
    }
    .preview-sidebar searchbar {
      margin: 4px;
    }
    `,
    -1,
  )
  Gtk.StyleContext.add_provider_for_display(
    display,
    baseProvider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  )
}

// Component name comes from env var (set by tools/preview.mjs)
// to avoid GLib.Application trying to parse it as a file.
const initialComponent = GLib.getenv("SHADE_PREVIEW_COMPONENT") || undefined

const app = new Adw.Application({
  applicationId: APP_ID,
})

app.connect("activate", () => {
  initCss()

  createRoot((dispose) => {
    app.connect("shutdown", dispose)

    const win = app.get_active_window() as Adw.Window | null
    if (win) {
      // If window exists, just present it
      win.present()
      return
    }

    const previewWin = new Adw.Window({
      application: app,
      title: "Shade — UI Previewer",
      defaultWidth: 900,
      defaultHeight: 680,
    })

    previewWin.content = PreviewWindow({ initialComponent })
    previewWin.present()
  })
})

// Only pass the program name — no extra args to avoid file-open errors
const exitCode = await app.runAsync([programInvocationName])
exit(exitCode)
