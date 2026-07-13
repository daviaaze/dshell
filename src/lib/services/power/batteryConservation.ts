import GLib from 'gi://GLib?version=2.0';

const PATH = '/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode';

export const isConservationEnabled = (): boolean => {
    try {
        const [ok, content] = GLib.file_get_contents(PATH);
        if (!ok) return false;
        const decoder = new TextDecoder();
        return decoder.decode(content).trim() === '1';
    } catch {
        return false;
    }
};

export const toggleConservation = (): void => {
    try {
        const current = isConservationEnabled();
        const value = current ? '0' : '1';
        GLib.file_set_contents(PATH, new TextEncoder().encode(value));
    } catch (err) {
        console.error('Failed to toggle battery conservation:', err);
    }
};
