import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * Bar + dock settings (shell-domain).
 *
 * Owned by the bar widget but consumed across the shell: SystemUsage reads
 * tempPath, the dock reads dock-enabled, the settings UI edits everything.
 */
export const barSettings = defineSettings('bar', (s) =>
    s
        .key('position', 'i', {
            default: 8,
            summary: 'The position of the bar in the screen',
        })
        .key('temp-path', 's', {
            default: '',
            summary: 'Path to the temperature sensor file',
        })
        .key('system-monitor', 's', {
            default: '',
            summary: 'Command for the "Open System Monitor" button in the system usage popup',
        })
        .key('show-cpu-usage', 'b', {default: true, summary: 'Show CPU usage in the bar'})
        .key('show-memory-usage', 'b', {default: true, summary: 'Show memory usage in the bar'})
        .key('show-temperature', 'b', {default: true, summary: 'Show temperature in the bar'})
        .key('show-network-usage', 'b', {default: false, summary: 'Show network usage in the bar'})
        .key('show-swap-usage', 'b', {default: false, summary: 'Show swap usage in the bar'})
        .key('resource-indicator-style', 's', {
            default: 'bars',
            summary: 'Resource indicator style: bars, text, or compact',
        })
        .key('network-rate-unit', 's', {
            default: 'bytes',
            summary: 'Network rate unit: bytes or bits',
        })
        .key('system-usage-interval', 'i', {
            default: 1000,
            summary: 'System usage sampling interval in milliseconds',
            range: {min: 500, max: 5000},
        })
        .key('system-usage-network-interface', 's', {
            default: '',
            summary: 'Network interface to monitor; empty means aggregate non-loopback traffic',
        })
        .key('system-usage-disk-path', 's', {default: '/', summary: 'Filesystem path to monitor'})
        .key('system-usage-source', 's', {
            default: 'local',
            summary: 'System usage source: local or homelab',
        })
        .key('system-usage-remote-url', 's', {
            default: '',
            summary: 'Homelab node_exporter metrics URL (e.g. http://host:9100/metrics)',
        })
        .key('system-usage-remote-interval', 'i', {
            default: 5000,
            summary: 'Homelab metrics polling interval in milliseconds',
            range: {min: 2000, max: 60000},
        })
        .key('system-usage-remote-network-interface', 's', {
            default: '',
            summary: 'Homelab network interface; empty aggregates non-loopback traffic',
        })
        .key('system-usage-remote-disk-path', 's', {
            default: '/',
            summary: 'Homelab filesystem path to monitor',
        })
        .key('system-usage-process-sort', 's', {
            default: 'cpu',
            summary: 'Process sort order: cpu or memory',
        })
        .key('system-usage-process-count', 'i', {
            default: 5,
            summary: 'Number of top processes',
            range: {min: 3, max: 15},
        })
        .key('system-usage-show-graphs', 'b', {default: true, summary: 'Show system usage graphs'})
        .key('system-usage-show-processes', 'b', {
            default: true,
            summary: 'Show top processes in system usage',
        })
        .key('system-usage-show-per-core', 'b', {default: true, summary: 'Show per-core CPU usage'})
        .key('show-disk-usage', 'b', {
            default: false,
            summary: 'Wheter to show disk use in systemUsage',
        })
        .key('show-window-title', 'b', {
            default: true,
            summary: 'Show the active window title in the bar',
        })
        .key('show-launcher', 'b', {
            default: true,
            summary: 'Show the launcher button in the bar',
        })
        .key('show-workspaces', 'b', {
            default: true,
            summary: 'Show workspace indicators in the bar',
        })
        .key('show-system-resources', 'b', {
            default: true,
            summary: 'Show CPU/RAM/temperature monitors in the bar',
        })
        .key('show-clock', 'b', {
            default: true,
            summary: 'Show the clock in the bar',
        })
        .key('show-weather', 'b', {
            default: true,
            summary: 'Show the weather button in the bar',
        })
        .key('show-system-indicators', 'b', {
            default: true,
            summary: 'Show system indicators (network, battery, audio, etc.) in the bar',
        })
        .key('show-bluetooth-battery', 'b', {
            default: true,
            summary: 'Show connected bluetooth device battery level in the bar',
        })
        .key('hidden-tray-items', 'as', {
            default: [],
            summary: 'Tray item IDs displayed in Quick Settings instead of the bar',
        })
        .key('dock-enabled', 'b', {
            default: false,
            summary: 'Show the dock/taskbar at the bottom of the screen',
        })
        .key('dock-auto-hide', 'b', {
            default: false,
            summary: 'Automatically hide the dock when not in use',
        })
        .key('dock-icon-size', 'i', {
            default: 48,
            summary: 'Size of dock icons in pixels',
            range: {min: 24, max: 64},
        })
        .key('dock-pinned-apps', 'as', {
            default: ['firefox.desktop', 'org.gnome.Nautilus.desktop', 'org.gnome.Console.desktop'],
            summary: 'List of desktop file IDs for pinned dock apps',
        })
);

export default defineSchemaList([getRegisteredSchema('bar')]);
