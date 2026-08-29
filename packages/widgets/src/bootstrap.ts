import type Adw from 'gi://Adw?version=1';
import {render} from '@gnim-js/gtk4';
import {type AppContext, getWidgetActions, getWidgetDefs, initServices} from '@shade/core/define';
import logger, {perf} from '@shade/core/logger';
import ServiceRegistry from '@shade/core/serviceRegistry';
import {initSettingsRoot} from '@shade/core/settingsRegistry';
import ShellState from '@shade/services/state/shellState';

// ═════════════════════════════════════════════════════════════════════════════
//  Side-effect imports — importing registers every built-in service + widget.
//
//  ES module caching guarantees each module body runs exactly once, so a
//  service pulled in by both a widget import and the explicit list below
//  registers only once (no duplicate-name collision).
// ═════════════════════════════════════════════════════════════════════════════

// ── Services ────────────────────────────────────────────────────────────────
import '@shade/services/audio/audioController';
import '@shade/services/session/mediaController';
import '@shade/services/location/weather';
import '@shade/services/display/colorScheme';
import '@shade/services/power/inhibit';
import '@shade/services/display/nightLight';
import '@shade/services/power/hypridle';
import '@shade/services/power/sessionControl';
import '@shade/services/state/shellState';
import '@shade/services/state/windowManager';
import '@shade/services/network/networkService';
import '@shade/services/bluetooth/bluetoothService';
import '@shade/services/monitoring/systemUsage';
import '@shade/services/input/touchpad';
import '@shade/style/palette';
import '@shade/services/notifications/dnd';
import '@shade/services/desktop/trayService';
import '@shade/services/audio/soundAlerts';
import '@shade/services/notifications/history';
import '@shade/services/time/timerService';
import '@shade/services/search/frecency';
import '@shade/services/notifications/guard';
import './style';
import '@shade/services/audio/autoSwitch';
import '@shade/services/state/apps';
import '@shade/services/clipboard/history';

// ── Widgets (each pulls in its own services via its import graph) ───────────
import './wallpaper/widget';
import './bar/widget';
import './dock/widget';
import './osd/widget';
import './applauncher/widget';
import './quicksettings/widget';
import './lockscreen/widget';
import './windowswitcher/widget';
import './screenshot-ui/widget';
import './recording-bar/widget';
import './recording-boundary/widget';
import './notifications/widget';
import './settings/widget';

export function createAppContext(app: Adw.Application): AppContext {
    return {app, registry: ServiceRegistry.get_default()};
}

/**
 * Boot the shell: instantiate settings, initialize services, wire widget
 * actions, then mount every non-lazy widget with per-widget error isolation.
 *
 * Returns the widget disposers (pass to teardown).
 */
export function boot(app: Adw.Application): (() => void)[] {
    perf.start('widgets-mount', 'mount');

    // 1. Instantiate every declared settings group so the global accessors
    //    (barSettings, generalSettings, …) work. Must run before any accessor
    //    is called — including service initArgs factories.
    initSettingsRoot();

    // 2. Register + initialize all services in dependency order.
    const ctx = createAppContext(app);
    initServices(ctx);

    // 3. Wire collected widget actions (onToggleSettings, onToggleWindowSwitcher)
    //    to ShellState.
    ShellState.get_default().registerWidgetActions(getWidgetActions());

    // 4. Mount widgets with error isolation — one render() per widget so a
    //    failure in one doesn't prevent the others from mounting.
    const disposers: (() => void)[] = [];
    for (const def of getWidgetDefs()) {
        if (def.lazy) continue;
        perf.start(`widget-${def.name}`, 'mount');
        try {
            disposers.push(render(def.mount, app));
            const elapsed = perf.stop(`widget-${def.name}`, 'mount');
            logger.info('mount', `${def.name} mounted in ${elapsed.toFixed(1)}ms`);
        } catch (e) {
            logger.error('mount', `Widget ${def.name} FAILED to mount:`, e);
        }
    }

    perf.stop('widgets-mount', 'mount');
    return disposers;
}
