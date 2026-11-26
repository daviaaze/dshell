import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {readFile} from '@shade/core/file';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {type Accessor, createState} from 'gnim';
import {bus} from '../bus';

const PATH = '/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode';

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
        const info = file.query_info('access::can-write', Gio.FileQueryInfoFlags.NONE, null);
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
            const value = isConservationEnabled() ? '0' : '1';
            // sysfs attributes cannot be created or renamed over, so write in place
            // (GLib.file_set_contents would write a temp file and rename it).
            const stream = Gio.File.new_for_path(PATH).open_readwrite(null);
            try {
                stream.get_output_stream().write_all(new TextEncoder().encode(value), null);
            } finally {
                stream.close(null);
            }
            return true;
        } catch (err) {
            logger.warn(
                'battery',
                'Direct conservation write failed, falling back to pkexec:',
                err
            );
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
        logger.error('battery', 'Failed to toggle conservation via pkexec:', err);
        return false;
    }
};

// ── Bindable state ──
// sysfs doesn't emit Gio.FileMonitor events, so a slow poll is the only way
// to observe external changes (e.g. Legion tools, other shells). The poll
// lives here in the service; widgets bind to `conservationEnabled`.

const [enabledState, setEnabledState] = createState(isConservationEnabled());
let monitorSubscribers = 0;
let monitorSource = 0;

/** Reactive conservation-mode state. Call startConservationMonitor() while a widget shows it. */
export const conservationEnabled: Accessor<boolean> = enabledState;

/**
 * Start the sysfs poll that keeps `conservationEnabled` fresh. One poll is shared
 * by every caller; the returned function releases the caller's claim and the poll
 * stops when the last claim is released.
 *
 * Conservation mode only changes when the user toggles it (rare), and
 * `refreshConservation()` is called immediately after every toggle, so a
 * slow poll is purely a safety net for external changes (e.g. other tools).
 */
export function startConservationMonitor(): () => void {
    monitorSubscribers++;
    if (!monitorSource) {
        refreshConservation();
        monitorSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            refreshConservation();
            return GLib.SOURCE_CONTINUE;
        });
    }
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        monitorSubscribers--;
        if (monitorSubscribers === 0 && monitorSource) {
            GLib.source_remove(monitorSource);
            monitorSource = 0;
        }
    };
}

/** Re-read sysfs now (call after a toggle attempt). */
export function refreshConservation(): void {
    setEnabledState(isConservationEnabled());
}

/**
 * Unified toggle: direct sysfs write first, fall back to pkexec.
 * Keeps the async fallback out of widgets.
 */
export async function toggleConservationUnified(): Promise<void> {
    const ok = toggleConservation();
    if (ok) {
        refreshConservation();
    } else {
        await toggleConservationAsync();
        refreshConservation();
    }
}

// Subscribe to bus toggle commands (module-level, no init() needed)
bus.on('power:conservation:toggle', () => {
    void toggleConservationUnified();
});
