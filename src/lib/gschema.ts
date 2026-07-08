import {defineSchemaList, Schema} from 'gnim-schemas';

const id = import.meta.domain || '@domain@';
const datadir = import.meta.datadir || '@datadir@';
const path = `/${id.replaceAll('.', '/')}/`;

export const barSchema = new Schema({
    id: id + '.bar',
    path: path + 'bar/',
})
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
    })
    .key('dock-pinned-apps', 'as', {
        default: [
            'firefox.desktop',
            'org.gnome.Nautilus.desktop',
            'org.gnome.Console.desktop',
        ],
        summary: 'List of desktop file IDs for pinned dock apps',
    });

export const weatherSchema = new Schema({
    id: id + '.weather',
    path: path + 'weather/',
})
    .key('latitude', 'd', {
        default: 0.0,
    })
    .key('longitude', 'd', {
        default: 0.0,
    })
    .key('auto-location', 'b', {
        default: false,
        summary: 'Automatically detect location for weather',
    });

export const timerSchema = new Schema({
    id: id + '.timer',
    path: path + 'timer/',
})
    .key('pomodoro-work-duration', 'i', {
        default: 25,
        summary: 'Pomodoro work duration in minutes',
    })
    .key('pomodoro-break-duration', 'i', {
        default: 5,
        summary: 'Pomodoro short break duration in minutes',
    })
    .key('pomodoro-long-break-duration', 'i', {
        default: 15,
        summary: 'Pomodoro long break duration in minutes',
    })
    .key('pomodoro-sessions-before-long-break', 'i', {
        default: 4,
        summary: 'Number of work sessions before a long break',
    })
    .key('countdown-presets', 'ai', {
        default: [1, 5, 10, 15, 30, 60],
        summary: 'Countdown preset durations in minutes',
    })
    .key('timer-alert-sound', 's', {
        default: 'complete',
        summary: 'Sound name for timer alerts (freedesktop sound theme)',
    });

export const generalSchema = new Schema({
    id: id + '.general',
    path: path + 'general/',
})
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
    })
    .key('night-light-auto-schedule', 'b', {
        default: false,
        summary:
            'Automatically enable night light at sunset and disable at sunrise',
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
    })
    .key('dpms-enabled', 'b', {
        default: true,
        summary: 'Turn off display(s) via DPMS after prolonged inactivity',
    })
    .key('dpms-timeout', 'i', {
        default: 600,
        summary:
            'Seconds of inactivity before DPMS off. Valid range: (idle-timeout + 10) to 3600.',
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
    })
    .key('notification-history-limit', 'i', {
        default: 100,
        summary: 'Maximum number of notifications to keep in history',
    })
    .key('notification-show-progress', 'b', {
        default: true,
        summary: 'Show countdown progress bar on notification popups',
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
    });

// ── Screen Capture ───────────────────────────────────────────────

export const screenCaptureSchema = new Schema({
    id: id + '.screen-capture',
    path: path + 'screen-capture/',
})
    .key('recorder-backend', 'i', {
        default: 2,
        summary: 'Recording backend (0 = wl-screenrec, 1 = wf-recorder, 2 = auto)',
    })
    .key('recording-format', 'i', {
        default: 0,
        summary: 'Recording container format (0 = mp4, 1 = webm)',
    })
    .key('screenshot-format', 'i', {
        default: 0,
        summary: 'Screenshot image format (0 = png, 1 = jpg)',
    })
    .key('record-audio', 'b', {
        default: true,
        summary: 'Enable audio recording by default',
    })
    .key('show-recording-boundary', 'b', {
        default: true,
        summary: 'Show red border around recorded/shared area',
    })
    .key('recording-boundary-color', 's', {
        default: '#FF0000',
        summary: 'Color of the recording boundary border',
    })
    .key('virtual-monitor-resolution', 's', {
        default: '1920x1080',
        summary: 'Default resolution for virtual monitors',
    })
    .key('virtual-monitor-fps', 'i', {
        default: 60,
        summary: 'Default refresh rate for virtual monitors',
    })
    .key('overlay-freeze-enabled', 'b', {
        default: true,
        summary: 'Freeze screen when opening the capture overlay',
    })
    .key('audio-input-id', 'i', {
        default: -1,
        summary: 'PipeWire node ID for recording audio input (-1 = system default)',
    })
    .key('recording-quality', 'i', {
        default: 1,
        summary: 'Recording quality preset (0=Low, 1=Medium, 2=High)',
        range: {min: 0, max: 2},
    })
    .key('preview-thumbnails-enabled', 'b', {
        default: true,
        summary: 'Show live preview thumbnails in capture overlay',
    });

export default defineSchemaList([
    barSchema,
    generalSchema,
    weatherSchema,
    timerSchema,
    screenCaptureSchema,
]);
