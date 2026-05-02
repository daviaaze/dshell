#!@gjs@ -m

import Gettext from "gettext"
import GLib from "gi://GLib?version=2.0"
import { exit, programArgs, programInvocationName } from "system"
import { app } from "../src/App"
import logger from "#/lib/logger"

logger.log("main.ts starting")

const localedir = GLib.build_filenamev([import.meta.datadir, "locale"])
Gettext.bindtextdomain(import.meta.domain, localedir)
Gettext.textdomain(import.meta.domain)

logger.log("calling app.runAsync")
const exitCode = await app.runAsync([
  programInvocationName, ...programArgs])

logger.log(`exiting with ${exitCode}`)
exit(exitCode)
