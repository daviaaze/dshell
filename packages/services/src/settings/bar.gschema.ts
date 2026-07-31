import {defineSettings, getRegisteredSchema} from '@shade/core/settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * Bar + dock settings (shell-domain).
 *
 * Owned by the bar widget but consumed across the shell: SystemUsage reads
 * tempPath, the dock reads dock-enabled, the settings UI edits everything.
 */
export const barSettings = defineSettings('bar', s => s
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
        summary:
            'The System Monitor to be opened when clicking systemUsage widget',
    })
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
        summary:
            'Show system indicators (network, battery, audio, etc.) in the bar',
    })
    .key('show-bluetooth-battery', 'b', {
        default: true,
        summary: 'Show connected bluetooth device battery level in the bar',
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
        default: [
            'firefox.desktop',
            'org.gnome.Nautilus.desktop',
            'org.gnome.Console.desktop',
        ],
        summary: 'List of desktop file IDs for pinned dock apps',
    }));

export default defineSchemaList([getRegisteredSchema('bar')]);
