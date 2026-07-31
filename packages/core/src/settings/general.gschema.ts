import {defineSettings, getRegisteredSchema} from '../settingsRegistry';
import {defineSchemaList} from 'gnim/schema';

/**
 * General shell settings (shell-core).
 *
 * Cross-cutting: consumed by ColorScheme, NightLight, Hypridle, SoundAlerts,
 * NotificationHistory, PaletteGenerator, and the wallpaper service. The
 * weather-* keys are written by the Weather service and read by ColorScheme
 * and NightLight for day/night detection.
 *
 * Lives in @shade/core (not @shade/services) because it is imported by both
 * services and the style layer — and the ESLint DAG forbids style→services.
 * It is pure schema data with no gi dependency at import time.
 */
export const generalSettings = defineSettings('general', s => {
    const datadir = import.meta.datadir || '@datadir@';
    return s
        .key('color-scheme', 'i', {
            default: 0,
        })
        .key('wallpaper-day', 's', {
            default: `${datadir}/shade-shell/wp-day.jpg`,
        })
        .key('wallpaper-night', 's', {
            default: `${datadir}/shade-shell/wp-night.jpg`,
        })
        .key('timezones', 'as', {
            default: ['America/Sao_Paulo', 'Australia/Sydney'],
            summary: 'List of IANA timezone identifiers for the world clock',
        })
        .key('night-light-enabled', 'b', {
            default: false,
            summary: 'Enable blue light filter (hyprsunset)',
        })
        .key('night-light-temperature', 'i', {
            default: 3500,
            summary: 'Night light color temperature in Kelvin (2000-6500)',
            range: {min: 2000, max: 6500},
        })
        .key('night-light-auto-schedule', 'b', {
            default: false,
            summary:
                'Automatically enable night light at sunset and disable at sunrise',
        })
        // ── Sound Alerts ────────────────────────────────────────────────────
        .key('sound-alerts-enabled', 'b', {
            default: true,
            summary: 'Master toggle for all sound alerts',
        })
        .key('sound-alert-notification', 'b', {
            default: true,
            summary: 'Play sound on notification arrival',
        })
        .key('sound-alert-capture', 'b', {
            default: true,
            summary: 'Play sound on screenshot/recording events',
        })
        .key('sound-alert-battery', 'b', {
            default: true,
            summary: 'Play sound on low battery warning',
        })
        .key('sound-alert-system', 'b', {
            default: true,
            summary: 'Play sound on system events (lock/unlock, power, devices)',
        })

        // ── Idle Management (Hypridle) ─────────────────────────────────────
        // These keys are consumed by Hypridle which generates a hypridle.conf.
        // The timeout chain must satisfy: dim < idle < dpms < suspend.
        // If a key violates this ordering, Hypridle clamps it automatically.
        .key('auto-lock-enabled', 'b', {
            default: true,
            summary:
                'Automatically lock screen after idle timeout (requires hypridle)',
        })
        .key('idle-timeout', 'i', {
            default: 300,
            summary:
                'Seconds of inactivity before auto-lock. Valid range: 60-1800.',
            description:
                'After this many seconds of inactivity, the screen locks. ' +
                'dim-timeout should be lower, dpms-timeout and suspend-timeout should be higher.',
            range: {min: 60, max: 1800},
        })
        .key('screen-dim-enabled', 'b', {
            default: true,
            summary: 'Dim screen brightness before locking',
            description:
                'When enabled, the screen dims to 10% brightness screen-dim-timeout seconds ' +
                'before the lock triggers. Original brightness is restored on activity.',
        })
        .key('screen-dim-timeout', 'i', {
            default: 240,
            summary:
                'Seconds of inactivity before dimming. Valid range: 30 to (idle-timeout - 10).',
            range: {min: 30, max: 1790},
        })
        .key('dpms-enabled', 'b', {
            default: true,
            summary: 'Turn off display(s) via DPMS after prolonged inactivity',
        })
        .key('dpms-timeout', 'i', {
            default: 600,
            summary:
                'Seconds of inactivity before DPMS off. Valid range: (idle-timeout + 10) to 3600.',
            range: {min: 70, max: 3600},
        })
        .key('suspend-enabled', 'b', {
            default: false,
            summary: 'Suspend the system after extended inactivity',
            description:
                'WARNING: enabling this will suspend your machine when suspend-timeout is reached. ' +
                'Unsaved work may be lost. Disabled by default.',
        })
        .key('suspend-timeout', 'i', {
            default: 1800,
            summary:
                'Seconds of inactivity before system suspend. Valid range: (dpms-timeout + 10) to 7200.',
            range: {min: 80, max: 7200},
        })
        .key('notification-history-limit', 'i', {
            default: 100,
            summary: 'Maximum number of notifications to keep in history',
            range: {min: 20, max: 500},
        })
        .key('notification-show-progress', 'b', {
            default: false,
            summary:
                'Show countdown progress bar on notification popups (off by default)',
        })
        .key('notification-ignored-apps', 'as', {
            default: [],
            summary: 'List of app names to ignore for notifications',
        })
        .key('dynamic-theming-enabled', 'b', {
            default: false,
            summary: 'Extract accent colors from wallpaper using matugen',
        })
        .key('debug-enabled', 'b', {
            default: false,
            summary: 'Enable DEBUG-level logging (very verbose)',
        })
        .key('debug-categories', 'as', {
            default: [],
            summary:
                'Debug categories to enable (empty = all). Categories: mount, state, theme, dbus, exec, perf, memory',
        })

        // ── Audio Visualizer (Cava) ──────────────────────────────────────
        .key('cava-enabled', 'b', {
            default: false,
            summary: 'Show audio visualizer in quick settings',
        })
        .key('cava-bars', 'i', {
            default: 16,
            summary: 'Number of bars in the audio visualizer',
            range: {min: 4, max: 64},
        })
        .key('cava-framerate', 'i', {
            default: 60,
            summary: 'Frame rate of the audio visualizer',
            range: {min: 15, max: 120},
        })

        // ── Weather-derived state (set by Weather service, consumed by ColorScheme, NightLight) ──
        .key('weather-is-daytime', 'b', {
            default: true,
            summary: 'Whether it is currently daytime (set by Weather service)',
        })
        .key('weather-sunrise-time', 'd', {
            default: 0.0,
            summary: 'Unix timestamp of next sunrise (set by Weather service)',
        })
        .key('weather-sunset-time', 'd', {
            default: 0.0,
            summary: 'Unix timestamp of next sunset (set by Weather service)',
        })
        .key('experimental-wayland-monitors', 'b', {
            default: false,
            summary:
                'Use AstalWl for Wayland-native monitor tracking (experimental)',
            description:
                'When enabled, replaces Gdk.Monitor tracking with AstalWl.Output for ' +
                'Wayland-native monitor enumeration. The monitors array and all widget ' +
                'interfaces remain unchanged. Disable to instantly revert to Gdk tracking.',
        });
});

export default defineSchemaList([getRegisteredSchema('general')]);
