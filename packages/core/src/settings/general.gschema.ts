import {defineSchemaList, type Schema} from 'gnim/schema';
import {defineSettings, getRegisteredSchema} from '../settingsRegistry';

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
 *
 * The schema chain is split into per-group helpers. The key tuples MUST be
 * threaded as explicit generic params (`Schema<T, E, F>`): writing
 * `<S extends Schema>(s: S)` would resolve `.key()` against the constraint's
 * default `Schema<[], [], []>` and silently erase all previously accumulated
 * keys from the resulting settings type.
 */

// Structural stand-ins for gnim's non-exported TypedKey/EnumKey/FlagsKey.
type TypedKeyLike = {name: string; type: string};
type EnumKeyLike = {name: string; enum: never; aliases: never};
type FlagsKeyLike = {name: string; flag: never};

/** Color scheme and wallpaper selection. */
function appearanceKeys<
    T extends TypedKeyLike[],
    E extends EnumKeyLike[],
    F extends FlagsKeyLike[],
>(s: Schema<T, E, F>, datadir: string) {
    return s
        .key('color-scheme', 'i', {
            default: 0,
        })
        .key('wallpaper-day', 's', {
            default: `${datadir}/shade-shell/wp-day.jpg`,
        })
        .key('wallpaper-night', 's', {
            default: `${datadir}/shade-shell/wp-night.jpg`,
        });
}

/** World-clock timezones. */
function clockKeys<T extends TypedKeyLike[], E extends EnumKeyLike[], F extends FlagsKeyLike[]>(
    s: Schema<T, E, F>
) {
    return s.key('timezones', 'as', {
        default: ['America/Sao_Paulo', 'Australia/Sydney'],
        summary: 'List of IANA timezone identifiers for the world clock',
    });
}

/** Blue-light filter (hyprsunset). */
function nightLightKeys<
    T extends TypedKeyLike[],
    E extends EnumKeyLike[],
    F extends FlagsKeyLike[],
>(s: Schema<T, E, F>) {
    return s
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
            summary: 'Automatically enable night light at sunset and disable at sunrise',
        });
}

/** Sound alert toggles. */
function soundAlertKeys<
    T extends TypedKeyLike[],
    E extends EnumKeyLike[],
    F extends FlagsKeyLike[],
>(s: Schema<T, E, F>) {
    return s
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
        });
}

/** System notification thresholds and interaction-sound preferences. */
function alertKeys<T extends TypedKeyLike[], E extends EnumKeyLike[], F extends FlagsKeyLike[]>(
    s: Schema<T, E, F>
) {
    return s
        .key('alert-battery-enabled', 'b', {
            default: true,
            summary: 'Notify about low and critical battery while discharging',
        })
        .key('alert-battery-low-threshold', 'i', {
            default: 20,
            summary: 'Low battery threshold in percent',
            range: {min: 10, max: 50},
        })
        .key('alert-battery-critical-threshold', 'i', {
            default: 10,
            summary: 'Critical battery threshold in percent (below the low threshold)',
            range: {min: 1, max: 20},
        })
        .key('alert-power-enabled', 'b', {
            default: true,
            summary: 'Notify when the charger is connected or disconnected',
        })
        .key('alert-temperature-enabled', 'b', {
            default: true,
            summary: 'Notify about high local sensor temperature',
        })
        .key('alert-temperature-warning-threshold', 'i', {
            default: 80,
            summary: 'Local temperature warning threshold in degrees Celsius',
            range: {min: 50, max: 110},
        })
        .key('alert-temperature-critical-threshold', 'i', {
            default: 90,
            summary: 'Local critical temperature threshold in degrees Celsius (above warning)',
            range: {min: 60, max: 120},
        })
        .key('alert-bluetooth-enabled', 'b', {
            default: true,
            summary: 'Notify about stable Bluetooth device connections and disconnections',
        })
        .key('alert-bluetooth-battery-enabled', 'b', {
            default: true,
            summary: 'Notify about low battery on connected Bluetooth devices',
        })
        .key('alert-bluetooth-battery-threshold', 'i', {
            default: 20,
            summary: 'Bluetooth device low battery threshold in percent',
            range: {min: 5, max: 50},
        })
        .key('sound-alert-power', 'b', {
            default: true,
            summary: 'Play charger connection and disconnection sounds',
        })
        .key('sound-alert-bluetooth', 'b', {
            default: true,
            summary: 'Play debounced Bluetooth connection and disconnection sounds',
        })
        .key('sound-alert-temperature', 'b', {
            default: true,
            summary: 'Play local temperature warning and critical sounds',
        })
        .key('sound-alert-volume', 'b', {
            default: false,
            summary: 'Play feedback when the default speaker volume changes',
        });
}

