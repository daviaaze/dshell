#!@gjs@ -m

import Gettext from 'gettext';
import GLib from 'gi://GLib?version=2.0';
import GLibUnix from 'gi://GLibUnix?version=2.0';
import {exit, programArgs, programInvocationName} from 'system';
import {app} from '#/App';
import logger, {initLoggerFromSettings, perf} from '#/lib/logger';

// ── Suppress noisy GtkStack warnings during startup ──

function suppressGtkStackWarnings() {
    let shuttingDown = false;
    GLib.log_set_writer_func(
        (
            _logDomain: string | null,
            _logLevels: number,
            message: string | null
        ) => {
            // Bail out during shutdown / GC to avoid touching destroyed actors
            if (shuttingDown) {
                return 1; /* GLib.LogWriterOutput.HANDLED */
            }
            if (
                message &&
                (message.includes('duplicate child name in GtkStack') ||
                 message.includes('Theme parser error') ||
                 message.includes('Conversion to invalid speed unit') ||
                 message.includes('Attempting to run a JS callback during garbage collection'))
            ) {
                return 1; /* GLib.LogWriterOutput.HANDLED */
            }
            return 0; /* GLib.LogWriterOutput.UNHANDLED */
        }
    );
    return () => { shuttingDown = true; };
}

// ── Graceful shutdown on signals ──

function setupSignalHandlers() {
    let quitting = false;
    const handleSignal = (sig: number): true => {
        if (quitting) {
            stopLogSuppression();
            logger.log(`received signal ${sig} again, forcing exit`);
            exit(1);
        } else {
            quitting = true;
            stopLogSuppression();
            logger.log(`received signal ${sig}, shutting down gracefully...`);
            app.quit();
        }
        return GLib.SOURCE_REMOVE;
    };

    for (const sig of [2 /* SIGINT */, 15 /* SIGTERM */]) {
        GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, sig, () =>
            handleSignal(sig)
        );
    }
}

// ── i18n setup ──

function setupI18n() {
    const localedir = GLib.build_filenamev([import.meta.datadir, 'locale']);
    Gettext.bindtextdomain(import.meta.domain, localedir);
    Gettext.textdomain(import.meta.domain);
}

// ── Main ──

const stopLogSuppression = suppressGtkStackWarnings();
perf.start('main.ts startup');
logger.log('main.ts starting');

initLoggerFromSettings();
setupI18n();
setupSignalHandlers();

logger.log('calling app.runAsync');
const exitCode = await app.runAsync([programInvocationName, ...programArgs]);

perf.stop('main.ts startup');
logger.log(`exiting with ${exitCode}`);
exit(exitCode);
