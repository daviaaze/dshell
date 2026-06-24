#!/usr/bin/env node
/**
 * preview.mjs — GJS Component Previewer with live reload
 *
 * Bundles the previewer entry point with esbuild, spawns gjs to render it,
 * watches src/ for file changes, and auto-restarts the GJS process on rebuild.
 *
 * Usage:
 *   node tools/preview.mjs                 # Opens component picker
 *   node tools/preview.mjs ActionButton    # Opens directly to ActionButton
 *   node tools/preview.mjs --watch         # Explicit watch mode (default)
 *   node tools/preview.mjs --no-watch      # Single build + run
 *
 * Dependencies:
 *   - Node.js (already in dev deps via esbuild)
 *   - esbuild (already in dev deps)
 *   - GJS + GTK4 / Adwaita (nix develop shell provides these)
 */

import * as esbuild from "esbuild"
import { spawn } from "child_process"
import { watch, statSync, existsSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const OUTFILE = resolve(ROOT, "build", "previewer.js")

const args = process.argv.slice(2)
const component = args.filter((a) => !a.startsWith("--"))[0] || ""
const enableWatch = !args.includes("--no-watch")

// ── esbuild config (mirrors meson.build but for the previewer entry point) ──

function makeConfig() {
  return {
    entryPoints: [resolve(ROOT, "src/previewer.tsx")],
    bundle: true,
    outfile: OUTFILE,
    format: "esm",
    external: [
      "gi://*",
      "resource://*",
      "system",
      "gettext",
    ],
    loader: {
      ".css": "text",
    },
    tsconfig: resolve(ROOT, "tsconfig.json"),
    alias: {
      "#": resolve(ROOT, "src"),
    },
    define: {
      "import.meta.name": '"shade-previewer"',
      "import.meta.version": '"0.1.0"',
      "import.meta.domain": '"com.caioasmuniz.shade_shell.previewer"',
      "import.meta.datadir": '"/tmp"',
      "import.meta.bindir": '"/tmp"',
    },
    sourcemap: "inline",
    logLevel: "warning",
  }
}

// ── GJS process management ──────────────────────────────────────────────────

let gjsProcess = null

function startGjs() {
  if (gjsProcess) {
    gjsProcess.kill("SIGTERM")
    gjsProcess = null
  }

  // Component name is passed via env var to avoid GLib.Application
  // trying to parse it as a file to open.
  const args = ["-m", OUTFILE]

  gjsProcess = spawn("gjs", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      SHADE_PREVIEW_COMPONENT: component || "",
      // The previewer runs as a regular window, not a layer-shell,
      // so we don't need LD_PRELOAD for gtk4-layer-shell
      LD_PRELOAD: "",
    },
  })

  gjsProcess.on("exit", (code, signal) => {
    if (signal === "SIGTERM") {
      // Normal restart, no message
    } else if (code !== 0 && code !== null) {
      console.error(`[preview] gjs exited with code ${code}`)
    }
    gjsProcess = null
  })
}

// ── File watcher (triggers rebuild + restart) ────────────────────────────────

let watcherCleanup = null

function setupWatcher(ctx) {
  const srcDir = resolve(ROOT, "src")

  // Use fs.watch with recursive for simplicity (no extra deps)
  const fsWatcher = watch(srcDir, { recursive: true }, async (_event, filename) => {
    if (!filename) return
    // Ignore editor temp files and non-TS/TSX/CSS files
    if (
      filename.endsWith("~") ||
      filename.startsWith(".") ||
      !/\.(ts|tsx|css)$/.test(filename)
    ) {
      return
    }

    console.log(`[preview] 🔄 ${filename} changed — rebuilding...`)

    try {
      const result = await ctx.rebuild()
      if (result.errors.length > 0) {
        console.error(`[preview] ❌ Build errors:`)
        for (const err of result.errors) {
          console.error(`  ${err.text}`)
        }
        return
      }
      console.log(`[preview] ✅ Rebuild complete — restarting...`)
      startGjs()
    } catch (e) {
      console.error(`[preview] ❌ Build failed:`, e instanceof Error ? e.message : e)
    }
  })

  watcherCleanup = () => {
    fsWatcher.close()
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = makeConfig()
  console.log(`[preview] 🏗  Building previewer...`)
  console.log(`[preview]    entry: src/previewer.tsx`)
  console.log(`[preview]    out:   ${OUTFILE}`)

  // Ensure output directory exists
  const outDir = dirname(OUTFILE)
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  const ctx = await esbuild.context(config)

  try {
    // Initial build
    const result = await ctx.rebuild()
    if (result.errors.length > 0) {
      console.error(`[preview] ❌ Initial build failed:`)
      for (const err of result.errors) {
        console.error(`  ${err.text}`)
      }
      process.exit(1)
    }

    console.log(`[preview] ✅ Initial build complete`)
    startGjs()

    if (enableWatch) {
      console.log(`[preview] 👀 Watching src/ for changes...`)
      setupWatcher(ctx)
      console.log(`[preview]    Press Ctrl+C to stop`)

      // Graceful shutdown
      process.on("SIGINT", () => {
        console.log(`\n[preview] Shutting down...`)
        cleanup(ctx)
        process.exit(0)
      })
      process.on("SIGTERM", () => {
        cleanup(ctx)
        process.exit(0)
      })
    }
  } catch (e) {
    console.error(`[preview] ❌ Fatal:`, e instanceof Error ? e.message : e)
    cleanup(ctx)
    process.exit(1)
  }
}

function cleanup(ctx) {
  if (gjsProcess) {
    gjsProcess.kill("SIGTERM")
    gjsProcess = null
  }
  if (watcherCleanup) {
    watcherCleanup()
    watcherCleanup = null
  }
  ctx.dispose()
}

main()
