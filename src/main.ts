#!@gjs@ -m

import Gettext from "gettext"
import GLib from "gi://GLib?version=2.0"
import GLibUnix from "gi://GLibUnix?version=2.0"
import { exit, programArgs, programInvocationName } from "system"
import { app } from "#/App"
import logger, { initLoggerFromSettings, perf } from "#/lib/logger"

// Suppress "duplicate child name in GtkStack" warnings from library internals
// (Astal/Adw periodically re-adds stack pages on NM scan or Bluetooth refresh).
GLib.log_set_writer_func((_logDomain: string | null, _logLevels: number, message: string | null) => {
  if (message && message.includes("duplicate child name in GtkStack")) {
    return 1 /* GLib.LogWriterOutput.HANDLED */
  }
  return 0 /* GLib.LogWriterOutput.UNHANDLED */
})

perf.start("main.ts startup")
logger.log("main.ts starting")

// Initialize debug logging from GSettings (after schema is registered)
initLoggerFromSettings()

const localedir = GLib.build_filenamev([import.meta.datadir, "locale"])
Gettext.bindtextdomain(import.meta.domain, localedir)
Gettext.textdomain(import.meta.domain)

// Handle SIGINT (Ctrl+C) and SIGTERM gracefully so D-Bus exports,
// AstalNotifd daemon, and other resources are cleaned up before exit.
// Without this, a forced kill leaks D-Bus exports and the next startup
// hits "already exported" errors with 25s timeouts.
let quitting = false
for (const sig of [2 /* SIGINT */, 15 /* SIGTERM */]) {
  GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, sig, () => {
    if (quitting) {
      logger.log(`received signal ${sig} again, forcing exit`)
      exit(1)
      return GLib.SOURCE_REMOVE
    }
    quitting = true
    logger.log(`received signal ${sig}, shutting down gracefully...`)
    app.quit()
    return GLib.SOURCE_REMOVE
  })
}

logger.log("calling app.runAsync")
const exitCode = await app.runAsync([programInvocationName, ...programArgs])

perf.stop("main.ts startup")
logger.log(`exiting with ${exitCode}`)
exit(exitCode)
