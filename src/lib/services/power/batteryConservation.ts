import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import logger from '../../core/logger';
import {readFile} from '../../core/file';
import {Process} from '../../core/process';
import {Accessor, createState} from 'gnim';

const PATH =
    '/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode';

/**
 * Check if the sysfs file exists and is readable.
 */
function fileExists(): boolean {
    try {
        const file = Gio.File.new_for_path(PATH);
        return file.query_exists(null);
    } catch {
        return false;
    }
}

/**
 * Check if the sysfs file is writable by the current user.
 */
function isWritable(): boolean {
    try {
        const file = Gio.File.new_for_path(PATH);
        if (!file.query_exists(null)) return false;
        const info = file.query_info(
            'access::can-write',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        return info.get_attribute_boolean('access::can-write');
    } catch {
        return false;
    }
}

export const isConservationEnabled = (): boolean => {
    try {
        const content = readFile(PATH);
        return content.trim() === '1';
    } catch {
        return false;
    }
};

/**
 * Toggle battery conservation mode via direct sysfs write.
 * @returns true if the toggle succeeded, false otherwise.
 */
export const toggleConservation = (): boolean => {
    if (!fileExists()) {
        logger.warn('battery', 'conservation sysfs file not found:', PATH);
        return false;
    }

    if (isWritable()) {
        try {
            const current = isConservationEnabled();
            const value = current ? '0' : '1';
            GLib.file_set_contents(PATH, new TextEncoder().encode(value));
            return true;
        } catch (err) {
            logger.error('battery', 'Failed to toggle conservation:', err);
            return false;
        }
    }

    // Not writable — caller should use toggleConservationAsync
    return false;
};

/**
 * Toggle battery conservation mode via pkexec (polkit privilege escalation).
 * Shows a polkit authentication dialog.
 * @returns true if the toggle succeeded, false otherwise.
 */
export const toggleConservationAsync = async (): Promise<boolean> => {
    if (!fileExists()) {
        logger.warn('battery', 'conservation sysfs file not found:', PATH);
        return false;
    }

    try {
        const current = isConservationEnabled();
        const value = current ? '0' : '1';
        await Process.pkexecAsync(`shade-conservation-toggle ${value}`);
        return true;
    } catch (err) {
        logger.error(
            'battery',
            'Failed to toggle conservation via pkexec:',
            err
        );
        return false;
    }
};

// ── Bindable state ──
// sysfs doesn't emit Gio.FileMonitor events, so a slow poll is the only way
// to observe external changes (e.g. Legion tools, other shells). The poll
// lives here in the service; widgets bind to `conservationEnabled`.

const [enabledState, setEnabledState] = createState(isConservationEnabled());
let monitorStarted = false;

/** Reactive conservation-mode state. Call startConservationMonitor() once. */
export const conservationEnabled: Accessor<boolean> = enabledState;

/** Start the 5s sysfs poll that keeps `conservationEnabled` fresh. Idempotent. */
export function startConservationMonitor(): void {
    if (monitorStarted) return;
    monitorStarted = true;
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
        setEnabledState(isConservationEnabled());
        return GLib.SOURCE_CONTINUE;
    });
}

/** Re-read sysfs now (call after a toggle attempt). */
export function refreshConservation(): void {
    setEnabledState(isConservationEnabled());
}
