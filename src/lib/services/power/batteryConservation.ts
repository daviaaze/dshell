import GLib from 'gi://GLib?version=2.0';

const PATH = '/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode';

export const isConservationEnabled = (): boolean => {
    try {
        const [ok, content] = GLib.file_get_contents(PATH);
        if (!ok) return false;
        return content.toString().trim() === '1';
    } catch {
        return false;
    }
};

export const toggleConservation = () => {
    // Assuming toggle-battery script is in the PATH
    GLib.spawn_command_line_async('toggle-battery');
};
