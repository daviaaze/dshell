import GLib from 'gi://GLib?version=2.0';
import GLibUnix from 'gi://GLibUnix?version=2.0';
import logger, {initLoggerFromSettings, perf} from '@shade/core/logger';
import Gettext from 'gettext';
import {exit, programArgs, programInvocationName} from 'system';
import {CompositorPort} from '@shade/services/compositor/port';
import {renderCompositorConfig} from '@shade/services/compositor/render';
// GTK is loaded dynamically only for the shell UI; compositor CLI paths run before Hyprland.
if (programArgs[0] === 'compositor' && programArgs[1] === 'render') {
    try {
        print(renderCompositorConfig());
        exit(0);
    } catch (cause) {
        printerr(`Shade compositor render failed: ${cause}`);
        exit(1);
    }
}
if (programArgs[0] === 'compositor' && programArgs[1] === 'dpms') {
    try {
        const action = programArgs[2];
        if (action !== 'on' && action !== 'off')
            throw new Error('Usage: shade-shell compositor dpms <on|off>');
        await new CompositorPort().applyDpms(action === 'on');
        exit(0);
    } catch (cause) {
        printerr(`Shade compositor DPMS failed: ${cause}`);
        exit(1);
    }
}

const {app} = await import('./App');
// ── Graceful shutdown on signals ──

function setupSignalHandlers() {
    let quitting = false;
    const handleSignal = (sig: number): boolean => {
        if (quitting) {
            logger.log(`received signal ${sig} again, forcing exit`);
            exit(1);
        }
        quitting = true;
        logger.log(`received signal ${sig}, shutting down gracefully`);
        // Goes through GTK shutdown → #teardown → ServiceRegistry.disposeAll
        app.quit();
        // Safety net: force-exit if graceful shutdown wedges
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            logger.log('graceful shutdown timed out, forcing exit');
            exit(1);
        });
        return GLib.SOURCE_REMOVE;
    };

    for (const sig of [2 /* SIGINT */, 15 /* SIGTERM */]) {
        GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, sig, () => handleSignal(sig));
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