/**
 * Idle management (Hypridle). Consumed by Hypridle which generates a
 * hypridle.conf. The timeout chain must satisfy: dim < idle < dpms < suspend.
 * If a key violates this ordering, Hypridle clamps it automatically.
 */
function idleKeys<T extends TypedKeyLike[], E extends EnumKeyLike[], F extends FlagsKeyLike[]>(
    s: Schema<T, E, F>
) {
    return s
        .key('auto-lock-enabled', 'b', {
            default: true,
            summary: 'Automatically lock screen after idle timeout (requires hypridle)',
        })
        .key('idle-timeout', 'i', {
            default: 300,
            summary: 'Seconds of inactivity before auto-lock. Valid range: 60-1800.',
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
        });
}

/** Notification history and filtering. */
function notificationKeys<
    T extends TypedKeyLike[],
    E extends EnumKeyLike[],
    F extends FlagsKeyLike[],
>(s: Schema<T, E, F>) {
    return s
        .key('notification-history-limit', 'i', {
            default: 100,
            summary: 'Maximum number of notifications to keep in history',
            range: {min: 20, max: 500},
        })
        .key('notification-show-progress', 'b', {
            default: false,
            summary: 'Show countdown progress bar on notification popups (off by default)',
        })
        .key('notification-lockscreen-content', 'b', {
            default: false,
            summary: 'Show notification content on the lock screen',
        })
        .key('notification-ignored-apps', 'as', {
            default: [],
            summary: 'List of app names to ignore for notifications',
        })
        .key('dnd-schedule-enabled', 'b', {
            default: false,
            summary: 'Enable the daily Do Not Disturb schedule',
        })
        .key('dnd-schedule-start-hour', 'i', {
            default: 22,
            summary: 'Local hour when scheduled Do Not Disturb starts',
            range: {min: 0, max: 23},
        })
        .key('dnd-schedule-end-hour', 'i', {
            default: 7,
            summary: 'Local hour when scheduled Do Not Disturb ends (equal hours disable the window)',
            range: {min: 0, max: 23},
        });
}

/** Dynamic theming and debug logging. */
function themingKeys<T extends TypedKeyLike[], E extends EnumKeyLike[], F extends FlagsKeyLike[]>(
    s: Schema<T, E, F>
) {
    return s
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
}

/**
 * Weather-derived state (written by the Weather service, consumed by
 * ColorScheme and NightLight for day/night detection) plus experiments.
 */
function weatherKeys<T extends TypedKeyLike[], E extends EnumKeyLike[], F extends FlagsKeyLike[]>(
    s: Schema<T, E, F>
) {
    return s
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
            summary: 'Use AstalWl for Wayland-native monitor tracking (experimental)',
            description:
                'When enabled, replaces Gdk.Monitor tracking with AstalWl.Output for ' +
                'Wayland-native monitor enumeration. The monitors array and all widget ' +
                'interfaces remain unchanged. Disable to instantly revert to Gdk tracking.',
        })
        .key('launcher-shortcut-badges', 'b', {
            default: true,
            summary: 'Show configured compositor shortcuts in the application launcher',
        });
}

export const generalSettings = defineSettings('general', (s) => {
    const datadir = import.meta.datadir || '@datadir@';
    const s1 = appearanceKeys(s, datadir);
    const s2 = clockKeys(s1);
    const s3 = nightLightKeys(s2);
    const s4 = soundAlertKeys(s3);
    const s5 = idleKeys(s4);
    const s6 = notificationKeys(s5);
    const s7 = themingKeys(s6);
    return weatherKeys(alertKeys(s7));
});

export default defineSchemaList([getRegisteredSchema('general')]);
