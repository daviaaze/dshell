#!@gjs@ -m

import Gettext from 'gettext';
import GLib from 'gi://GLib?version=2.0';
import GLibUnix from 'gi://GLibUnix?version=2.0';
import {exit, programArgs, programInvocationName} from 'system';
import {app} from '#/App';
import logger, {initLoggerFromSettings, perf} from '#/lib/logger';

// ── Graceful shutdown on signals ──

function setupSignalHandlers() {
    let quitting = false;
    const handleSignal = (sig: number): true => {
        if (quitting) {
            logger.log(`received signal ${sig} again, forcing exit`);
            exit(1);
        } else {
            quitting = true;
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
