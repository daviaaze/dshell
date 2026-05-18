#!@gjs@ -m

import Gettext from "gettext"
import GLib from "gi://GLib?version=2.0"
import { exit, programArgs, programInvocationName } from "system"
import { app } from "../src/App"
import logger, { initLoggerFromSettings, perf } from "#/lib/logger"

perf.start("main.ts startup")
logger.log("main.ts starting")

// Initialize debug logging from GSettings (after schema is registered)
initLoggerFromSettings()

const localedir = GLib.build_filenamev([import.meta.datadir, "locale"])
Gettext.bindtextdomain(import.meta.domain, localedir)
Gettext.textdomain(import.meta.domain)

logger.log("calling app.runAsync")
const exitCode = await app.runAsync([
  programInvocationName, ...programArgs])

perf.stop("main.ts startup")
logger.log(`exiting with ${exitCode}`)
exit(exitCode)
